// PDF generation — same skeleton as cors-test.js (which works)
// Heavy chromium/puppeteer code is in async helper, NOT in main handler.
// Main handler is SYNC, returns immediately for OPTIONS.
// Memory + maxDuration are configured in vercel.json (more memory = more CPU = faster Chromium).

export default function handler(req, res) {
  // CORS headers FIRST, every response, no logic before this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Preflight: return 204 immediately, sync, before any async work
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // GET test: confirm function is alive
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, endpoint: 'pdf-generate', method: 'GET' }));
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // Delegate POST to async helper, catch any error
  return generatePdf(req, res).catch((err) => {
    console.error('PDF error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'PDF generation failed', message: err.message }));
    }
  });
}

async function generatePdf(req, res) {
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

  // Lazy-load Chromium ONLY for POST
  const chromiumMod = await import('@sparticuz/chromium');
  const puppeteerMod = await import('puppeteer-core');
  const chromium = chromiumMod.default || chromiumMod;
  const puppeteer = puppeteerMod.default || puppeteerMod;

  // Skip the WebGL/graphics stack — not needed for PDF, speeds up cold start.
  try { chromium.setGraphicsMode = false; } catch (e) {}

  let browser;
  try {
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

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.from(pdfBuffer));
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
