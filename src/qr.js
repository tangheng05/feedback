import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { config } from './config.js';
import { hasLogo, logoPixels, logoDataUri, logoAspect } from './brand.js';

export const formUrl = (slug) => `${config.baseUrl}/f/${slug}`;
export const posterUrl = (slug) => `${config.baseUrl}/poster/${slug}`;

// H when a logo covers the centre, Q otherwise; margin 4 is the spec's quiet zone.
const qrOpts = () => ({ errorCorrectionLevel: hasLogo() ? 'H' : 'Q', margin: 4 });

// Don't grow this: it shares the error-correction budget with wear and glare.
const LOGO_WIDTH_RATIO = 0.24;
const LOGO_PAD_RATIO = 0.14; // white margin around the logo, as a fraction of its width

const pngCache = new Map();
const svgCache = new Map();

// Cached forever: the image depends only on the slug, which never changes.

function stampLogo(qr) {
  const logo = logoPixels();
  if (!logo) return qr;

  const drawW = Math.round(qr.width * LOGO_WIDTH_RATIO);
  const drawH = Math.max(1, Math.round((drawW * logo.height) / logo.width));
  const pad = Math.round(drawW * LOGO_PAD_RATIO);

  const plateW = drawW + pad * 2;
  const plateH = drawH + pad * 2;
  const plateX = Math.round((qr.width - plateW) / 2);
  const plateY = Math.round((qr.height - plateH) / 2);

  // Plate fits the logo's aspect ratio, so it erases fewer modules than a square.
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

      // Composite over white so the plate stays clean for the scanner.
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

// The poster passes margin 0: its white card is the quiet zone.
export async function qrSvg(slug, { margin = 4 } = {}) {
  const key = `${slug}|m${margin}`;
  if (!svgCache.has(key)) {
    let svg = await QRCode.toString(formUrl(slug), { ...qrOpts(), margin, type: 'svg' });

    if (hasLogo()) {
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

    svgCache.set(key, svg);
  }
  return svgCache.get(key);
}

export function qrModules(svg) {
  const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?)/);
  return vb ? Number(vb[1]) : 0;
}
