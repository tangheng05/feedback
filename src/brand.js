import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { config, ROOT } from './config.js';

// Logos are read once at boot; a missing or bad file is logged, never fatal.

// Served copy is downscaled; full-resolution pixels are kept only for the QR.
const WEB_MAX_HEIGHT = 128;

// Box filter, so thin strokes survive a large downscale.
function downscale(src, maxHeight) {
  if (src.height <= maxHeight) return src;

  const scale = maxHeight / src.height;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = maxHeight;
  const out = new PNG({ width: w, height: h });

  const xStep = src.width / w;
  const yStep = src.height / h;

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yStep);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yStep));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xStep);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xStep));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < src.height; sy++) {
        for (let sx = x0; sx < x1 && sx < src.width; sx++) {
          const i = (src.width * sy + sx) << 2;
          const alpha = src.data[i + 3] / 255;
          // Premultiply, or transparent pixels leave a dark fringe.
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += src.data[i + 3];
          n++;
        }
      }

      const o = (w * y + x) << 2;
      const alphaAvg = a / n;
      const un = alphaAvg > 0 ? 255 / alphaAvg : 0;
      out.data[o] = Math.min(255, Math.round((r / n) * un));
      out.data[o + 1] = Math.min(255, Math.round((g / n) * un));
      out.data[o + 2] = Math.min(255, Math.round((b / n) * un));
      out.data[o + 3] = Math.round(alphaAvg);
    }
  }

  return out;
}

function readLogo(rel, { needPixels }) {
  const empty = { png: null, web: null, orig: null, type: '', name: '' };
  if (!rel) return empty;

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    console.error(`[brand] logo path must stay inside the project directory, got "${rel}"`);
    return empty;
  }

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    console.error(`[brand] could not read "${rel}": ${err.message}. Continuing without it.`);
    return empty;
  }

  const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;

  // The dark variant may be SVG; the light one is composited into the QR.
  if (!isPng) {
    if (needPixels) {
      console.error(
        `[brand] BRAND_LOGO "${rel}" is not a PNG. It has to be: the same file is composited ` +
          'into the centre of the QR as pixels. Convert it and restart.'
      );
      return empty;
    }
    if (!buf.slice(0, 512).toString('utf8').includes('<svg')) {
      console.error(`[brand] "${rel}" is neither a PNG nor an SVG.`);
      return empty;
    }
    return { png: null, web: buf, orig: buf, type: 'image/svg+xml', name: path.basename(rel) };
  }

  let png;
  try {
    png = PNG.sync.read(buf);
  } catch (err) {
    console.error(`[brand] "${rel}" could not be decoded: ${err.message}`);
    return empty;
  }

  const small = downscale(png, WEB_MAX_HEIGHT);
  const web = small === png ? buf : PNG.sync.write(small);

  return { png: needPixels ? png : null, web, orig: buf, type: 'image/png', name: path.basename(rel) };
}

const light = readLogo(config.brand.logo, { needPixels: true });
const dark = readLogo(config.brand.logoDark, { needPixels: false });

const kb = (b) => (b ? `${(b.length / 1024).toFixed(0)} KB` : '-');
if (light.web || dark.web) {
  console.log(
    `[brand] logo${light.web ? ` ${kb(light.web)}` : ' -'}` +
      `${dark.web ? `, dark variant ${kb(dark.web)}` : ''}`
  );
}

if (config.brand.logo && !light.web) {
  console.error(
    `[brand] BRAND_LOGO is set to "${config.brand.logo}" but nothing loaded from it. ` +
      'The poster and the QR need this file specifically - check the path and that it is a PNG.'
  );
}
if (config.brand.logoDark && !dark.web) {
  console.error(`[brand] BRAND_LOGO_DARK is set to "${config.brand.logoDark}" but nothing loaded from it.`);
}

/* ------------------------------------------------- the QR overlay (pixels) */

export const hasLogo = () => light.png !== null;
export const logoPixels = () => light.png;

export const logoAspect = () => (light.png ? light.png.width / light.png.height : 1);

/* ------------------------------------------------------- served to browsers */

export const LOGO_URL = '/brand/logo';
export const LOGO_DARK_URL = '/brand/logo-dark';

// Each variant falls back to the other.
export const logoUrl = () => (light.web ? LOGO_URL : dark.web ? LOGO_DARK_URL : '');
export const logoDarkUrl = () => (dark.web ? LOGO_DARK_URL : light.web ? LOGO_URL : '');
export const hasAnyLogo = () => Boolean(light.web || dark.web);

export const hasDarkLogo = () => Boolean(light.web && dark.web);

export const logoAsset = (variant) => (variant === 'dark' ? dark : light);

/* --------------------------------------------- embedded copies (print only) */

// Inlined so a print job can't race the image request.
export const logoDataUri = () =>
  light.web ? `data:${light.type};base64,${light.web.toString('base64')}` : '';
