import { STRINGS, CATEGORIES } from './i18n.js';
import { logoUrl, logoDarkUrl, hasDarkLogo } from './brand.js';
import { config } from './config.js';

/**
 * Self-hosted Noto Sans Khmer, inlined rather than linked.
 *
 * A separate stylesheet would be a render-blocking round trip before any Khmer
 * can paint — on slow mobile data that is the difference between a form that
 * appears instantly and one that flashes blank. Inlining also lets the page run
 * under a nonce-only style-src with no 'self' escape hatch.
 *
 * ONE file, `font-weight: 400 700`: the Khmer subset is a variable font
 * covering the whole range. The unicode-range confines it to Khmer, so English
 * renders in the device's own UI font — which looks native and costs 0 bytes.
 *
 * Not a Google Fonts CDN link: that request is often the slowest thing on the
 * page in Cambodia, and if it stalls the customer stares at invisible text.
 */
export const fontFaceCss = `
  @font-face {
    font-family: 'Noto Sans Khmer';
    font-style: normal;
    font-weight: 400 700;
    font-display: swap;
    src: url('/fonts/NotoSansKhmer.woff2') format('woff2');
    unicode-range: U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC;
  }
`;

/**
 * JSON for embedding inside a <script> block.
 *
 * An HTML parser ends the script at the first literal `</`, wherever it sits,
 * so a string containing `</script>` would close the block early and inject
 * the rest as markup. U+2028/2029 are line terminators to older JS parsers and
 * break the literal outright. Every string here is ours today, but this is the
 * one place where a translator's text becomes executable page source.
 */
const json = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Khmer script stacks subscript consonants (coeng) below the baseline, so a
 * normal 1.4-1.5 line-height clips them — the `.low` coeng forms reach roughly
 * -0.6em. Everything here sits on a 1.9 floor.
 *
 * English does not need that much air and looks slack at 1.9, so it is tightened
 * per-language via `html[lang="en"]`. `applyLang` already maintains
 * documentElement.lang, so this costs no extra JavaScript.
 */
const baseCss = `
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }

  :root {
    --bg: #ffffff;
    --card: #ffffff;
    --field: #ffffff;
    --fg: #0a0a0a;
    --muted: #5c5c5c;
    --line: #e5e5e5;
    /* Interactive boundaries need 3:1 (WCAG 1.4.11). The decorative --line is
       far below that, so controls get their own heavier token. */
    --border: #8a8a8a;
    /* Black is the accent. With no colour left to carry emphasis, weight and
       contrast have to do it, which is why the send button is solid black and
       every other control stays outlined. */
    --accent: #0a0a0a;
    --accent-fg: #ffffff;
    --accent-soft: #f4f4f4;
    --accent-line: #0a0a0a;
    --star: #0a0a0a;
    /* Errors keep their colour. Red is the one thing on this page that must
       not read as ordinary UI. */
    --danger: #b3261e;
    --focus: #0a0a0a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000;
      --card: #0d0d0d;
      --field: #0d0d0d;
      --fg: #fafafa;
      --muted: #a1a1a1;
      --line: #262626;
      --border: #7a7a7a;
      --accent: #fafafa;
      --accent-fg: #0a0a0a;
      --accent-soft: #1c1c1c;
      --accent-line: #fafafa;
      --star: #fafafa;
      --danger: #f2837c;
      --focus: #fafafa;
    }
  }

  body {
    margin: 0;
    font-family: 'Noto Sans Khmer', 'Khmer OS', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.9;
    background: var(--bg);
    color: var(--fg);
    -webkit-font-smoothing: antialiased;
  }
  html[lang="en"] body { line-height: 1.55; }

  .wrap {
    max-width: 34rem;
    margin: 0 auto;
    /* viewport-fit=cover is set, so the insets must actually be consumed or the
       notch sits over the content in landscape. */
    padding: 1rem max(1rem, env(safe-area-inset-right))
             calc(2rem + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  }

  /* iOS zooms the page when a focused field is under 16px. */
  input, textarea, select, button { font-size: max(16px, 1rem); }

  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
`;

