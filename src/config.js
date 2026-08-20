import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
if (!/^https:\/\/[^\s/]+$/.test(baseUrl)) {
  throw new Error(
    `PUBLIC_BASE_URL must be an https origin with no path, e.g. https://feedback.yourshop.com — got "${baseUrl}". ` +
      'Telegram refuses to register a webhook on plain http, and the QR is printed with this value.'
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
  port: int('PORT', 3000),

  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    groupId: groupId.trim(),
    webhookSecret,
    webhookPath,
  },

  // Timestamps in Telegram should read in shop-local time, not UTC.
  displayTimezone: process.env.DISPLAY_TIMEZONE || 'Asia/Phnom_Penh',

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
