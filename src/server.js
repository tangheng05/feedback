import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { getLocation, claimUpdate } from './db.js';
import { CATEGORY_IDS, STRINGS, pickLang, langFromHeader } from './i18n.js';
import { formPage, noticePage } from './views.js';
import { qrPng, qrSvg } from './qr.js';
import { posterHtml, posterPng } from './poster.js';
import { logoAsset, LOGO_URL, LOGO_DARK_URL } from './brand.js';
import { hashIp, clientIp, consume, schedulePurge } from './ratelimit.js';
import { submitFeedback, noticeThrottled } from './feedback.js';
import { handleCommand } from './commands.js';
import { handleCallback } from './callbacks.js';

const app = express();

// Express 4 ignores rejected promises from handlers; route them to the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));

// Pages are fully inline, so a per-response nonce is what makes the CSP meaningful.
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');

  // Turnstile also needs connect-src and frame-src, or it never yields a token.
  const cf = 'https://challenges.cloudflare.com';
  const ts = config.turnstile.enabled;
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `script-src 'nonce-${res.locals.nonce}'${ts ? ` ${cf}` : ''}`,
      `style-src 'nonce-${res.locals.nonce}'${ts ? ` ${cf}` : ''}`,
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self'${ts ? ` ${cf}` : ''}`,
      ts ? `frame-src ${cf}` : "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(
  '/fonts',
  express.static(path.join(ROOT, 'public/fonts'), {
    maxAge: '30d',
    immutable: true,
    fallthrough: true,
  })
);

/* --------------------------------------------------------------- brand logo */

// From memory, not express.static, so nothing else in public/brand/ gets published.
for (const [routePath, variant] of [[LOGO_URL, 'light'], [LOGO_DARK_URL, 'dark']]) {
  app.get(routePath, (req, res) => {
    const asset = logoAsset(variant);
    if (!asset.web) return res.status(404).send('Not found');
    res
      .type(asset.type)
      .set('Cache-Control', 'public, max-age=86400')
      .send(asset.web);
  });
}

/* ----------------------------------------------------------- customer form */

app.get('/f/:slug', (req, res) => {
  const explicitLang = Boolean(req.query.lang);
  const chosen = explicitLang
    ? pickLang(req.query.lang)
    : langFromHeader(req.headers['accept-language']);
  const t = STRINGS[chosen];
  const { nonce } = res.locals;

  const location = getLocation(req.params.slug);

  // no-store everywhere, so /on, /off and renames apply on the next scan.
  if (!location) {
    return res.status(404).type('html').set('Cache-Control', 'no-store').send(
      noticePage({ lang: chosen, nonce, heading: t.notFoundHeading, bodyText: t.notFoundBody, icon: '❓' })
    );
  }

  if (!location.active) {
    return res.status(200).type('html').set('Cache-Control', 'no-store').send(
      noticePage({ lang: chosen, nonce, heading: t.closedHeading, bodyText: t.closedBody, icon: '🕐' })
    );
  }

  res
    .status(200)
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(
      formPage({
        location,
        lang: chosen,
        nonce,
        explicitLang,
        turnstileSiteKey: config.turnstile.enabled ? config.turnstile.siteKey : '',
      })
    );
});

/* -------------------------------------------------------------- submission */

async function verifyTurnstile(token, ip) {
  if (!config.turnstile.enabled) return true;

  if (typeof token !== 'string' || token === '') {
    console.warn('[turnstile] submission arrived with no token; widget did not solve');
    return false;
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json();
    return body.success === true;
  } catch (err) {
    console.error('[turnstile] verification failed:', err.message);
    // Fail open: a Cloudflare outage shouldn't silence customers; rate limits still apply.
    return true;
  }
}

app.post('/api/feedback', wrap(async (req, res) => {
  const { slug, category, rating, message, lang, hp, elapsed, turnstile } = req.body || {};

  const location = getLocation(String(slug || ''));
  if (!location || !location.active) {
    return res.status(404).json({ error: 'errGeneric' });
  }

  if (!CATEGORY_IDS.includes(category)) {
    return res.status(400).json({ error: 'errCategory' });
  }

  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length < config.limits.messageMin) return res.status(400).json({ error: 'errShort' });
  if (text.length > config.limits.messageMax) return res.status(400).json({ error: 'errLong' });

  let stars = null;
  if (rating !== null && rating !== undefined && rating !== '') {
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) return res.status(400).json({ error: 'errGeneric' });
    stars = n;
  }

  const ip = clientIp(req);
  const ipHash = hashIp(ip);

  // Must run before any await.
  const blocked = consume(ipHash, location.slug);
  if (blocked === 'ip') {
    return res.status(429).json({ error: 'errRate' });
  }

  if (!(await verifyTurnstile(turnstile, ip))) {
    return res.status(400).json({ error: 'errGeneric' });
  }

  // Suspected bots are stored, not dropped. A missing elapsed counts as too fast.
  const secs = Number(elapsed);
  const trippedHoneypot = typeof hp === 'string' && hp.length > 0;
  const tooFast = !Number.isFinite(secs) || secs < config.limits.minFillSeconds;

  const flooded = blocked === 'location';

  const status = trippedHoneypot || tooFast ? 'quarantined' : flooded ? 'held' : 'new';
  if (status !== 'new') {
    console.warn(
      `[filter] ${location.slug} submission stored as ${status} ` +
        `(honeypot=${trippedHoneypot}, elapsed=${elapsed}, flooded=${flooded})`
    );
  }

  try {
    const ref = await submitFeedback({
      location,
      category,
      rating: stars,
      message: text,
      lang: pickLang(lang),
      status,
    });
    if (flooded) noticeThrottled(location).catch(() => {});
    return res.status(200).json({ ref });
  } catch (err) {
    console.error('[api] submission failed:', err);
    return res.status(500).json({ error: 'errGeneric' });
  }
}));

