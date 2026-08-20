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

/*
 * The poster, drawn once as SVG.
 *
 * It used to be an HTML page, which printed well but could not be turned into
 * an image without a headless browser. Everything is SVG now and both outputs
 * come from this one function: the print page embeds it, and Chromium
 * screenshots the same sheet for the PNG. There is no second layout to drift
 * out of sync with the first.
 *
 * Coordinates are millimetres on an A5 sheet, so the numbers below are the
 * measurements you would give a printer.
 */

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
  // Never the system's fonts: a VPS has a different set from a laptop, and a
  // poster that silently falls back to a face without Khmer prints as boxes.
  loadSystemFonts: false,
};

/*
 * Put a space between Khmer text and a trailing ? or !
 *
 * The shaper folds an ASCII question mark into the preceding Khmer cluster and
 * draws it ON TOP of the final consonant - "ទេ?" comes out as one
 * illegible blob. Tested against the alternatives: a zero-width space and a
 * word joiner are both swallowed the same way; only a real space separates
 * them. Browsers get this right, so the strings themselves stay exactly as the
 * reviewer wrote them and the workaround lives here, where the bug is.
 */
/*
 * Khmer never goes above weight 500 here.
 *
 * Kantumruy Pro Bold thickens the strokes without opening the sidebearings
 * or the clearance under a base consonant, so a coeng stack that is legible at
 * 400 collides at 700: in "បញ្ហា" the subscript merges into the
 * consonant above it and that consonant fuses with the vowel after it. It
 * reads as a blob, and at poster size a blob is what a customer sees from a
 * metre away.
 *
 * 400 and 500 both come from the Regular file, 600 and 700 from Bold, so 500
 * is the heaviest weight that still renders the stack cleanly. Latin is
 * unaffected and keeps whatever weight it was given.
 */
const KHMER = /[ក-៿]/u;
const safeWeight = (value, weight) => (KHMER.test(value) ? Math.min(weight, 500) : weight);

const spaceBeforePunct = (s) => String(s).replace(/([ក-៿])([?!])$/u, '$1 $2');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------ text metrics */

/*
 * SVG has no text wrapping and no way to ask how wide a string will be, and
 * the widths here are not guessable: Khmer stacks subscript consonants, so
 * character count tells you almost nothing about the width of a line.
 *
 * So measure it: render the string once at a reference size, find the ink, and
 * keep the ratio. Cached by string and weight, and the strings are almost all
 * constants, so in practice this runs a handful of times at first use.
 */
const REF_SIZE = 100;
const widthRatios = new Map();

function widthRatio(text, weight) {
  const key = `${weight}:${text}`;
  const hit = widthRatios.get(key);
  if (hit !== undefined) return hit;

  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="400" viewBox="0 0 6000 400">
    <rect width="6000" height="400" fill="#fff"/>
    <text x="20" y="280" font-family="${FONT_FAMILY}" font-size="${REF_SIZE}" font-weight="${safeWeight(text, weight)}" fill="#000">${esc(spaceBeforePunct(text))}</text>
  </svg>`;

  let ratio = 0.55 * text.length; // only used if the probe itself fails
  try {
    const img = new Resvg(probe, { font: fontOpts }).render();
    const png = img.asPng();
    // Scan the raster for the rightmost dark pixel. Cheaper than decoding: the
    // PNG is small and this happens once per distinct string.
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

/** Largest size at or below `desired` (mm) that keeps the line inside `maxW`. */
function fitSize(text, desired, maxW, weight) {
  const ratio = widthRatio(text, weight);
  if (ratio <= 0) return desired;
  return Math.min(desired, maxW / ratio);
}

/* --------------------------------------------------------------- the sheet */

/**
 * Nest the QR's own SVG rather than re-drawing it.
 *
 * qrSvg() already carries the logo overlay and the quiet zone, and re-deriving
 * either here would be a second place for them to go wrong.
 */
function nestQr(qrSvg, x, y, size) {
  const vb = qrSvg.match(/viewBox="([^"]+)"/);
  const inner = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${vb ? vb[1] : `0 0 ${size} ${size}`}">${inner}</svg>`;
}

