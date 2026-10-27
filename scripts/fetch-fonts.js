#!/usr/bin/env node
/**
 * Downloads Kantumruy Pro into public/fonts/: the Khmer woff2 for the browser
 * and the TTFs resvg uses to measure poster text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts');
const TARGET = 'KhmerUI.woff2';

// Not Noto Sans Khmer: it draws ញ's subscript through its foot (បញ្ហា).
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;700&display=swap';

// Without a modern UA, Google serves legacy TTF instead of woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Pick the Khmer block by unicode-range; by position you get the Latin subset.
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

  // Latin subset is ~25 KB, Khmer ~55 KB.
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

// An ancient User-Agent makes Google serve TTF instead of woff2.
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
      'To do it by hand: open https://fonts.google.com/specimen/Kantumruy+Pro,\n' +
      `download the family, and save the Khmer woff2 as public/fonts/${TARGET}.`
  );
  process.exit(1);
});
