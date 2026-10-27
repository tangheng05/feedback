import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Precedence: shell > .env.local > .env (dotenv never overrides a set variable).
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

// Values shipped in .env.example; refuse to boot with them.
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

const baseUrl = required('PUBLIC_BASE_URL').replace(/\/+$/, '');

// https required, except local/LAN addresses for testing.
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
// Telegram's own secret_token charset.
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

// Derived from the secret, never equal to it: the path ends up in access logs.
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

  bindHost: process.env.BIND_HOST || '127.0.0.1',

  // Proxy hop count; defaults to 1 on loopback (nginx in front), else 0.
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

  brand: {
    name: process.env.BRAND_NAME || '',
    // Must be a PNG: it is also composited into the QR.
    logo: process.env.BRAND_LOGO || '',
    // Form in dark mode only; poster and QR always use logo.
    logoDark: process.env.BRAND_LOGO_DARK || '',
    color: process.env.BRAND_COLOR || '#312E81',
    accent: process.env.BRAND_ACCENT || '#C7D2FE',
    highlight: process.env.BRAND_HIGHLIGHT || '#D9F04B',
    phone: process.env.BRAND_PHONE || '',
    email: process.env.BRAND_EMAIL || '',
  },

  dbPath: path.resolve(ROOT, process.env.DB_PATH || './data/feedback.db'),
  ipHashSalt,

  limits: {
    // Per IP per location; generous because of CGNAT and shared mall wifi.
    perIpPerHour: int('RATE_PER_IP_PER_HOUR', 10),
    // Past this, submissions are stored but not pushed.
    perLocationPerHour: int('RATE_PER_LOCATION_PER_HOUR', 60),
    messageMin: 10,
    messageMax: 2000,
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
