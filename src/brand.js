import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { config, ROOT } from './config.js';

/*
 * Brand logo loading.
 *
 * Two variants, because the logo lands on two different grounds:
 *
 *   BRAND_LOGO       for LIGHT grounds - the poster, the white plate in the
 *                    middle of every QR, and the form in light mode. This has
 *                    to be the dark/black artwork.
 *   BRAND_LOGO_DARK  for DARK grounds - only the form when the customer's
 *                    phone is in dark mode. Optional; without it the light
 *                    variant is used everywhere, which is the old behaviour.
 *
 * Note what does NOT switch: the poster prints on white paper and the QR plate
 * is white, so both always take the light-ground artwork whatever theme
 * anything else is in. A pale logo composited into the code would leave a
 * blank hole in the middle of it.
 *
 * Files are read once at boot. A missing or unreadable file is never fatal:
 * posters without a logo are the normal case until someone sets these, and a
 * typo in a path must not take the service down.
 */

/*
 * Why a source file is not served as-is.
 *
 * A brand PNG exported from a design tool is routinely 300-400 KB. The form is
 * 9 KB and is opened on a phone in a shop, often on mobile data - attaching
 * half a megabyte to it for a 28px-tall image would be the single heaviest
 * thing on the page by two orders of magnitude. So the artwork is downscaled
 * once at boot and the small copy is what customers fetch. The full-resolution
 * pixels stay in memory for the QR, which needs detail.
 */
/*
 * 128px covers every place the artwork is actually used:
 *   - form header, 28px tall, so 128 is comfortably retina
 *   - poster brand row, 9mm at 300dpi = 106px
 *   - inside the QR, an 11mm box at 300dpi = 130px wide
 * Beyond that the printer throws the detail away, and the poster carries two
 * embedded copies - at full resolution that made the print page 944 KB.
 */
const WEB_MAX_HEIGHT = 128;

/**
 * Box-filter downscale: every destination pixel averages the source pixels it
 * covers. Nearest-neighbour is fine for scaling a logo UP inside the QR, but
 * going from ~1100px down to ~200px it drops most of the source and leaves
 * ragged edges on exactly the fine strokes a wordmark is made of.
 */
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
          // Premultiply, or transparent pixels drag their (often black) colour
          // into the average and leave a dark fringe around the artwork.
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

  // The dark variant is only ever an <img> in a page, so SVG is fine there.
  // The light one is composited into the QR as pixels and must be a PNG.
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

// Configured but absent is the interesting case: silence would leave an admin
// staring at a page with no logo and no idea which of the two paths is wrong.
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

/** width / height of the artwork, so the QR's white plate can match it. */
export const logoAspect = () => (light.png ? light.png.width / light.png.height : 1);

/* ------------------------------------------------------- served to browsers */

/*
 * Stable URLs rather than data URIs, so the bytes are fetched once and cached
 * by the phone instead of riding along inside every no-store page load.
 */
export const LOGO_URL = '/brand/logo';
export const LOGO_DARK_URL = '/brand/logo-dark';

/*
 * Each side falls back to the other.
 *
 * Gating the header on the light variant alone meant that if only
 * BRAND_LOGO_DARK loaded - a typo in one path, one file not copied to the
 * server - the page rendered no logo at all, while the working file sat there
 * being served correctly. A wrong-contrast logo is a visible problem someone
 * fixes in a minute; a missing one looks like the feature was never built.
 */
export const logoUrl = () => (light.web ? LOGO_URL : dark.web ? LOGO_DARK_URL : '');
export const logoDarkUrl = () => (dark.web ? LOGO_DARK_URL : light.web ? LOGO_URL : '');
export const hasAnyLogo = () => Boolean(light.web || dark.web);

/** True only when the two files really differ, so the CSS swap is worth it. */
export const hasDarkLogo = () => Boolean(light.web && dark.web);

export const logoAsset = (variant) => (variant === 'dark' ? dark : light);

/* --------------------------------------------- embedded copies (print only) */

/*
 * The poster embeds its logo as a data URI on purpose. It is opened once by an
 * admin and sent straight to a printer, and a print job that races an image
 * request can come out of the printer with a gap where the logo should be.
 *
 * The downscaled copy is enough: see WEB_MAX_HEIGHT above for the arithmetic.
 */
export const logoDataUri = () =>
  light.web ? `data:${light.type};base64,${light.web.toString('base64')}` : '';

export const hasBrand = () => Boolean(config.brand.name || light.web);
