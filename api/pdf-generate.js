// PDF generation via headless Chromium (Puppeteer + @sparticuz/chromium)
// Vercel Serverless Function
// POST { html: string, filename?: string, format?: "A4" }
//   → application/pdf binary
//
// CRITICAL: CORS headers MUST be set on EVERY response, including OPTIONS preflight.
// Chromium imports are LAZY (inside POST handler only) to keep OPTIONS cold-start
// instant and avoid module-load crashes from blocking CORS preflight.

export const config = {
  maxDuration: 60,
};

const ALLOWED_ORIGINS = new Set([
  'https://admin.dthomes.ch',
  'https://sign.dthomes.ch',
  'https://bewerbung.dthomes.ch',
  'https://claude.ai',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
]);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  // Echo back the origin if allowed, else admin as fallback
  // (Browser requires exact match, no wildcard with credentials)
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://admin.dthomes.ch';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  // ALWAYS set CORS headers FIRST, before anything else
  try {
    setCors(req, res);
  } catch (e) {
    // Fail-safe: even if setCors somehow crashes, set hardcoded CORS
    try {
      res.setHeader('Access-Control-Allow-Origin', 'https://admin.dthomes.ch');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    } catch {}
  }

  // Preflight: respond immediately with 204, no body
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // Origin validation
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Origin not allowed', origin }));
  }

  const { html, filename = 'document.pdf', format = 'A4' } = req.body || {};

  if (!html || typeof html !== 'string') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Missing or invalid "html" in body' }));
  }

  if (html.length > 5_000_000) {
    res.statusCode = 413;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'HTML too large (max 5MB)' }));
  }

  // ─── LAZY-LOAD chromium ONLY when actually needed ────────────────────
  // This avoids module-load crashes from killing OPTIONS preflight responses.
  let browser;
  try {
    const chromiumMod = await import('@sparticuz/chromium');
    const puppeteerMod = await import('puppeteer-core');
    const chromium = chromiumMod.default || chromiumMod;
    const puppeteer = puppeteerMod.default || puppeteerMod;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    // CORS headers already set at top; use setHeader (not writeHead which would overwrite)
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.from(pdfBuffer));
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    console.error('PDF generation error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      error: 'PDF generation failed',
      message: err.message,
    }));
  }
}
