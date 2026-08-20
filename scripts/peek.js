#!/usr/bin/env node
/**
 * Print what is actually in the database.
 *
 * Exists because the sqlite3 CLI is not installed by default on Windows, and
 * "did my complaint arrive" is the first question local testing asks.
 *
 * Usage: npm run peek           all locations + the 20 newest submissions
 *        npm run peek -- 50     the 50 newest
 */
import { db, listLocations } from '../src/db.js';
import { formUrl } from '../src/qr.js';

const limit = Number(process.argv[2]) || 20;

const locations = listLocations();
console.log(`\nLocations (${locations.length})`);
if (!locations.length) {
  console.log('  none yet — run: node scripts/seed.js "Test Shop" test 0');
} else {
  for (const l of locations) {
    console.log(`  ${l.active ? 'on ' : 'off'} ${l.slug.padEnd(14)} ${l.name.padEnd(22)} topic ${l.topic_id}`);
    console.log(`      ${formUrl(l.slug)}`);
  }
}

const rows = db
  .prepare('SELECT ref, slug, category, rating, status, delivered, lang, message, created_at FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?')
  .all(limit);

console.log(`\nFeedback (${db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n} total, newest ${rows.length})`);
if (!rows.length) console.log('  none yet');

for (const r of rows) {
  const when = new Date(r.created_at * 1000).toISOString().replace('T', ' ').slice(0, 16);
  // delivered=0 with status=new means the Telegram push failed — expected
  // locally with a fake token, and a real problem to investigate on a server.
  const push = r.delivered ? 'in telegram' : 'NOT PUSHED';
  console.log(`\n  #${r.ref}  ${when}  ${r.slug}`);
  console.log(`    ${r.category}${r.rating ? ` ${r.rating}/5` : ''} · ${r.lang} · ${r.status} · ${push}`);
  console.log(`    ${r.message.replace(/\s+/g, ' ').slice(0, 100)}`);
}
console.log('');
