import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { config } from './config.js';
import { POSTER } from './i18n.js';
import { fontFaceCss } from './views.js';
import { hasLogo, logoPixels, logoDataUri, logoAspect } from './brand.js';

export const formUrl = (slug) => `${config.baseUrl}/f/${slug}`;
export const posterUrl = (slug) => `${config.baseUrl}/poster/${slug}`;

/*
 * Error correction, and why it changes when a logo is present.
 *
 * 'Q' (25%) is already above the default: a poster taped near a fitting room
 * gets scuffed, curled and smudged, and the redundancy is what keeps a worn
 * code scanning. Punching a logo through the middle spends that same budget on
 * damage we inflict ourselves, so with a logo we move to 'H' (30%) and keep
 * the hole small. The two together leave real headroom for wear.
 *
 * margin 4 is the quiet zone the QR spec requires. Scanners use it to find the
 * finder patterns, and a poster on a patterned wall or against a shelf edge is
 * exactly where a reduced zone fails.
 */
const qrOpts = () => ({ errorCorrectionLevel: hasLogo() ? 'H' : 'Q', margin: 4 });

/*
 * How wide the logo may be, as a fraction of the QR's width.
 *
 * The temptation is to go bigger because it looks better on screen; the budget
 * is shared with scuffs, glare and a phone camera at an angle, and a code that
 * scans on a clean screen can still fail on a wall.
 *
 * The plate behind it takes the LOGO's aspect ratio rather than being square.
 * A wordmark is typically 2:1 or wider, so a square plate erases a tall band
 * of modules that the artwork never touches - for a 2.2:1 logo that is a third
 * more damage than necessary, spent on empty white. Fitting the plate to the
 * artwork buys back enough headroom to draw the logo larger and still erase
 * less of the code than a square plate at the smaller size.
 */
const LOGO_WIDTH_RATIO = 0.24;
const LOGO_PAD_RATIO = 0.14; // white margin around the logo, as a fraction of its width

const pngCache = new Map();
const svgCache = new Map();

/*
 * Rendered QRs are cached forever.
 *
 * The image depends only on the slug, and the slug never changes once printed.
 * Without this, /qr/:slug.png re-renders a 1200px matrix per request on Node's
 * single thread - and the slug is printed on a poster on a public wall, so a
 * few hundred requests a second would pin the event loop and take the form
 * down for every shop. The cache is bounded by the number of locations.
 */

/**
 * Composite the logo into the centre of a decoded QR bitmap.
 *
 * Nearest-neighbour scaling, and the logo sits on an opaque white plate. Both
 * matter: a scanner thresholds the image to black and white, so a semi
 * transparent edge or a grey halo reads as ambiguous modules right next to the
 * area it is already reconstructing.
 */
function stampLogo(qr) {
  const logo = logoPixels();
  if (!logo) return qr;

  // Fit the artwork to the allowed width, keeping its proportions.
  const drawW = Math.round(qr.width * LOGO_WIDTH_RATIO);
  const drawH = Math.max(1, Math.round((drawW * logo.height) / logo.width));
  const pad = Math.round(drawW * LOGO_PAD_RATIO);

  const plateW = drawW + pad * 2;
  const plateH = drawH + pad * 2;
  const plateX = Math.round((qr.width - plateW) / 2);
  const plateY = Math.round((qr.height - plateH) / 2);

  // White plate first, sized to the artwork rather than to a square.
  for (let y = plateY; y < plateY + plateH; y++) {
    for (let x = plateX; x < plateX + plateW; x++) {
      const i = (qr.width * y + x) << 2;
      qr.data[i] = 255;
      qr.data[i + 1] = 255;
      qr.data[i + 2] = 255;
      qr.data[i + 3] = 255;
    }
  }

  const drawX = plateX + pad;
  const drawY = plateY + pad;
  const sxStep = logo.width / drawW;
  const syStep = logo.height / drawH;

  for (let y = 0; y < drawH; y++) {
    // Box filter, matching brand.js: the source is ~1100px wide going into a
    // ~260px box, and nearest-neighbour drops most of a fine script face,
    // leaving the thin strokes broken.
    const sy0 = Math.floor(y * syStep);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * syStep));
    for (let x = 0; x < drawW; x++) {
      const sx0 = Math.floor(x * sxStep);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * sxStep));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < logo.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < logo.width; sx++) {
          const si = (logo.width * sy + sx) << 2;
          const alpha = logo.data[si + 3] / 255;
          r += logo.data[si] * alpha;
          g += logo.data[si + 1] * alpha;
          b += logo.data[si + 2] * alpha;
          a += alpha;
          n++;
        }
      }

      // Composite over white, so transparency becomes white rather than black
      // and the plate stays clean for the scanner's threshold pass.
      const cov = a / n;
      const di = (qr.width * (drawY + y) + (drawX + x)) << 2;
      qr.data[di] = Math.round(r / n + 255 * (1 - cov));
      qr.data[di + 1] = Math.round(g / n + 255 * (1 - cov));
      qr.data[di + 2] = Math.round(b / n + 255 * (1 - cov));
      qr.data[di + 3] = 255;
    }
  }

  return qr;
}

