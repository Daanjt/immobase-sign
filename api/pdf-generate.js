// PDF generation via headless Chromium (Puppeteer + @sparticuz/chromium)
// Vercel Serverless Function
// POST { html: string, filename?: string, format?: "A4" }
//   → application/pdf binary
//
// Auth: Origin must be admin.dthomes.ch, sign.dthomes.ch, localhost, or claude.ai

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const config = {
  maxDuration: 60,
};

const ALLOWED_ORIGINS = [
  'https://admin.dthomes.ch',
  'https://sign.dthomes.ch',
  'https://bewerbung.dthomes.ch',
  'https://claude.ai',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
];

function setCors(req, res) {
  const origin = req.headers.origin || '';
  // Falls origin in der Liste, exakt zurückgeben. Sonst Default = admin
  // (Browser akzeptieren nur exakte Matches, kein Wildcard mit credentials)
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://admin.dthomes.ch';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  // CORS Headers IMMER zuerst setzen, vor allem anderen
  setCors(req, res);

  // Preflight: 204 + nur CORS-Headers, kein Body
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
  if (!ALLOWED_ORIGINS.includes(origin)) {
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

    // WICHTIG: setHeader STATT writeHead — writeHead überschreibt sonst die CORS Headers!
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.from(pdfBuffer));
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
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
