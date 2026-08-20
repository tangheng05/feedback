import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

// WAL keeps reads from blocking the write that happens on every submission.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    slug        TEXT PRIMARY KEY,
    name        TEXT    NOT NULL,
    topic_id    INTEGER NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ref           TEXT    NOT NULL UNIQUE,
    slug          TEXT    NOT NULL REFERENCES locations(slug) ON UPDATE CASCADE,
    category      TEXT    NOT NULL,
    rating        INTEGER,
    message       TEXT    NOT NULL,
    lang          TEXT    NOT NULL DEFAULT 'en',
    -- new | progress | resolved            (reached Telegram)
    -- held                                 (stored, push suppressed by the flood cap)
    -- quarantined                          (stored, looked automated)
    status        TEXT    NOT NULL DEFAULT 'new',
    delivered     INTEGER NOT NULL DEFAULT 0,
    tg_message_id INTEGER,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_slug_time ON feedback(slug, created_at);

  /*
   * Rate limiting counters.
   *
   * Deliberately an hour BUCKET with a count, not one row per submission. A
   * per-submission row carrying a timestamp would sit milliseconds away from
   * its feedback row and be trivially joinable back to it, which would undo
   * the anonymity the form promises. A bucket counter cannot be correlated
   * with any individual message.
   */
  CREATE TABLE IF NOT EXISTS rate_buckets (
    ip_hash TEXT    NOT NULL,
    slug    TEXT    NOT NULL,
    bucket  INTEGER NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip_hash, slug, bucket)
  );
  CREATE INDEX IF NOT EXISTS idx_rate_bucket ON rate_buckets(bucket);
  CREATE INDEX IF NOT EXISTS idx_rate_slug   ON rate_buckets(slug, bucket);

  -- Telegram retries deliveries. Without this, one retried /add creates two topics.
  CREATE TABLE IF NOT EXISTS seen_updates (
    update_id INTEGER PRIMARY KEY,
    seen_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_cache (
    user_id    INTEGER PRIMARY KEY,
    is_admin   INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
  );

  -- Superseded by rate_buckets: it stored a timestamp per submission.
  DROP TABLE IF EXISTS rate_hits;
`);

// Older databases predate these columns; ignore the error when they exist.
for (const alter of [
  'ALTER TABLE feedback ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0',
]) {
  try {
    db.exec(alter);
  } catch {
    /* column already present */
  }
}

export const now = () => Math.floor(Date.now() / 1000);
export const hourBucket = (ts = now()) => Math.floor(ts / 3600);

/* ---------------------------------------------------------------- locations */

const stmts = {
  getLocation: db.prepare('SELECT * FROM locations WHERE slug = ?'),
  listLocations: db.prepare('SELECT * FROM locations ORDER BY created_at'),
  insertLocation: db.prepare(
    'INSERT INTO locations (slug, name, topic_id, active, created_at) VALUES (?, ?, ?, 1, ?)'
  ),
  renameLocation: db.prepare('UPDATE locations SET name = ? WHERE slug = ?'),
  setActive: db.prepare('UPDATE locations SET active = ? WHERE slug = ?'),
  setTopicId: db.prepare('UPDATE locations SET topic_id = ? WHERE slug = ?'),
  deleteLocation: db.prepare('DELETE FROM locations WHERE slug = ?'),

  insertFeedback: db.prepare(`
    INSERT INTO feedback (ref, slug, category, rating, message, lang, status, created_at)
    VALUES (@ref, @slug, @category, @rating, @message, @lang, @status, @created_at)
  `),
  markDelivered: db.prepare('UPDATE feedback SET delivered = 1, tg_message_id = ? WHERE id = ?'),
  getFeedbackByRef: db.prepare('SELECT * FROM feedback WHERE ref = ?'),
  setStatus: db.prepare('UPDATE feedback SET status = ? WHERE ref = ?'),
  listPending: db.prepare(`
    SELECT * FROM feedback
    WHERE delivered = 0 AND (@slug IS NULL OR slug = @slug)
    ORDER BY created_at
    LIMIT @limit
  `),
  countPending: db.prepare(
    'SELECT COUNT(*) AS n FROM feedback WHERE delivered = 0 AND (@slug IS NULL OR slug = @slug)'
  ),

  ipBucketCount: db.prepare(
    'SELECT count AS n FROM rate_buckets WHERE ip_hash = ? AND slug = ? AND bucket = ?'
  ),
  locBucketCount: db.prepare(
    'SELECT COALESCE(SUM(count), 0) AS n FROM rate_buckets WHERE slug = ? AND bucket = ?'
  ),
  bumpBucket: db.prepare(`
    INSERT INTO rate_buckets (ip_hash, slug, bucket, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(ip_hash, slug, bucket) DO UPDATE SET count = count + 1
  `),
  purgeBuckets: db.prepare('DELETE FROM rate_buckets WHERE bucket < ?'),

  seenUpdate: db.prepare('INSERT OR IGNORE INTO seen_updates (update_id, seen_at) VALUES (?, ?)'),
  purgeUpdates: db.prepare('DELETE FROM seen_updates WHERE seen_at < ?'),

  getAdminCache: db.prepare('SELECT * FROM admin_cache WHERE user_id = ?'),
  setAdminCache: db.prepare(
    `INSERT INTO admin_cache (user_id, is_admin, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET is_admin = excluded.is_admin,
                                        checked_at = excluded.checked_at`
  ),

  stats: db.prepare(`
    SELECT l.slug, l.name, l.active,
           COUNT(f.id)                                            AS total,
           SUM(CASE WHEN f.status = 'new'      THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN f.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN f.delivered = 0       THEN 1 ELSE 0 END) AS undelivered,
           AVG(f.rating)                                          AS avg_rating
    FROM locations l
    LEFT JOIN feedback f ON f.slug = l.slug AND f.created_at > ?
    GROUP BY l.slug
    ORDER BY total DESC, l.created_at
  `),
};

export const getLocation = (slug) => stmts.getLocation.get(slug);
export const listLocations = () => stmts.listLocations.all();
export const renameLocation = (slug, name) => stmts.renameLocation.run(name, slug);
export const setLocationActive = (slug, active) => stmts.setActive.run(active ? 1 : 0, slug);
export const statsSince = (sinceTs) => stmts.stats.all(sinceTs);

/**
 * Reserve a slug before the forum topic exists.
 *
 * /add has to await Telegram in the middle, and two admins running it at the
 * same moment would both pass a pre-await uniqueness check, both create a
 * topic, and the loser would then crash on the UNIQUE constraint — leaving an
 * orphaned empty topic behind. Claiming the row first makes the slug the lock:
 * the loser fails immediately, before creating anything.
 *
 * Returns null if the slug is already taken.
 */
export function reserveLocation({ slug, name }) {
  try {
    stmts.insertLocation.run(slug, name, 0, now());
    return getLocation(slug);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return null;
    throw err;
  }
}

export const setLocationTopic = (slug, topicId) => stmts.setTopicId.run(topicId, slug);
export const deleteLocation = (slug) => stmts.deleteLocation.run(slug);

/* ----------------------------------------------------------------- feedback */

// Crockford-style base32: no I/L/O/U, so a reference code read aloud or copied
// off a phone screen by a staff member can't be mistyped as a different code.
const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function makeRef() {
  // 256 % 32 === 0, so the modulo introduces no bias.
  const bytes = crypto.randomBytes(5);
  let out = '';
  for (const b of bytes) out += REF_ALPHABET[b % REF_ALPHABET.length];
  return out;
}

export function insertFeedback(entry) {
  // 32^5 ~ 33M codes; collisions are vanishingly rare but cheap to retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = makeRef();
    try {
      // One timestamp, returned to the caller. Computing it twice lets the
      // originally sent message and the edited one (which re-reads the row)
      // straddle a second boundary and display different minutes.
      const created_at = now();
      const info = stmts.insertFeedback.run({ status: 'new', ...entry, ref, created_at });
      return { id: info.lastInsertRowid, ref, created_at };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Could not allocate a unique feedback reference after 5 attempts');
}

export const markDelivered = (id, messageId) => stmts.markDelivered.run(messageId, id);
export const listPending = (slug = null, limit = 20) => stmts.listPending.all({ slug, limit });
export const countPending = (slug = null) => stmts.countPending.get({ slug }).n;
export const getFeedbackByRef = (ref) => stmts.getFeedbackByRef.get(ref);
export const setFeedbackStatus = (ref, status) => stmts.setStatus.run(status, ref);

/* ------------------------------------------------------------ rate limiting */

/**
 * Check both limits and consume a slot in ONE synchronous transaction.
 *
 * This must not be split into a separate check and record: an `await` between
 * them lets every request in a concurrent burst read the same pre-increment
 * count, pass, and insert — which defeats both limits completely under exactly
 * the flood they exist to stop.
 *
 * Returns null when allowed, or 'ip' / 'location' naming the limit that fired.
 */
export const consumeRateSlot = db.transaction((ipHash, slug, bucket, ipMax, locMax) => {
  const ipCount = stmts.ipBucketCount.get(ipHash, slug, bucket)?.n ?? 0;
  if (ipCount >= ipMax) return 'ip';

  // Consume BEFORE the location check, not after.
  //
  // Returning 'location' without incrementing would freeze the per-IP counter
  // for as long as the flood cap is engaged — so once a handful of addresses
  // filled the location bucket, any single IP could write unbounded rows to
  // disk for the rest of the hour with nothing counting them. Suppressing the
  // Telegram push must not also suspend the per-IP limit.
  stmts.bumpBucket.run(ipHash, slug, bucket);

  const locCount = stmts.locBucketCount.get(slug, bucket)?.n ?? 0;
  // The row just written is included, hence >.
  if (locCount > locMax) return 'location';

  return null;
});

export const purgeBuckets = (beforeBucket) => stmts.purgeBuckets.run(beforeBucket).changes;

/* ------------------------------------------------------------ update dedup */

/** True the first time an update_id is seen, false for a Telegram retry. */
export function claimUpdate(updateId) {
  if (typeof updateId !== 'number') return true;
  return stmts.seenUpdate.run(updateId, now()).changes === 1;
}

export const purgeUpdates = (before) => stmts.purgeUpdates.run(before).changes;

/* -------------------------------------------------------------- admin cache */

export const getAdminCache = (userId) => stmts.getAdminCache.get(userId);
export const setAdminCache = (userId, isAdmin) =>
  stmts.setAdminCache.run(userId, isAdmin ? 1 : 0, now());
