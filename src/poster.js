import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Resvg } from '@resvg/resvg-js';
import puppeteer from 'puppeteer';
import { config, ROOT } from './config.js';
import { POSTER } from './i18n.js';
import { logoDataUri } from './brand.js';
import { qrModules } from './qr.js';
import { fontFaceCss } from './views.js';

// One SVG layout for both the print page and the PNG. Units are mm on A5.

const MM_W = 148;
const MM_H = 210;

const FONT_DIR = path.join(ROOT, 'public/fonts');
const FONT_FAMILY = 'Kantumruy Pro';
const KHMER_FONT_DATA_URI = `data:font/woff2;base64,${fs
  .readFileSync(path.join(FONT_DIR, 'KhmerUI.woff2'))
  .toString('base64')}`;
let browserPromise;

const fontOpts = {
  fontDirs: [FONT_DIR],
  defaultFontFamily: FONT_FAMILY,
  // System fonts may lack Khmer and differ between machines.
  loadSystemFonts: false,
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------ text metrics */

// Khmer width can't be estimated from length, so render once and measure the ink.
const REF_SIZE = 100;
const widthRatios = new Map();

function widthRatio(text, weight) {
  const key = `${weight}:${text}`;
  const hit = widthRatios.get(key);
  if (hit !== undefined) return hit;

  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="400" viewBox="0 0 6000 400">
    <rect width="6000" height="400" fill="#fff"/>
    <text x="20" y="280" font-family="${FONT_FAMILY}" font-size="${REF_SIZE}" font-weight="${weight}" fill="#000">${esc(text)}</text>
  </svg>`;

  let ratio = 0.55 * text.length; // only used if the probe itself fails
  try {
    const img = new Resvg(probe, { font: fontOpts }).render();
    const png = img.asPng();
    const decoded = PNG.sync.read(png);
    let right = 20;
    for (let y = 0; y < decoded.height; y++) {
      for (let x = decoded.width - 1; x > right; x--) {
        const i = (decoded.width * y + x) << 2;
        if (decoded.data[i] < 160) {
          right = x;
          break;
        }
      }
    }
    ratio = (right - 20) / REF_SIZE;
  } catch (err) {
    console.error('[poster] text measurement failed, falling back to an estimate:', err.message);
  }

  widthRatios.set(key, ratio);
  return ratio;
}

function fitSize(text, desired, maxW, weight) {
  const ratio = widthRatio(text, weight);
  if (ratio <= 0) return desired;
  return Math.min(desired, maxW / ratio);
}

/* --------------------------------------------------------------- the sheet */

function nestQr(qrSvg, x, y, size) {
  const vb = qrSvg.match(/viewBox="([^"]+)"/);
  const inner = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${vb ? vb[1] : `0 0 ${size} ${size}`}">${inner}</svg>`;
}

export function posterSvg({ name, qrSvg }) {
  const b = config.brand;
  const logo = logoDataUri();
  const contact = [b.phone, b.email].filter(Boolean);

  const fieldH = 134;
  const card = 98;
  const cardX = (MM_W - card) / 2;
  const cardY = (fieldH - card) / 2;

  // The card's padding is the quiet zone: 3 modules (tested; 2 misreads at an angle).
  const modules = qrModules(qrSvg) || 41;
  const qrPad = Math.ceil((3 * card) / (modules + 6));

  // Text below the card is stacked as blocks, then gaps are squeezed to fit the sheet.
  const pad = 12;
  const maxW = MM_W - pad * 2;
  const blocks = [];

  if (logo) {
    const h = 12;
    blocks.push({ h, gap: 5, svg: (top) =>
      `<image x="${(MM_W - 56) / 2}" y="${top.toFixed(2)}" width="56" height="${h}" preserveAspectRatio="xMidYMid meet" href="${logo}"/>` });
  } else if (b.name) {
    const size = fitSize(b.name, 5.3, maxW, 700);
    blocks.push({ h: size, gap: 5, svg: (top) => text(b.name, top + size, size, 700, '#18181b') });
  }

  const h1 = fitSize(POSTER.headingKm, 8.6, maxW, 700);
  blocks.push({ h: h1 * 1.2, gap: 2.5, svg: (top) => text(POSTER.headingKm, top + h1, h1, 700, '#18181b') });

  const h2 = fitSize(POSTER.headingEn, 5.1, maxW, 400);
  blocks.push({ h: h2, gap: 7, svg: (top) => text(POSTER.headingEn, top + h2, h2, 400, '#52525b') });

  const labelSize = fitSize(POSTER.locationLabel, 3.3, maxW, 600);
  blocks.push({ h: labelSize, gap: 2.6, svg: (top) => label(POSTER.locationLabel, top, labelSize) });

  const nameSize = fitSize(name, 6.8, maxW, 700);
  blocks.push({ h: nameSize, gap: 6, svg: (top) => text(name, top + nameSize, nameSize, 700, '#18181b') });

  if (contact.length) {
    const cl = fitSize(POSTER.contactLabel, 3.3, maxW, 600);
    blocks.push({ h: cl, gap: 2.6, svg: (top) => label(POSTER.contactLabel, top, cl) });
    contact.forEach((line, idx) => {
      const size = fitSize(line, 4.4, maxW, 600);
      blocks.push({ h: size, gap: idx === contact.length - 1 ? 0 : 1.8,
        svg: (top) => text(line, top + size, size, 600, '#3f3f46') });
    });
  }

  const bandTop = fieldH + 8;
  const available = MM_H - bandTop - 8;
  const content = blocks.reduce((sum, blk) => sum + blk.h, 0);
  const gaps = blocks.reduce((sum, blk) => sum + blk.gap, 0);
  const gapScale = content + gaps > available ? Math.max(0.35, (available - content) / gaps) : 1;

  const rows = [];
  let y = bandTop;
  for (const blk of blocks) {
    rows.push(blk.svg(y));
    y += blk.h + blk.gap * gapScale;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MM_W}mm" height="${MM_H}mm" viewBox="0 0 ${MM_W} ${MM_H}">
  <rect width="${MM_W}" height="${MM_H}" fill="#ffffff"/>

  <rect width="${MM_W}" height="${fieldH}" fill="${esc(b.color)}"/>
  <rect x="10" y="0" width="128" height="114" fill="${esc(b.highlight)}"/>
  <circle cx="42" cy="34" r="33" fill="${esc(b.accent)}"/>
  <circle cx="106" cy="34" r="33" fill="${esc(b.accent)}"/>
  <circle cx="42" cy="100" r="33" fill="${esc(b.accent)}"/>
  <circle cx="106" cy="100" r="33" fill="${esc(b.accent)}"/>

  <rect x="${cardX}" y="${cardY}" width="${card}" height="${card}" fill="#ffffff"/>
  ${nestQr(qrSvg, cardX + qrPad, cardY + qrPad, card - qrPad * 2)}

  ${rows.join('\n  ')}
</svg>`;
}

function text(value, baseline, size, weight, fill) {
  return (
    `<text x="${MM_W / 2}" y="${baseline}" text-anchor="middle" font-family="${FONT_FAMILY}" ` +
    `font-size="${size.toFixed(2)}" font-weight="${weight}" fill="${fill}">` +
    `${esc(value)}</text>`
  );
}

function label(value, y, size) {
  return (
    `<text x="${MM_W / 2}" y="${(y + size).toFixed(2)}" text-anchor="middle" font-family="${FONT_FAMILY}" ` +
    `font-size="${size.toFixed(2)}" font-weight="600" fill="#71717a" letter-spacing="0.5">${esc(value)}</text>`
  );
}

/* ------------------------------------------------------------------- raster */

async function browser() {
  // The service runs as root (needs --no-sandbox) and small VPSes have a 64MB /dev/shm.
  browserPromise ??= puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

// Chromium is the only renderer that shapes Khmer correctly. Font inlined: setContent() has no origin.
export async function posterPng({ name, qrSvg }) {
  const page = await (await browser()).newPage();
  try {
    const html = posterHtml({ name, qrSvg }).replace(
      "url('/fonts/KhmerUI.woff2')",
      `url('${KHMER_FONT_DATA_URI}')`
    );
    await page.setViewport({ width: 800, height: 1000, deviceScaleFactor: 300 / 96 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const sheet = await page.$('.sheet');
    if (!sheet) throw new Error('Poster template did not contain an A5 sheet.');
    return Buffer.from(await sheet.screenshot({ type: 'png' }));
  } finally {
    await page.close();
  }
}

/* ------------------------------------------------------------- print page */

export function posterHtml({ name, qrSvg, nonce = '' }) {
  const n = nonce ? ` nonce="${esc(nonce)}"` : '';
  return `<!doctype html>
<html lang="km">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(name)}</title>
<style${n}>${fontFaceCss}
  svg text { font-family: 'Kantumruy Pro', 'Khmer OS', system-ui, sans-serif; }
  @page { size: A5; margin: 0; }
  html, body { margin: 0; padding: 0; background: #e4e4e7; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .sheet { width: 148mm; height: 210mm; box-shadow: 0 2px 24px rgba(0,0,0,.14); background: #fff; }
  .sheet svg { display: block; width: 100%; height: 100%; }
  .bar { position: fixed; top: 0; left: 0; right: 0; z-index: 5; display: flex;
         align-items: center; justify-content: center; gap: 12px;
         padding: 10px 16px; background: #18181b; color: #fff; font-size: 13px; }
  .bar button { font: inherit; font-weight: 600; padding: 8px 16px; min-height: 40px;
                border: 0; border-radius: 8px; background: #fff; color: #18181b; cursor: pointer; }
  .bar span { opacity: .8; }
  .bar a { color: #fff; }
  @media screen and (max-width: 620px) {
    body { padding-top: 64px; align-items: flex-start; }
    .sheet { transform: scale(.52); transform-origin: top center; margin-bottom: -100mm; }
  }
  @media print {
    html, body { width: 148mm; height: 210mm; background: #fff; padding: 0; display: block; }
    .sheet { box-shadow: none; transform: none; margin: 0; }
    .bar { display: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="bar">
  <button id="printbtn" type="button">Print / បោះពុម្ព</button>
  <span>A5 · 100% scale · no margins</span>
</div>
<div class="sheet">${posterSvg({ name, qrSvg })}</div>
<script${n}>document.getElementById('printbtn').addEventListener('click', () => window.print());</script>
</body>
</html>`;
}