function shell({ lang, title, body, css = '', script = '', head = '', nonce = '' }) {
  const n = nonce ? ` nonce="${esc(nonce)}"` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">
<link rel="icon" href="data:,">
<link rel="preload" as="font" type="font/woff2" href="/fonts/NotoSansKhmer.woff2" crossorigin>
<title>${esc(title)}</title>
<style${n}>${fontFaceCss}${baseCss}${css}</style>
${head}
</head>
<body>
<div class="wrap">${body}</div>
${script ? `<script${n}>${script}</script>` : ''}
</body>
</html>`;
}

/* --------------------------------------------------------------------- form */

const formCss = `
  header {
    display: flex; align-items: center; gap: .75rem;
    padding: .5rem 0 .875rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 1.25rem;
  }
  /* Logo and names, so a customer can see at a glance they scanned the right
     shop's code and not a sticker someone else put on the wall. */
  .shop { flex: 1; display: flex; align-items: center; gap: .5rem; min-width: 0; }
  .shop .logo { height: 28px; width: auto; max-width: 88px; object-fit: contain; flex: none; }
  /* Only one of the pair is ever displayed. Both are inlined as data URIs, so
     the hidden one costs no request - just bytes already in the HTML. */
  .shop .logo.dark { display: none; }
  @media (prefers-color-scheme: dark) {
    .shop .logo.light { display: none; }
    .shop .logo.dark { display: block; }
  }
  .shop .names { display: flex; flex-direction: column; min-width: 0; }
  .shop .brand { font-size: .75rem; font-weight: 600; color: var(--muted);
                 letter-spacing: .04em; text-transform: uppercase; line-height: 1.4; }
  .shop .place { font-size: 1.0625rem; font-weight: 700; letter-spacing: -.01em;
                 line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .langtoggle {
    display: flex; align-items: stretch; flex: none;
    border: 1px solid var(--border); border-radius: 999px; overflow: hidden;
  }
  .langtoggle button {
    font: inherit; font-size: .8125rem;
    display: flex; align-items: center; padding: 0 1rem; min-height: 44px;
    border: 0; background: transparent; color: var(--muted); cursor: pointer;
    transition: background .12s ease, color .12s ease;
  }
  .langtoggle button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }

  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 1.5rem 1.25rem;
    box-shadow: 0 1px 2px rgb(24 24 27 / .04), 0 12px 28px -14px rgb(24 24 27 / .16);
  }
  @media (prefers-color-scheme: dark) { .card { box-shadow: none; } }

  h1 {
    font-size: clamp(1.25rem, 5vw, 1.5rem);
    font-weight: 700; letter-spacing: -.01em;
    margin: 0 0 .75rem;
  }
  html[lang="en"] h1 { line-height: 1.25; }


  fieldset { border: 0; margin: 0 0 1.75rem; padding: 0; }
  legend { padding: 0; font-size: .8125rem; font-weight: 600; margin-bottom: .625rem; }
  legend .opt { font-weight: 400; color: var(--muted); }

  .chips {
    display: flex; flex-wrap: wrap; gap: .5rem;
    /* The hidden radios are absolutely positioned; without a positioned
       ancestor they resolve against the page and keyboard focus scroll-jumps
       to the top. */
    position: relative;
  }
  .chips input { position: absolute; opacity: 0; pointer-events: none; }
  .chips label {
    display: inline-flex; align-items: center; padding: 0 1rem;
    border: 1px solid var(--border); border-radius: 999px; cursor: pointer;
    font-size: .9375rem; user-select: none;
    /* 44px minimum touch target — used one-handed, standing in a shop. */
    min-height: 44px;
    transition: background .12s ease, border-color .12s ease, transform .06s ease;
  }
  .chips label:active { transform: scale(.98); }
  .chips input:checked + label {
    background: var(--accent-soft); border-color: var(--accent-line); font-weight: 600;
  }
  .chips input:focus-visible + label { outline: 2px solid var(--focus); outline-offset: 2px; }
  .chips.invalid label { border-color: var(--danger); }

  .stars { display: flex; gap: .25rem; }
  .stars button {
    font-size: 2rem; line-height: 1; background: none; border: 0; cursor: pointer;
    padding: .25rem; color: var(--muted); transition: color .1s, transform .06s ease;
    min-width: 44px; min-height: 44px;
  }
  .stars button:active { transform: scale(.9); }
  .stars button.on { color: var(--star); }

  textarea {
    width: 100%; min-height: 8.5rem; padding: .75rem;
    font: inherit; line-height: inherit; color: var(--fg); background: var(--field);
    border: 1px solid var(--border); border-radius: 12px;
    /* No resize handle exists on touch anyway; the field auto-grows instead. */
    resize: none; overflow-y: auto;
  }
  .count { text-align: right; font-size: .75rem; color: var(--muted); margin-top: .25rem; }
  .count[hidden] { display: none; }

  button.send {
    width: 100%; padding: .9rem; font: inherit; font-weight: 600;
    border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-fg);
    cursor: pointer; min-height: 52px;
    position: sticky; bottom: calc(.75rem + env(safe-area-inset-bottom)); z-index: 1;
    transition: opacity .12s ease, transform .06s ease;
  }
  button.send:active { transform: scale(.99); }
  button.send[disabled] { opacity: .55; cursor: default; }

  /* Stays in the DOM even when empty: role="alert" on a display:none element is
     removed from the accessibility tree, and inserting the region and its text
     in the same frame is unreliable in VoiceOver and NVDA. An empty <p> with
     zero margin contributes no height. */
  .err { color: var(--danger); font-size: .875rem; margin: 0; }
  /* "Checking, one moment" is progress, not a failure. Red would tell the
     customer their complaint was rejected while it is still being sent. */
  .err[data-tone="info"] { color: var(--muted); }
  .err:not(:empty) { margin: 0 0 .75rem; }

  .foot { color: var(--muted); font-size: .75rem; margin: 1rem .25rem 0; text-align: center; }
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

  .done { text-align: center; padding: 1rem 0; }
  .done:focus { outline: none; }
  .done .tick {
    width: 64px; height: 64px; margin: 0 auto .75rem; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent);
    display: grid; place-items: center; font-size: 2rem; line-height: 1;
  }
  .done .ref {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 1.5rem; font-weight: 700; letter-spacing: .15em; margin: 0;
  }
  .done .reflabel { margin: 1.5rem 0 .25rem; font-size: .75rem; color: var(--muted); }
  .done .refhelp, .done .closetab { font-size: .75rem; color: var(--muted); margin-top: .5rem; }