export async function qrPng(slug) {
  if (!pngCache.has(slug)) {
    const raw = await QRCode.toBuffer(formUrl(slug), { ...qrOpts(), type: 'png', width: 1200 });
    const out = hasLogo() ? PNG.sync.write(stampLogo(PNG.sync.read(raw))) : raw;
    pngCache.set(slug, out);
  }
  return pngCache.get(slug);
}

/** Vector, so the printed edges stay razor sharp at any paper size. */
export async function qrSvg(slug) {
  if (!svgCache.has(slug)) {
    let svg = await QRCode.toString(formUrl(slug), { ...qrOpts(), type: 'svg' });

    if (hasLogo()) {
      // The generated SVG uses a viewBox in module units; read it rather than
      // assuming, so the overlay stays centred whatever version emits it.
      const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
      const w = vb ? Number(vb[1]) : 0;
      if (w > 0) {
        const ratio = logoAspect();
        const drawW = w * LOGO_WIDTH_RATIO;
        const drawH = drawW / ratio;
        const pad = drawW * LOGO_PAD_RATIO;
        const plateW = drawW + pad * 2;
        const plateH = drawH + pad * 2;
        const px = (w - plateW) / 2;
        const py = (w - plateH) / 2;
        const overlay =
          `<rect x="${px}" y="${py}" width="${plateW}" height="${plateH}" fill="#ffffff"/>` +
          `<image x="${px + pad}" y="${py + pad}" width="${drawW}" height="${drawH}" ` +
          `preserveAspectRatio="xMidYMid meet" href="${logoDataUri()}"/>`;
        svg = svg.replace('</svg>', `${overlay}</svg>`);
      }
    }

    svgCache.set(slug, svg);
  }
  return svgCache.get(slug);
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A5 print sheet.
 *
 * Opened on a phone or laptop and sent straight to a printer, with no design
 * tool in the loop - which is the whole point for a non-technical admin who
 * just ran /add.
 *
 * The colour field is an inline <svg>, not a CSS background. Browsers print
 * with "Background graphics" switched OFF by default, so a design built from
 * background-color would come out of the printer as a white sheet. SVG is
 * content, and content always prints.
 */
export function posterHtml({ name, slug, svg, nonce = '' }) {
  const n = nonce ? ` nonce="${esc(nonce)}"` : '';
  const b = config.brand;
  const logo = logoDataUri();

  const contact = [b.phone, b.email].filter(Boolean);

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
       default line-height clips them. */
    line-height: 1.9;
    background: #e4e4e7;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 16px;
  }

  .sheet {
    position: relative;
    width: 148mm; height: 210mm;
    background: #fff; color: #18181b;
    display: flex; flex-direction: column; align-items: center;
    text-align: center; overflow: hidden;
    box-shadow: 0 2px 24px rgba(0,0,0,.14);
  }

  /* The decorative field. Absolutely positioned SVG, so it prints. */
  .field { position: absolute; inset: 0 0 auto 0; height: 134mm; width: 100%; display: block; }

  .top { position: relative; z-index: 1; width: 100%; height: 134mm;
         display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8mm; }

  /* The QR card. A white plate with a hard edge is what a phone camera wants:
     it separates the code from the colour behind it at any angle. */
  .card { background: #fff; padding: 8mm; box-shadow: 0 1mm 4mm rgba(0,0,0,.18); }
  .card svg { display: block; width: 88mm; height: 88mm; }

  .bottom { position: relative; z-index: 1; flex: 1; width: 100%;
            padding: 8mm 12mm 10mm; display: flex; flex-direction: column; align-items: center; }

  .brandrow { display: flex; align-items: center; justify-content: center; gap: 3mm; margin-bottom: 1mm; }
  .brandrow img { height: 13mm; width: auto; max-width: 56mm; object-fit: contain; }
  .brandname { font-size: 15pt; font-weight: 700; letter-spacing: .02em; }

  /* Khmer shop names are common: uppercase is a no-op on Khmer, and
     letter-spacing can land between a base consonant and its coeng, pulling
     the script apart on printed paper. */
  h1 { font-size: 25pt; margin: 0 0 1.5mm; font-weight: 700; text-transform: none; letter-spacing: 0; line-height: 1.5; }
  h2 { font-size: 15pt; margin: 0; font-weight: 400; color: #3f3f46; }
  .en { color: #52525b; }

  .label { font-size: 10pt; letter-spacing: .14em; text-transform: uppercase;
           color: #71717a; margin-top: 6mm; line-height: 1.6; }
  .value { font-size: 17pt; font-weight: 700; line-height: 1.4; }


  .bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 5;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    padding: 10px 16px; background: #18181b; color: #fff; font-size: 13px;
  }
  .bar button {
    font: inherit; font-weight: 600; padding: 8px 16px; min-height: 40px;
    border: 0; border-radius: 8px; background: #fff; color: #18181b; cursor: pointer;
  }
  .bar span { opacity: .8; }

  /* The sheet is 148mm ~ 559px, so it would scroll sideways on a phone - and
     the runbook tells admins to open this link on their phone. */
  @media screen and (max-width: 620px) {
    body { padding-top: 64px; align-items: flex-start; }
    .sheet { transform: scale(.52); transform-origin: top center; margin-bottom: -100mm; }
  }

  @media print {
    html, body { width: 148mm; height: 210mm; background: #fff; }
    body { padding: 0; display: block; }
    .sheet { box-shadow: none; }
    .card { box-shadow: none; outline: .4mm solid #e4e4e7; }
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
  <svg class="field" viewBox="0 0 148 122" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="148" height="122" fill="${esc(b.color)}"/>
    <rect x="14" y="0" width="120" height="104" fill="${esc(b.highlight)}"/>
    <circle cx="52" cy="36" r="36" fill="${esc(b.accent)}"/>
    <circle cx="112" cy="36" r="30" fill="${esc(b.accent)}"/>
    <circle cx="52" cy="94" r="30" fill="${esc(b.accent)}"/>
    <circle cx="110" cy="92" r="26" fill="${esc(b.accent)}"/>
  </svg>

  <div class="top">
    <div class="card">${svg}</div>
  </div>

  <div class="bottom">
    ${
      logo || b.name
        ? `<div class="brandrow">${logo ? `<img src="${logo}" alt="">` : ''}${
            b.name ? `<span class="brandname">${esc(b.name)}</span>` : ''
          }</div>`
        : ''
    }

    <h1>${POSTER.headingKm}</h1>
    <h2 class="en" lang="en">${POSTER.headingEn}</h2>

    <div class="label">${POSTER.locationLabel}</div>
    <div class="value">${esc(name)}</div>
${
  contact.length
    ? `
    <div class="label">${POSTER.contactLabel}</div>
    <div class="value" lang="en">${contact.map(esc).join('<br>')}</div>`
    : ''
}
  </div>
</div>

<script${n}>document.getElementById('printbtn').addEventListener('click', () => window.print());</script>
</body>
</html>`;
}
