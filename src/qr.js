import QRCode from 'qrcode';
import { config } from './config.js';
import { POSTER } from './i18n.js';
import { fontFaceCss } from './views.js';

export const formUrl = (slug) => `${config.baseUrl}/f/${slug}`;
export const posterUrl = (slug) => `${config.baseUrl}/poster/${slug}`;

/**
 * Error correction 'Q' (25%) rather than the default 'M'. A poster taped near a
 * fitting room gets scuffed, curled and smudged; the extra redundancy is what
 * keeps a worn code scanning, and our URLs are short enough that the denser
 * matrix costs nothing in practice.
 *
 * margin 4 is the quiet zone the QR spec requires — scanners use it to locate
 * the finder patterns, and a poster on a patterned wall or against a shelf edge
 * is exactly where a reduced zone fails. At this print size the modules are
 * ~1.9mm, so the extra border costs nothing legible.
 */
const QR_OPTS = { errorCorrectionLevel: 'Q', margin: 4 };

/*
 * Rendered QRs are cached forever.
 *
 * The image depends only on the slug, and the slug never changes once printed.
 * Without this, /qr/:slug.png re-renders a 1200px matrix per request on Node's
 * single thread — and the slug is printed on a poster on a public wall, so a
 * few hundred requests a second would pin the event loop and take the form
 * down for every shop. The cache is bounded by the number of locations.
 */
const pngCache = new Map();
const svgCache = new Map();

export async function qrPng(slug) {
  if (!pngCache.has(slug)) {
    pngCache.set(slug, await QRCode.toBuffer(formUrl(slug), { ...QR_OPTS, type: 'png', width: 1200 }));
  }
  return pngCache.get(slug);
}

/** Vector, so the printed edges stay razor sharp at any paper size. */
export async function qrSvg(slug) {
  if (!svgCache.has(slug)) {
    svgCache.set(slug, await QRCode.toString(formUrl(slug), { ...QR_OPTS, type: 'svg' }));
  }
  return svgCache.get(slug);
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A5 print sheet. Opened on a phone or laptop and sent straight to a printer —
 * no design tool in the loop, which is the whole point for a non-technical
 * admin who just ran /add.
 */
export function posterHtml({ name, slug, svg, nonce = '' }) {
  const n = nonce ? ` nonce="${esc(nonce)}"` : '';
  const url = formUrl(slug).replace(/^https?:\/\//, '');

  return `<!doctype html>
<html lang="km">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(name)} — QR</title>
<style${n}>${fontFaceCss}
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans Khmer', 'Khmer OS', system-ui, -apple-system, 'Segoe UI', sans-serif;
    /* Floor for every descendant: Khmer coeng render below the baseline and a
       default line-height clips them. .print-btn inherits from here. */
    line-height: 1.9;
    background: #f4f4f5;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 16px;
  }
  .sheet {
    width: 148mm; height: 210mm;
    background: #fff; color: #18181b;
    padding: 16mm 12mm;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    box-shadow: 0 2px 24px rgba(0,0,0,.12);
    overflow: hidden;
  }
  /* Khmer shop names are common: uppercase is a no-op on Khmer, and
     letter-spacing can be inserted between a base consonant and its coeng,
     pulling the script apart on printed paper. */
  .shop {
    font-size: 13pt; font-weight: 700; color: #52525b;
    text-transform: none; letter-spacing: 0;
  }
  /* A border, not a background: browsers print with "Background graphics" off
     by default, which would silently drop a background-coloured divider. */
  .rule { width: 28mm; height: 0; border-top: 2px solid #18181b; margin: 5mm 0 7mm; }
  h1 { font-size: 22pt; margin: 0 0 2mm; font-weight: 700; }
  h2 { font-size: 12.5pt; margin: 0; font-weight: 400; color: #3f3f46; }
  .qr { flex: none; margin: auto 0; width: 76mm; height: 76mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .url {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 9.5pt; color: #52525b; margin-top: 4mm; word-break: break-all; line-height: 1.4;
  }
  .foot { margin-top: auto; padding-top: 5mm; font-size: 9pt; color: #71717a; }
  .en { color: #71717a; }

  .bar {
    position: fixed; top: 0; left: 0; right: 0;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    padding: 10px 16px; background: #18181b; color: #fff; font-size: 13px;
  }
  .bar button {
    font: inherit; font-weight: 600; padding: 8px 16px; min-height: 40px;
    border: 0; border-radius: 8px; background: #fff; color: #18181b; cursor: pointer;
  }
  .bar span { opacity: .8; }

  /* The sheet is 148mm ~ 559px, so it would scroll sideways on a phone —
     and the runbook tells admins to open this link on their phone. */
  @media screen and (max-width: 620px) {
    body { padding-top: 64px; align-items: flex-start; }
    .sheet { transform: scale(.52); transform-origin: top center; margin-bottom: -100mm; }
  }

  @media print {
    html, body { width: 148mm; height: 210mm; background: #fff; }
    body { padding: 0; display: block; }
    .sheet { box-shadow: none; width: 148mm; height: 210mm; }
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
<div class="sheet">
  <div class="shop">${esc(name)}</div>
  <div class="rule"></div>
  <h1>${POSTER.headingKm}</h1>
  <h2 class="en" lang="en">${POSTER.headingEn}</h2>
  <div class="qr">${svg}</div>
  <h2>${POSTER.subKm}</h2>
  <h2 class="en" lang="en">${POSTER.subEn}</h2>
  <div class="url" lang="en">${esc(url)}</div>
  <div class="foot">
    ${POSTER.footKm}<br>
    <span class="en" lang="en">${POSTER.footEn}</span>
  </div>
</div>
<script${n}>document.getElementById('printbtn').addEventListener('click', () => window.print());</script>
</body>
</html>`;
}
