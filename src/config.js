import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Precedence: real shell environment > .env.local > .env
 *
 * Loaded in that order with override OFF, because dotenv never replaces a
 * variable that is already set. Order is the whole mechanism here.
 *
 * .env.local (gitignored) exists so trying the form on a laptop does not mean
 * editing -- and risking committing, or forgetting to restore -- the file that
 * carries the production bot token and the URL printed on every poster.
 *
 * The shell has to win over both, or `BIND_HOST=0.0.0.0 npm run dev` silently
 * does nothing and you debug the wrong thing for an hour.
 */
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

/*
 * Values shipped in .env.example.
 *
 * `replace_me...` is only two of the five placeholders. The dangerous one is
 * PUBLIC_BASE_URL: booting with the example domain bakes feedback.yourshop.com
 * into every QR code printed and taped to a wall, and that is not discovered
 * until a customer scans one. Fail at startup instead.
 */
const PLACEHOLDERS = new Set([
  'https://feedback.yourshop.com',
  '123456789:AAExampleTokenReplaceMe',
  '-1001234567890',
]);

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('replace_me') || PLACEHOLDERS.has(value.trim())) {
    throw new Error(
      `Env var ${name} is missing or still set to the .env.example placeholder. ` +
        'Copy .env.example to .env and fill in your own values.'
    );
  }
  return value;
}

/** Positive integers only: RATE_PER_IP_PER_HOUR=0 would 429 every customer. */
function int(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`Env var ${name} must be an integer, got "${raw}"`);
  }
  const n = Number.parseInt(raw, 10);
  if (n < min) throw new Error(`Env var ${name} must be at least ${min}, got ${n}`);
  return n;
}

// Trailing slashes here would produce "https://host//f/slug" in every QR, which
// works but looks broken to anyone reading the printed URL.
const baseUrl = required('PUBLIC_BASE_URL').replace(/\/+$/, '');

/*
 * https is required in production: Telegram will not register a webhook on
 * plain http, and this value is printed into every QR code.
 *
 * Local addresses are the deliberate exception. Testing the form on your own
 * machine, or on a phone over the LAN, has no certificate — and refusing
 * that would mean the only way to try the form at all is to deploy it.
 */
const LOCAL_ORIGIN =
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+)(:[0-9]+)?$/;
export const isLocalBaseUrl = LOCAL_ORIGIN.test(baseUrl);

if (!isLocalBaseUrl && !/^https:\/\/[^\s/]+$/.test(baseUrl)) {
  throw new Error(
    `PUBLIC_BASE_URL must be an https origin with no path, e.g. https://feedback.yourshop.com — got "${baseUrl}". ` +
      'For local testing use http://localhost:3000, or your LAN address such as http://192.168.1.20:3000.'
  );
}

const webhookSecret = required('TELEGRAM_WEBHOOK_SECRET');
// Not our restriction: Telegram's setWebhook rejects a secret_token containing
// anything outside this set, so `openssl rand -base64 32` fails at REGISTRATION
// time with an opaque error. Better to reject it here with a usable message.
if (!/^[A-Za-z0-9_-]{24,256}$/.test(webhookSecret)) {
  throw new Error(
    'TELEGRAM_WEBHOOK_SECRET must be 24-256 characters of A-Z a-z 0-9 _ - only ' +
      '(Telegram rejects anything else, so base64 with +/= will not work). ' +
      'Generate one with: openssl rand -hex 24'
  );
}

const ipHashSalt = required('IP_HASH_SALT');
if (ipHashSalt.length < 24) {
  throw new Error('IP_HASH_SALT must be at least 24 characters. Generate: openssl rand -hex 32');
}

/*
 * The webhook URL path is DERIVED from the secret, never equal to it.
 *
 * nginx writes the request path to its access log on every delivery. If the
 * path were the secret, that log would hand an attacker everything needed to
 * forge admin commands. Hashing gives one value to manage in .env and two
 * unrelated values on the wire: leaking the path reveals nothing about the
 * header token Telegram signs each request with.
 */
const webhookPath = crypto.createHash('sha256').update(`path:${webhookSecret}`).digest('hex').slice(0, 32);

const groupId = required('TELEGRAM_GROUP_ID');
if (!/^-\d+$/.test(groupId.trim())) {
  throw new Error(
    `TELEGRAM_GROUP_ID must be the negative numeric chat id (it starts with -100), got "${groupId}". ` +
      'See deploy/DEPLOY.md step 4.'
  );
}

