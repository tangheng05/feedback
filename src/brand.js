import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { config, ROOT } from './config.js';

/*
 * Brand logo loading.
 *
 * Read once at boot, not per request: the same file is composited into every
 * QR, and re-reading it from disk on a public endpoint would be an easy way to
 * make the server do pointless I/O.
 *
 * A missing or unreadable file is not fatal. Posters without a logo are the
 * normal case until someone sets BRAND_LOGO, and a typo in the path must not
 * take the whole service down at startup.
 */

let logoPng = null; // decoded pixels, for the raster QR
let logoDataUri = ''; // base64, for the SVG QR and the poster HTML

function load() {
  const rel = config.brand.logo;
  if (!rel) return;

  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    console.error(`[brand] BRAND_LOGO must stay inside the project directory, got "${rel}"`);
    return;
  }

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    console.error(`[brand] could not read BRAND_LOGO "${rel}": ${err.message}. Continuing without a logo.`);
    return;
  }

  // The PNG signature, checked before handing the bytes to a decoder.
  const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
  if (!isPng) {
    console.error(
      `[brand] BRAND_LOGO "${rel}" is not a PNG. It has to be, because the same file is ` +
        'composited into the centre of the QR image as pixels. Convert it and restart.'
    );
    return;
  }

  try {
    logoPng = PNG.sync.read(buf);
  } catch (err) {
    console.error(`[brand] BRAND_LOGO "${rel}" could not be decoded: ${err.message}`);
    return;
  }

  logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
  console.log(`[brand] logo loaded: ${rel} (${logoPng.width}x${logoPng.height})`);
}

load();

export const hasLogo = () => logoPng !== null;
export const logoPixels = () => logoPng;
export const logoUri = () => logoDataUri;

/** True when there is anything at all to render in the brand row. */
export const hasBrand = () => Boolean(config.brand.name || logoDataUri);