`;


export function formPage({ location, lang, turnstileSiteKey, explicitLang, nonce }) {
  const t = STRINGS[lang];

  const chips = CATEGORIES.map(
    (c) =>
      `<input type="radio" name="category" id="c-${c.id}" value="${c.id}">` +
      `<label for="c-${c.id}" data-en="${esc(c.en)}" data-km="${esc(c.km)}">${esc(c[lang])}</label>`
  ).join('\n        ');

  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<button type="button" role="radio" aria-checked="false" tabindex="${n === 1 ? 0 : -1}" ` +
        `data-star="${n}">☆</button>`
    )
    .join('');

  /*
   * method/action are set even though JS always intercepts.
   *
   * Without them the default is GET to the current URL, so if the script fails
   * to run — data-saver proxy, an old browser, a CSP change — pressing Send
   * would put the customer's anonymous complaint into the query string, the
   * browser history and the nginx access log. POST to a path with no POST
   * handler gives a clean 404 and leaks nothing.
   */
  const body = `
<header>
  <div class="shop">
    ${
      logoUrl()
        ? hasDarkLogo()
          // Two <img> swapped by CSS rather than one src chosen on the server:
          // the theme is the phone's, and it can change after the page is
          // served (system theme switching at sunset, for one).
          ? `<img class="logo light" src="${logoUrl()}" alt="">` +
            `<img class="logo dark" src="${logoDarkUrl()}" alt="">`
          : `<img class="logo" src="${logoUrl()}" alt="">`
        : ''
    }
    <div class="names">
      ${config.brand.name ? `<span class="brand">${esc(config.brand.name)}</span>` : ''}
      <span class="place">${esc(location.name)}</span>
    </div>
  </div>
  <div class="langtoggle" role="group" data-t-aria="langLabel" aria-label="${esc(t.langLabel)}">
    <button type="button" data-lang="km" aria-pressed="${lang === 'km'}">ខ្មែរ</button>
    <button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
  </div>
</header>

<main class="card" id="main">
  <h1 data-t="heading">${esc(t.heading)}</h1>

  <noscript>
    <p class="err" style="margin-bottom:.75rem">${esc(t.needJs)}</p>
  </noscript>

  <form id="form" novalidate method="post" action="/f/${esc(location.slug)}">
    <fieldset>
      <legend data-t="categoryLabel">${esc(t.categoryLabel)}</legend>
      <div class="chips">
        ${chips}
      </div>
    </fieldset>

    <fieldset>
      <legend id="ratelabel">
        <span data-t="ratingLabel">${esc(t.ratingLabel)}</span>
        <span class="opt">(<span data-t="ratingOptional">${esc(t.ratingOptional)}</span>)</span>
      </legend>
      <div class="stars" id="stars" role="radiogroup" aria-labelledby="ratelabel">${stars}</div>
      <span id="starstatus" class="sr-only" aria-live="polite"></span>
    </fieldset>

    <fieldset>
      <legend data-t="messageLabel">${esc(t.messageLabel)}</legend>
      <textarea id="message" name="message" maxlength="2000" autocapitalize="sentences"
                enterkeyhint="enter" placeholder="${esc(t.messagePlaceholder)}"></textarea>
      <div class="count" id="countwrap" hidden>
        <span id="count">2000</span> <span data-t="charsLeft">${esc(t.charsLeft)}</span>
      </div>
    </fieldset>

    <!-- Honeypot: invisible to humans, irresistible to naive bots. -->
    <div class="hp" aria-hidden="true">
      <label>Leave this empty<input type="text" name="url_confirm_2" tabindex="-1" autocomplete="off"></label>
    </div>
${turnstileSiteKey ? `    <div class="cf-turnstile" data-sitekey="${esc(turnstileSiteKey)}"></div>\n` : ''}
    <p class="err" id="err" role="alert" aria-atomic="true"></p>
    <button type="submit" class="send" data-t="send">${esc(t.send)}</button>
  </form>
</main>
`;

  // Both language tables ship inside the page so the toggle is instant. A
  // round-trip just to switch language would be painful on slow mobile data,
  // and the extra payload is under 2 KB.
  const script = `
const S = ${json({ en: STRINGS.en, km: STRINGS.km })};
const SLUG = ${json(location.slug)};
const EXPLICIT = ${json(Boolean(explicitLang))};
const HAS_TURNSTILE = ${json(Boolean(turnstileSiteKey))};
const MAX = 2000;
const OPENED = Date.now();
let lang = ${json(lang)};
let rating = 0;

const $ = (sel) => document.querySelector(sel);
const err = $('#err');
const msg = $('#message');
const btn = $('.send');

/* ---------------------------------------------------------------- language */

function applyLang(next) {
  if (!S[next]) return;
  lang = next;
  const t = S[lang];
  document.documentElement.lang = t.htmlLang;
  document.title = t.title;

  for (const el of document.querySelectorAll('[data-t]')) {
    const key = el.dataset.t;
    if (t[key] !== undefined) el.textContent = t[key];
  }
  for (const el of document.querySelectorAll('[data-t-aria]')) {
    const key = el.dataset.tAria;
    if (t[key] !== undefined) el.setAttribute('aria-label', t[key]);
  }
  for (const el of document.querySelectorAll('.chips label')) {
    el.textContent = el.dataset[lang];
  }
  if (msg) msg.placeholder = t.messagePlaceholder;
  for (const b of document.querySelectorAll('.langtoggle button')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }
  paintStars();
  try { localStorage.setItem('fb_lang', lang); } catch (e) {}
}

for (const b of document.querySelectorAll('.langtoggle button')) {
  b.addEventListener('click', () => applyLang(b.dataset.lang));
}

// An explicit ?lang= is a deliberate choice and outranks the stored one —
// otherwise handing someone a ?lang=km link does nothing if that phone once
// picked EN.
try {
  if (EXPLICIT) {
    localStorage.setItem('fb_lang', lang);
  } else {
    const saved = localStorage.getItem('fb_lang');
    if (saved && saved !== lang) applyLang(saved);
  }
} catch (e) {}

/* ------------------------------------------------------------------- stars */

function paintStars() {
  const t = S[lang];
  for (const b of document.querySelectorAll('#stars button')) {
    const n = Number(b.dataset.star);
    const on = n <= rating;
    b.classList.toggle('on', on);
    // The glyph changes too, so the rating never depends on colour alone.
    b.textContent = on ? '\\u2605' : '\\u2606';
    b.setAttribute('aria-checked', String(n === rating));
    b.tabIndex = n === (rating || 1) ? 0 : -1;
    b.setAttribute('aria-label', t.starN.replace('{n}', n));
  }
  const status = $('#starstatus');
  if (status) {
    status.textContent = rating ? t.starsSet.replace('{n}', rating) : '';
  }
}

function setRating(n) {
  // Tapping the same star again clears it. The rating is optional, so there
  // has to be a way back to "no answer" after a mis-tap.
  rating = rating === n ? 0 : n;
  paintStars();
  if (!rating) $('#starstatus').textContent = S[lang].starsCleared;
}

for (const b of document.querySelectorAll('#stars button')) {
  b.addEventListener('click', () => setRating(Number(b.dataset.star)));
}

$('#stars').addEventListener('keydown', (e) => {
  const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!delta) return;
  e.preventDefault();
  rating = Math.min(5, Math.max(1, (rating || 0) + delta));
  paintStars();
  const active = document.querySelector('#stars button[tabindex="0"]');
  if (active) active.focus();
});

/* ---------------------------------------------------------------- textarea */

function grow() {
  msg.style.height = 'auto';
  msg.style.height = Math.min(msg.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}

function updateCount() {
  const left = MAX - msg.value.length;
  $('#count').textContent = left;
  // Only meaningful when they're close to it, and a character count means very
  // little in Khmer where one syllable is several UTF-16 units.
  $('#countwrap').hidden = left > 300;
}

msg.addEventListener('input', () => { updateCount(); grow(); });

/* ------------------------------------------------------------------ errors */

function setErr(key, tone) {
  if (key) {
    err.dataset.t = key;
    // 'info' is progress text, not a rejection; the CSS greys it out.
    if (tone) err.dataset.tone = tone; else delete err.dataset.tone;
    err.textContent = S[lang][key] || S[lang].errGeneric;
  } else {
    delete err.dataset.t;
    delete err.dataset.tone;
    err.textContent = '';
  }
}

function resetButton() {
  btn.disabled = false;
  btn.dataset.t = 'send';
  btn.textContent = S[lang].send;
}

function fail(key) {
  setErr(S[lang][key] ? key : 'errGeneric');
  resetButton();
}

/* ------------------------------------------------------------------ submit */

const tsToken = () => {
  const el = document.querySelector('[name=cf-turnstile-response]');
  return (el && el.value) || '';
};

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setErr('');

  const category = $('.chips input:checked');
  if (!category) {
    setErr('errCategory');
    // The chips are far above the fold behind the keyboard; an error pointing
    // at something off-screen is the most likely point of abandonment.
    const group = document.querySelector('.chips');
    group.classList.add('invalid');
    group.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (msg.value.trim().length < 10) {
    setErr('errShort');
    msg.focus();
    return;
  }

  btn.disabled = true;
  btn.dataset.t = 'sending';
  btn.textContent = S[lang].sending;

  // The widget loads from a third party and may not have solved yet on a slow
  // connection. Waiting briefly beats bouncing a real complaint with a
  // meaningless error.
  if (HAS_TURNSTILE && !tsToken()) {
    setErr('verifying', 'info');
    const started = Date.now();
    while (!tsToken() && Date.now() - started < 8000) {
      await new Promise((r) => setTimeout(r, 250));
    }
    setErr('');
    if (!tsToken()) { fail('errGeneric'); return; }
  }

  // AbortController, not AbortSignal.timeout: the latter needs a newer browser
  // than the cheap Android this has to work on. Without any timeout a stalled
  // connection leaves the button stuck on "Sending…" indefinitely.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        slug: SLUG,
        category: category.value,
        rating: rating || null,
        message: msg.value.trim(),
        lang: lang,
        hp: $('[name=url_confirm_2]').value,
        elapsed: Math.round((Date.now() - OPENED) / 1000),
        turnstile: tsToken()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { fail(data.error); return; }
    showThanks(data.ref);
  } catch (e) {
    fail(e && e.name === 'AbortError' ? 'errNetwork' : 'errGeneric');
  } finally {
    clearTimeout(timer);
  }
});

for (const input of document.querySelectorAll('.chips input')) {
  input.addEventListener('change', () => {
    document.querySelector('.chips').classList.remove('invalid');
    setErr('');
  });
}

/* ------------------------------------------------------------- thank you */

function showThanks(ref) {
  const main = $('#main');
  main.innerHTML =
    '<div class="done" role="status" tabindex="-1">' +
      '<div class="tick">\\u2713</div>' +
      '<h1 data-t="thanksHeading"></h1>' +
      '<p data-t="thanksBody"></p>' +
      '<p class="reflabel" data-t="refLabel"></p>' +
      '<p class="ref"></p>' +
      '<p class="refhelp" data-t="refHelp"></p>' +
      '<p class="closetab" data-t="closeTab"></p>' +
    '</div>';
  // Set as text, never innerHTML — ref is server-generated but this keeps the
  // rule consistent everywhere user-visible strings are injected.
  main.querySelector('.ref').textContent = '#' + (ref || '');
  applyLang(lang);

  // Replacing the card destroys the focused button, dropping focus to <body>:
  // a screen-reader user would hear nothing at all. Moving focus is the
  // reliable mechanism here; role="status" alone is not.
  const done = main.querySelector('.done');
  done.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  try { sessionStorage.removeItem('fb_draft_' + SLUG); } catch (e) {}
}

/* -------------------------------------------------------------- draft save */

// A failed send keeps the typed text, but a reload would lose it — and this
// runs on flaky mobile data.
try {
  const draft = sessionStorage.getItem('fb_draft_' + SLUG);
  if (draft && !msg.value) msg.value = draft;
} catch (e) {}
msg.addEventListener('input', () => {
  try { sessionStorage.setItem('fb_draft_' + SLUG, msg.value); } catch (e) {}
});

// Run once at load: a bfcache restore can hand us a pre-filled textarea.
updateCount();
grow();
paintStars();
`;

  // The nonce is not optional here. style-src is nonce-only, and Turnstile
  // copies the nonce off its own script tag onto the styles it injects into
  // the page; without it the widget renders unstyled or not at all, never
  // produces a token, and every real submission is rejected.
  const head = turnstileSiteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" nonce="${esc(nonce)}" async defer></script>`
    : '';

  return shell({ lang, title: t.title, body, css: formCss, script, head, nonce });
}

/* ------------------------------------------------------------ static notices */

const noticeCss = `
  .notice { text-align: center; padding: 18vh 1rem; }
  .notice h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  .notice p { color: var(--muted); margin: 0; }
  .notice .icon { font-size: 2.5rem; line-height: 1.4; }
`;

export function noticePage({ lang, heading, bodyText, nonce, icon = '\u{1F512}' }) {
  return shell({
    lang,
    title: heading,
    nonce,
    css: noticeCss,
    body: `<div class="notice">
      <div class="icon" aria-hidden="true">${esc(icon)}</div>
      <h1>${esc(heading)}</h1>
      <p>${esc(bodyText)}</p>
    </div>`,
  });
}
