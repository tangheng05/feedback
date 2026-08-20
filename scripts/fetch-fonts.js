#!/usr/bin/env node
/**
 * Downloads Noto Sans Khmer into public/fonts/ - both the woff2 the browser
 * uses and the TTFs the poster renderer needs.
 *
 * The TTFs are not optional. resvg rasterises the poster and cannot read
 * woff2, and it is configured not to fall back to system fonts: a VPS has a
 * different font set from a laptop, and silently substituting a face with no
 * Khmer glyphs would print a wall poster full of empty boxes. Without these
 * files the poster PNG comes out with no text on it at all.
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
const TARGET = 'KhmerUI.woff2';

/*
 * Kantumruy Pro, not Noto Sans Khmer.
 *
 * Noto Sans Khmer does not apply the foot-removal substitution for ញ: when the
 * letter takes a subscript, its foot is supposed to disappear so the subscript
 * can sit in the vacated space. Noto keeps the foot and draws the subscript
 * straight through it, so a common word like បញ្ហា ("problem") renders as
 * one tangled shape. Verified against the Windows text engine, which removes
 * the foot correctly, and against Kantumruy Pro, Battambang and Hanuman, all
 * of which also get it right.
 *
 * Kantumruy Pro is the pick: designed for UI and display, and correct at every
 * weight including 700, where Noto's problem was worst.
 */
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;700&display=swap';

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
  if (buf.length < 20_000) {
    throw new Error(
      `${TARGET} is only ${buf.length} bytes — that looks like a Latin subset, not Khmer. Refusing to write it.`
    );
  }

  fs.writeFileSync(path.join(OUT, TARGET), buf);
  console.log(`saved ${TARGET} (${(buf.length / 1024).toFixed(0)} KB, covers weights 400-700)`);

  // Remove the files the old two-weight version left behind.
  for (const stale of [
    'NotoSansKhmer.woff2',
    'NotoSansKhmer-Regular.woff2',
    'NotoSansKhmer-Bold.woff2',
    'NotoSansKhmer-Regular.ttf',
    'NotoSansKhmer-Bold.ttf',
  ]) {
    const p = path.join(OUT, stale);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`removed stale ${stale}`);
    }
  }

  await fetchTtfs();

  console.log('\nFonts ready. Restart the server to pick them up.');
}

/*
 * Google serves TTF instead of woff2 when the User-Agent looks ancient. That
 * quirk is the whole mechanism here: same URL, same family, different format.
 */
async function fetchTtfs() {
  const res = await fetch(CSS_URL, { headers: { 'user-agent': 'Mozilla/4.0' } });
  if (!res.ok) throw new Error(`Google Fonts CSS (ttf): HTTP ${res.status}`);
  const css = await res.text();

  const urls = [...css.matchAll(/url\((https:[^)]+\.ttf)\)/g)].map((m) => m[1]);
  if (!urls.length) throw new Error('No TTF URLs in the Google Fonts response.');

  const names = ['KhmerUI-Regular.ttf', 'KhmerUI-Medium.ttf', 'KhmerUI-Bold.ttf'];
  for (let i = 0; i < Math.min(urls.length, names.length); i++) {
    const r = await fetch(urls[i], { headers: { 'user-agent': 'Mozilla/4.0' } });
    if (!r.ok) throw new Error(`${names[i]}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    // These carry the full Khmer repertoire, so they are ~100 KB. Anything
    // much smaller is a Latin-only file and would print boxes.
    if (buf.length < 60_000) {
      throw new Error(`${names[i]} is only ${buf.length} bytes - that is not the Khmer face.`);
    }
    fs.writeFileSync(path.join(OUT, names[i]), buf);
    console.log(`saved ${names[i]} (${(buf.length / 1024).toFixed(0)} KB, for the printed poster)`);
  }
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
