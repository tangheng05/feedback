import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { config } from './config.js';
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