export function posterSvg({ name, qrSvg }) {
  const b = config.brand;
  const logo = logoDataUri();
  const contact = [b.phone, b.email].filter(Boolean);

  // -- the colour field and the card ----------------------------------------
  const fieldH = 134;
  // The card is what the eye lands on, so it stays big - but not so big that
  // the decoration behind it is reduced to slivers at the edges, which reads
  // as a mistake rather than a background.
  const card = 98;
  const cardX = (MM_W - card) / 2;
  const cardY = (fieldH - card) / 2;

  /*
   * The card's padding IS the quiet zone.
   *
   * The code is drawn with margin 0 and the white card supplies the four
   * modules of clear space a scanner needs. Doing both - a margin inside the
   * image and padding around it - ringed the code in about 14mm of white and
   * made it look small on the sheet, which is exactly what it looked like.
   *
   * Solving p >= 4 * (card - 2p) / modules for p gives the smallest padding
   * that still satisfies the spec, so the code itself gets everything else.
   */
  const modules = qrModules(qrSvg) || 41;
  const qrPad = Math.ceil((4 * card) / (modules + 8));

  // -- the band underneath ---------------------------------------------------
  /*
   * Laid out as blocks with gaps, then fitted to the space that is left.
   *
   * Hand-tuned y offsets worked until a location had a contact line, at which
   * point the last row printed past the bottom edge of the paper - and an A5
   * sheet does not scroll. Measuring the stack and squeezing the gaps means
   * any combination of brand, name length and contact lines lands on the page.
   */
  const pad = 12; // side margin for text
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
  // Squeeze the gaps, never the type: smaller text is harder to read from a
  // metre away, while 20% less air is not something anyone notices.
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
    `font-size="${size.toFixed(2)}" font-weight="${safeWeight(value, weight)}" fill="${fill}">` +
    `${esc(spaceBeforePunct(value))}</text>`
  );
}

function label(value, y, size) {
  return (
    `<text x="${MM_W / 2}" y="${(y + size).toFixed(2)}" text-anchor="middle" font-family="${FONT_FAMILY}" ` +
    `font-size="${size.toFixed(2)}" font-weight="${safeWeight(value, 600)}" fill="#71717a" letter-spacing="0.5">${esc(value)}</text>`
  );
}

/* ------------------------------------------------------------------- raster */

/*
 * 300dpi. A5 at that density is 1748x2480, which is a genuine print file
 * rather than a screenshot of one - someone can forward it straight from
 * Telegram to a print shop.
 */
const DPI = 300;

async function browser() {
  browserPromise ??= puppeteer.launch({ headless: 'new' });
  return browserPromise;
}

/*
 * Chromium's HarfBuzz text stack is used for the final rasterisation. The
 * font is inlined because setContent() has no application origin from which
 * to resolve /fonts/KhmerUI.woff2, and a network-dependent font would make
 * the generated poster nondeterministic.
 */
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

/*
 * The printable page is now a thin wrapper around the same SVG.
 *
 * There is no second layout here on purpose: when the sheet was authored twice
 * - once in HTML for printing, once for the image - the two versions drifted,
 * and the copy an admin actually printed was never the one anyone reviewed.
 */
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
  /*
   * The @font-face above is not decoration.
   *
   * The sheet is one SVG whose text asks for 'Kantumruy Pro' by name. The
   * PNG is rendered on the server, which loads the TTFs directly - but this
   * page is rendered by whatever browser the admin opened it in, and without a
   * font to fetch it substitutes a system face. Khmer then comes out with
   * marks stacked over the wrong consonants: legible-looking, and wrong.
   */
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
  /* 148mm is ~559px, so the sheet would scroll sideways on a phone — and the
     runbook tells admins to open this link on their phone. */
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
