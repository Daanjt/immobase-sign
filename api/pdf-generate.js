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
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://admin.dthomes.ch');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate origin (origin-based protection — keine API keys)
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed', origin });
  }

  const { html, filename = 'document.pdf', format = 'A4' } = req.body || {};

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "html" in body' });
  }

  if (html.length > 5_000_000) {
    return res.status(413).json({ error: 'HTML too large (max 5MB)' });
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

    // Set content + wait for fonts/images
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    console.error('PDF generation error:', err);
    return res.status(500).json({
      error: 'PDF generation failed',
      message: err.message,
    });
  }
}
