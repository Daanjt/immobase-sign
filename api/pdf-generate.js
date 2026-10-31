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

// Laeuft im Browser (page.evaluate)
async function verkleinereFotos() {
  const imgs = Array.from(document.images);
  await Promise.all(imgs.map(async (img) => {
    try {
      if (getComputedStyle(img).objectFit !== 'cover' || /^data:/.test(img.src)) return;
      const r = img.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!w || !h || !nw || !nh) return;
      const tw = w * 2, th = h * 2;
      const im = new Image();
      im.crossOrigin = 'anonymous';
      await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = img.src + (img.src.includes('?') ? '&' : '?') + 'pdfklein=1'; });
      const s = Math.max(w / nw, h / nh);
      const sw = w / s, sh = h / s;
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(im, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, tw, th);
      img.src = c.toDataURL('image/jpeg', 0.78);
      img.style.objectFit = 'fill';
      await img.decode().catch(() => {});
    } catch (e) {}
  }));
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

  // Downscale large public storage images through a resizing proxy so protocols
  // with many photos render well within the timeout (e.g. 468KB -> ~70KB each).
  const htmlR = html.replace(
    /(<img\b[^>]*\bsrc=")((?:https?:)?\/\/[^"]*\/storage\/v1\/object\/public\/[^"]+)(")/gi,
    (_m, pre, url, post) => `${pre}https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1000&q=72&output=jpg${post}`
  );

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
    await page.setContent(htmlR, { waitUntil: 'networkidle0', timeout: 50000 });

    // Fotos (object-fit: cover) auf die doppelte Anzeigegroesse verkleinern und als JPEG einsetzen.
    // Sonst bettet Chrome die zugeschnittenen Originale unkomprimiert ein (20 Handyfotos = >30 MB).
    // Die Bilder werden nur hier im Browser verkleinert, kein Dienst von Dritten.
    try { await page.evaluate(verkleinereFotos); } catch (e) { console.error('Fotos verkleinern:', e && e.message); }

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
