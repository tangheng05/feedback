import crypto from 'node:crypto';
import { config } from './config.js';
import { consumeRateSlot, purgeBuckets, purgeUpdates, hourBucket, now } from './db.js';

/**
 * A salted, day-scoped hash — never the IP itself.
 *
 * The date component means yesterday's hashes cannot be correlated with
 * today's. Note the honest limit of this: within a single day the salt is
 * fixed and IPv4 is only 2^32 wide, so someone holding both the database and
 * the salt could brute-force a hash back to an address. What protects the
 * customer is that these counters carry no timestamp and no link to any
 * individual message (see rate_buckets in db.js), so there is nothing to join
 * a recovered IP against.
 */
export function hashIp(ip) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash('sha256')
    .update(`${config.ipHashSalt}:${day}:${ip}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Who to rate-limit, from the request.
 *
 * Counts config.trustProxy hops back from the RIGHT of X-Forwarded-For. Each
 * proxy appends the address it received from, so the rightmost entries were
 * written by infrastructure while anything further left may have been typed
 * by the client — which is why a fixed offset from the right cannot be
 * fooled by prepending a fake address, and why the leftmost entry (the usual
 * choice) is a free bypass of the per-IP limit.
 *
 * With no proxy the header is ignored entirely: there is nothing in front to
 * have written it, so every part of it is client-supplied.
 */
export function clientIp(req) {
  const hops = config.trustProxy;
  if (hops > 0) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      // Clamp: a request that reached us with fewer hops than configured (a
      // health check straight to the port) must not read off the front.
      const ip = parts[Math.max(0, parts.length - hops)];
      if (ip) return ip;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Atomically check both limits and consume a slot.
 * Returns null when allowed, or 'ip' / 'location'.
 *
 * The per-IP counter is scoped per location: shop wifi and Cambodian mobile
 * networks put many genuine customers behind one address, and a shared budget
 * would let one busy shop's NAT lock out the shop next door.
 */
export function consume(ipHash, slug) {
  return consumeRateSlot(
    ipHash,
    slug,
    hourBucket(),
    config.limits.perIpPerHour,
    config.limits.perLocationPerHour
  );
}

/** Drop counters and update ids that are past their window. */
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
