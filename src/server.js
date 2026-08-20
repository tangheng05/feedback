import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { getLocation, claimUpdate } from './db.js';
import { CATEGORY_IDS, STRINGS, pickLang, langFromHeader } from './i18n.js';
import { formPage, noticePage } from './views.js';
import { qrPng, qrSvg, posterHtml } from './qr.js';
import { hashIp, clientIp, consume, schedulePurge } from './ratelimit.js';
import { submitFeedback, noticeThrottled } from './feedback.js';
import { handleCommand } from './commands.js';
import { handleCallback } from './callbacks.js';

const app = express();

/*
 * Express 4 does not adopt a rejected promise returned by a route handler.
 *
 * Without this wrapper a rejection inside an async route (a Telegram timeout, a
 * disk error) becomes an unhandled rejection, which on Node 15+ terminates the
 * process. systemd restarts us, but every request in flight at that instant is
 * lost -- including a submission the customer has already been shown a
 * reference code for. Routing it into the error middleware instead turns a
 * crash into one 500 and one log line.
 */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// One hop: nginx. The server binds to loopback only (see listen below), so
// nginx is always in the path and X-Forwarded-For is proxy-written.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));

/*
 * A per-response nonce lets the CSP allow exactly our own inline <style> and
 * <script> and nothing else. The form is entirely inline by design (one request,
 * fast first paint), so 'unsafe-inline' would be the alternative — which would
 * make the CSP decorative.
 */
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');

  /*
   * Turnstile needs more than a script-src entry: the widget opens its own
   * XHR to challenges.cloudflare.com and injects styles into the page. With
   * connect-src 'self' those requests are blocked, the widget never produces a
   * token, and /api/feedback then 400s EVERY genuine customer -- a silent
   * total outage of the form that only appears once TURNSTILE_ENABLED=true.
   * The widget propagates the nonce from its own <script> tag to the styles it
   * injects, which is why views.js stamps the nonce on that tag.
   */
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

/* ----------------------------------------------------------- customer form */

app.get('/f/:slug', (req, res) => {
  // ?lang= wins (it is an explicit choice), otherwise fall back to the phone's
  // Accept-Language. Either way the in-page toggle can override it instantly.
  const explicitLang = Boolean(req.query.lang);
  const chosen = explicitLang
    ? pickLang(req.query.lang)
    : langFromHeader(req.headers['accept-language']);
  const t = STRINGS[chosen];
  const { nonce } = res.locals;

  const location = getLocation(req.params.slug);

  // no-store on the notices too, not just the live form. A phone that scanned a
  // paused shop would otherwise keep re-showing "not accepting feedback" from
  // its own cache after the admin runs /on, and the admin has no way to tell.
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
    // The form must never be served stale: a paused or renamed location has to
    // take effect on the next scan, not whenever a phone decides to revalidate.
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

  // No token at all means the widget never rendered or never solved -- a CSP
  // or network problem on our side, not a bot. Rejecting is still correct, but
  // it looks identical to spam in the logs unless it says so.
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
    // Fail open. A Cloudflare outage should not silence real customers; the
    // rate limits are still in force underneath.
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

  // Consume a rate-limit slot BEFORE any further work, and before any await.
  // The check and the increment happen inside one synchronous transaction, so
  // a burst of concurrent requests cannot all read the same pre-increment
  // count and pass together — which is exactly the flood these limits exist
  // to stop.
  const blocked = consume(ipHash, location.slug);
  if (blocked === 'ip') {
    return res.status(429).json({ error: 'errRate' });
  }

  if (!(await verifyTurnstile(turnstile, ip))) {
    return res.status(400).json({ error: 'errGeneric' });
  }

  /*
   * Bot tells: the honeypot field, and an implausibly fast fill.
   *
   * Number(undefined) is NaN and NaN < 3 is false, so `elapsed` must be
   * validated as finite — otherwise simply omitting the field skips the check,
   * which is exactly what a hand-rolled flooder does.
   *
   * These submissions are STORED but never pushed to Telegram. A false
   * positive (a password manager filling the honeypot, a bfcache oddity) would
   * otherwise discard a real complaint behind a fake success screen; this way
   * the message is always recoverable and the reference code the customer is
   * shown is always real.
   */
  const secs = Number(elapsed);
  const trippedHoneypot = typeof hp === 'string' && hp.length > 0;
  const tooFast = !Number.isFinite(secs) || secs < config.limits.minFillSeconds;

  // Over the per-location cap, keep accepting but stop pushing, so a flood
  // cannot bury genuine complaints in the group. Nothing is ever thrown away.
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

app.get('/poster/:slug', wrap(async (req, res) => {
  const location = getLocation(req.params.slug);
  if (!location) return res.status(404).send('Not found');
  const svg = await qrSvg(location.slug);
  res
    .type('html')
    .set('Cache-Control', 'public, max-age=3600')
    .send(posterHtml({ name: location.name, slug: location.slug, svg, nonce: res.locals.nonce }));
}));

/* --------------------------------------------------------- telegram webhook */

/** Constant-time compare that doesn't leak length via an early return. */
function secretMatches(received) {
  if (typeof received !== 'string') return false;
  const a = crypto.createHash('sha256').update(received).digest();
  const b = crypto.createHash('sha256').update(config.telegram.webhookSecret).digest();
  return crypto.timingSafeEqual(a, b);
}

app.post(`/tg/${config.telegram.webhookPath}`, (req, res) => {
  // The path is a hash of the secret, not the secret itself, so an nginx access
  // log cannot yield the token Telegram signs each request with.
  if (!secretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
    return res.sendStatus(401);
  }

  // Acknowledge immediately, then work. /add takes a couple of seconds to
  // create a topic and render a QR, and Telegram retries anything slow.
  res.sendStatus(200);

  const update = req.body || {};

  // Belt and braces against a retry that slips through anyway: processing the
  // same update twice would create two forum topics for one /add.
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

  // Malformed JSON and oversized bodies arrive here already carrying their own
  // status from body-parser. Reporting those as 500 would blame the server for
  // a bad request and hide the real cause in the logs.
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('[express]', err);
  else console.warn(`[express] ${status} ${err.type || err.name}: ${err.message}`);

  res.status(status).json({ error: 'errGeneric' });
});

/* ------------------------------------------------------------------ startup */

schedulePurge();

/*
 * Loopback only.
 *
 * Binding 0.0.0.0 would leave the app reachable at http://<server-ip>:3000,
 * bypassing nginx entirely — no TLS, no body limit, and, critically, a
 * client-supplied X-Forwarded-For that makes the per-IP rate limit free to
 * defeat with a fresh fake IP per request.
 */
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`feedback server listening on 127.0.0.1:${config.port}`);
  console.log(`public base url: ${config.baseUrl}`);
});

/*
 * Floor under everything above.
 *
 * `wrap` covers the routes, but a rejection from a background task -- a
 * fire-and-forget Telegram push, a purge timer -- has no request to attach to.
 * Logging and staying up is right here: this process holds one SQLite file and
 * a webhook registration, and dying takes the form down for every shop.
 */
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
