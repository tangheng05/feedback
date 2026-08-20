#!/usr/bin/env node
/**
 * Downloads the Khmer subset of Noto Sans Khmer into public/fonts/.
 *
 * Run once at setup. The file is gitignored — binary assets don't belong in
 * this repo's history.
 *
 * Two things here are easy to get wrong and were wrong before:
 *
 * 1. Google's css2 response contains one @font-face block PER SUBSET PER
 *    WEIGHT — for this family, six blocks: {400,700} x {khmer, latin,
 *    latin-ext}. Picking blocks by position ("first is 400, last is 700")
 *    silently yields the LATIN subset, a file with zero Khmer glyphs. Every
 *    bold Khmer string then falls back to a system font, so the shop name and
 *    headings render in a different typeface than the text beside them — and
 *    it is completely invisible if you only ever test in English. We select by
 *    the Khmer unicode-range instead, and verify the result.
 *
 * 2. Both weights point at the SAME file: the Khmer subset is a variable font
 *    covering the whole 400-700 range. So there is one file to fetch, declared
 *    once with `font-weight: 400 700`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts');
const TARGET = 'NotoSansKhmer.woff2';

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;700&display=swap';

// Without a modern UA, Google serves legacy TTF instead of woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// The Khmer block is identified by its unicode-range, not by its position.
const KHMER_RANGE_MARKER = /U\+1780/i;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const res = await fetch(CSS_URL, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Google Fonts CSS: HTTP ${res.status}`);
  const css = await res.text();

  const khmerBlocks = css.split('@font-face').slice(1).filter((b) => KHMER_RANGE_MARKER.test(b));
  if (!khmerBlocks.length) {
    throw new Error('No Khmer subset found in the Google Fonts CSS — the API response format may have changed.');
  }

  const url = khmerBlocks[0].match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
  if (!url) throw new Error('Found the Khmer block but no woff2 URL in it.');

  const fontRes = await fetch(url, { headers: { 'user-agent': UA } });
  if (!fontRes.ok) throw new Error(`${TARGET}: HTTP ${fontRes.status}`);
  const buf = Buffer.from(await fontRes.arrayBuffer());

  // A Latin-only subset is ~25 KB; the Khmer subset is ~55 KB. This assertion
  // is what stops the original bug from ever coming back silently.
  if (buf.length < 40_000) {
    throw new Error(
      `${TARGET} is only ${buf.length} bytes — that looks like a Latin subset, not Khmer. Refusing to write it.`
    );
  }

  fs.writeFileSync(path.join(OUT, TARGET), buf);
  console.log(`saved ${TARGET} (${(buf.length / 1024).toFixed(0)} KB, covers weights 400-700)`);

  // Remove the files the old two-weight version left behind.
  for (const stale of ['NotoSansKhmer-Regular.woff2', 'NotoSansKhmer-Bold.woff2']) {
    const p = path.join(OUT, stale);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`removed stale ${stale}`);
    }
  }

  console.log('\nFonts ready. Restart the server to pick them up.');
}

main().catch((err) => {
  console.error('\nFont download failed:', err.message);
  console.error(
    'The form still works without this file — Khmer falls back to system fonts.\n' +
      'To do it by hand: open https://fonts.google.com/noto/specimen/Noto+Sans+Khmer,\n' +
      `download the family, and save the Khmer woff2 as public/fonts/${TARGET}.`
  );
  process.exit(1);
});
