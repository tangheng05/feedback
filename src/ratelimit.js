import crypto from 'node:crypto';
import { config } from './config.js';
import { consumeRateSlot, purgeBuckets, purgeUpdates, hourBucket, now } from './db.js';

// Salted and day-scoped so hashes can't be correlated across days.
export function hashIp(ip) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash('sha256')
    .update(`${config.ipHashSalt}:${day}:${ip}`)
    .digest('hex')
    .slice(0, 32);
}

// Read trustProxy hops from the right of X-Forwarded-For; left entries are client-controlled.
export function clientIp(req) {
  const hops = config.trustProxy;
  if (hops > 0) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      const ip = parts[Math.max(0, parts.length - hops)];
      if (ip) return ip;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Returns null when allowed, or 'ip' / 'location'.
export function consume(ipHash, slug) {
  return consumeRateSlot(
    ipHash,
    slug,
    hourBucket(),
    config.limits.perIpPerHour,
    config.limits.perLocationPerHour
  );
}

export function purgeOld() {
  const buckets = purgeBuckets(hourBucket() - 2);
  const updates = purgeUpdates(now() - 3600);
  if (buckets || updates) {
    console.log(`[purge] removed ${buckets} rate buckets, ${updates} update ids`);
  }
  return buckets + updates;
}

export function schedulePurge() {
  purgeOld();
  const timer = setInterval(purgeOld, 3600 * 1000);
  timer.unref?.();
  return timer;
}