export const config = {
  baseUrl,
  isLocalBaseUrl,
  port: int('PORT', 3000),

  /*
   * Loopback in production: nginx must be the only way in, or a client writes
   * its own X-Forwarded-For and the per-IP rate limit is free to defeat.
   * Set BIND_HOST=0.0.0.0 ONLY to reach the form from a phone on your own LAN
   * while testing — server.js stops trusting proxy headers when you do.
   */
  bindHost: process.env.BIND_HOST || '127.0.0.1',

  /*
   * How many proxies sit in front of us, i.e. how far to count back from the
   * right of X-Forwarded-For to find the customer.

   * Counting from the RIGHT is what makes this safe. Each proxy appends the
   * address it received from, so the rightmost entries are written by
   * infrastructure and the leftmost can be anything the client typed. Taking
   * the leftmost would let anyone mint a fresh IP per request and walk past
   * the per-IP limit; counting back a fixed number of hops cannot be fooled by
   * prepending junk.
   *
   *   0  no proxy      trust nothing, use the socket address
   *   1  nginx / NPM alone
   *   2  Cloudflare (orange cloud) in front of nginx / NPM
   *
   * Both mistakes hurt: too high and one forged entry becomes the identity,
   * too low and every customer collapses onto the proxy's own address and the
   * tenth submission of the hour locks out a whole shop.
   *
   * Defaults to 1 when bound to loopback (nginx is necessarily in front), 0
   * otherwise. `true` and `false` are accepted as 1 and 0.
   */
  trustProxy: (() => {
    const raw = (process.env.TRUST_PROXY || '').trim().toLowerCase();
    if (raw === '') {
      const bind = process.env.BIND_HOST || '127.0.0.1';
      return bind === '127.0.0.1' || bind === '::1' ? 1 : 0;
    }
    if (raw === 'true') return 1;
    if (raw === 'false') return 0;
    if (!/^\d+$/.test(raw)) {
      throw new Error(`TRUST_PROXY must be a hop count, or true/false. Got "${process.env.TRUST_PROXY}".`);
    }
    return Number.parseInt(raw, 10);
  })(),

  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    groupId: groupId.trim(),
    webhookSecret,
    webhookPath,
  },

  /*
   * Branding shown on the poster and at the top of the customer form.
   *
   * These are BRAND-level, shared by every shop: the logo and company name do
   * not change when you /add a location. The per-location name comes from the
   * command and is rendered alongside them, so one poster reads
   * "<brand> " + DASH + " <this shop>".
   *
   * All optional. Empty values simply drop that element from the layout
   * rather than leaving a gap or a broken image.
   */
  brand: {
    name: process.env.BRAND_NAME || '',

    // A PNG placed in public/brand/. PNG specifically, not SVG: the same file
    // is composited into the centre of the raster QR, which means it has to be
    // decodable as pixels without a rasteriser.
    logo: process.env.BRAND_LOGO || '',

    // Optional second file for dark backgrounds, used only by the form when
    // the customer's phone is in dark mode. The poster and the QR's white
    // plate always use BRAND_LOGO -- a pale logo composited into the code
    // would leave a blank hole in the middle of it.
    logoDark: process.env.BRAND_LOGO_DARK || '',

    // Poster colours. Defaults are a deep indigo field with a warm accent,
    // legible in print and safely away from the QR's own black-on-white.
    color: process.env.BRAND_COLOR || '#312E81',
    accent: process.env.BRAND_ACCENT || '#C7D2FE',
    highlight: process.env.BRAND_HIGHLIGHT || '#D9F04B',

    // Optional contact lines under the QR. Left off unless you set them.
    phone: process.env.BRAND_PHONE || '',
    email: process.env.BRAND_EMAIL || '',
  },


  dbPath: path.resolve(ROOT, process.env.DB_PATH || './data/feedback.db'),
  ipHashSalt,

  limits: {
    // Per IP *per location*. Generous because Cambodian mobile networks use
    // CGNAT and mall wifi is one NAT — many real customers share an address.
    perIpPerHour: int('RATE_PER_IP_PER_HOUR', 10),
    // Beyond this, submissions are still stored but their Telegram push is
    // suppressed, so a flood cannot bury genuine complaints in the group.
    perLocationPerHour: int('RATE_PER_LOCATION_PER_HOUR', 60),
    messageMin: 10,
    messageMax: 2000,
    // A human cannot read the page, pick a category and type ten characters in
    // under three seconds. Bots submit instantly.
    minFillSeconds: 3,
  },

  turnstile: {
    enabled: process.env.TURNSTILE_ENABLED === 'true',
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
  },
};

if (config.turnstile.enabled && (!config.turnstile.siteKey || !config.turnstile.secretKey)) {
  throw new Error('TURNSTILE_ENABLED=true but TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY are empty.');
}