/* ------------------------------------------------------------ QR + posters */

app.get('/qr/:slug.png', wrap(async (req, res) => {
  const location = getLocation(req.params.slug);
  if (!location) return res.status(404).send('Not found');
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(await qrPng(location.slug));
}));

app.get('/qr/:slug.svg', wrap(async (req, res) => {
  const location = getLocation(req.params.slug);
  if (!location) return res.status(404).send('Not found');
  res
    .type('image/svg+xml')
    .set('Cache-Control', 'public, max-age=86400')
    .send(await qrSvg(location.slug));
}));

const posterPngCache = new Map();

app.get('/poster/:slug.png', wrap(async (req, res) => {
  const location = getLocation(req.params.slug);
  if (!location) return res.status(404).send('Not found');
  if (!posterPngCache.has(location.slug)) {
    posterPngCache.set(
      location.slug,
      await posterPng({ name: location.name, qrSvg: await qrSvg(location.slug, { margin: 0 }) })
    );
  }
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(posterPngCache.get(location.slug));
}));

// Must stay after /poster/:slug.png, which this would otherwise swallow.
app.get('/poster/:slug', wrap(async (req, res) => {
  const location = getLocation(req.params.slug);
  if (!location) return res.status(404).send('Not found');
  res
    .type('html')
    .set('Cache-Control', 'public, max-age=3600')
    .send(posterHtml({ name: location.name, qrSvg: await qrSvg(location.slug, { margin: 0 }), nonce: res.locals.nonce }));
}));

/* --------------------------------------------------------- telegram webhook */

// Hash first so timingSafeEqual gets equal lengths.
function secretMatches(received) {
  if (typeof received !== 'string') return false;
  const a = crypto.createHash('sha256').update(received).digest();
  const b = crypto.createHash('sha256').update(config.telegram.webhookSecret).digest();
  return crypto.timingSafeEqual(a, b);
}

app.post(`/tg/${config.telegram.webhookPath}`, (req, res) => {
  if (!secretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
    return res.sendStatus(401);
  }

  // Ack first: Telegram retries anything slow, and /add takes seconds.
  res.sendStatus(200);

  const update = req.body || {};

  if (!claimUpdate(update.update_id)) {
    console.warn(`[webhook] ignoring duplicate update ${update.update_id}`);
    return;
  }

  const work = update.callback_query
    ? handleCallback(update.callback_query)
    : update.message
      ? handleCommand(update.message)
      : null;

  Promise.resolve(work).catch((err) => console.error('[webhook] unhandled:', err));
});

/* -------------------------------------------------------------- misc routes */

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // body-parser errors carry their own 4xx status.
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('[express]', err);
  else console.warn(`[express] ${status} ${err.type || err.name}: ${err.message}`);

  res.status(status).json({ error: 'errGeneric' });
});

/* ------------------------------------------------------------------ startup */

schedulePurge();

const server = app.listen(config.port, config.bindHost, () => {
  console.log(`feedback server listening on ${config.bindHost}:${config.port}`);
  console.log(`public base url: ${config.baseUrl}`);
  if (config.bindHost !== '127.0.0.1' && config.bindHost !== '::1') {
    console.warn(
      `[warn] BIND_HOST=${config.bindHost} exposes this port directly, with no TLS. ` +
        'Firewall it so only your proxy can reach it.'
    );
  }
  if (!config.trustProxy) {
    console.warn(
      '[warn] TRUST_PROXY=0: X-Forwarded-For is ignored and rate limiting uses the socket ' +
        'address. Behind a reverse proxy that counts every customer as one visitor.'
    );
  } else {
    console.log(`trusting ${config.trustProxy} proxy hop(s) for the client address`);
  }
  if (config.isLocalBaseUrl) {
    console.warn('[warn] PUBLIC_BASE_URL is a local address, so any QR generated now works only on this network.');
  }
});

// Background tasks have no request to fail; log and stay up.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
