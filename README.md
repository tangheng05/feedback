# Shop Feedback

Anonymous QR feedback for retail locations, delivered straight into Telegram.

A customer scans a printed QR in the shop, writes what they think, and taps
send. The message appears seconds later in the team's Telegram group — in a
topic dedicated to that specific shop. No app, no account, no name.

```
Customer phone                      Telegram group (one, forever)
  scans QR                            ├─ 🏠 General      ← admin commands
     │                                ├─ 🏬 Bak Touk     ← /f/baktouk lands here
     ▼                                ├─ 🏬 Takhmauy     ← /f/takhmauy lands here
  feedback.shop.com/f/baktouk ──────► └─ 🏬 …            ← added by /add
```

## Why topics, not groups

Adding a shop must not mean creating another Telegram group, re-inviting staff,
and re-configuring a bot. A **forum supergroup** gives each location its own
thread inside one group: separate conversations, separate mute settings, shared
membership. Adding a location is a single chat message:

```
/add Bak Touk
```

The bot creates the topic, generates the slug, saves it, and sends back the
**finished A5 poster as a 300dpi image** — forwardable straight to a print shop.
No deploy, no developer, nothing to open.

## Commands

Type these in the group. Only group admins are obeyed, and only inside the
configured group; everyone else is ignored silently, so a stranger who finds
the bot learns nothing.

| Command | What it does |
|---|---|
| `/add Shop Name` | Creates the topic and sends the printable poster |
| `/add Shop Name \| slug` | Same, but you choose the URL |
| `/list` | Every location and its link |
| `/qr slug` | Re-send the poster (reprints) |
| `/rename slug New Name` | Rename — **printed QRs keep working** |
| `/off slug` / `/on slug` | Pause / resume a location |
| `/stats` / `/stats 30` | Totals and average rating, last 7 / 30 days |
| `/pending` | Feedback that never reached the group, and re-send it |
| `/help` | The list above |

## What the customer sees

One page: your logo and the shop name, an EN / ខ្មែរ toggle, six category
chips, an optional 1–5 star rating, and a message box. It sends, shows a
reference code, done. Black on white, no framework, ~26 KB.

Anonymity is designed in, not asserted:

- No name, phone, email, or account — those fields do not exist
- No tracking cookies, no analytics, no third-party requests
- nginx does not log `/api/` at all. An access-log line plus a feedback row
  share a timestamp, and joining them would deanonymise every submission
  without needing to break anything
- Rate limiting stores a **salted daily hash** of the IP as an *hourly bucket
  counter* — no per-submission timestamp, so a counter cannot be tied back to
  any individual message. Purged after two hours
- The Telegram message carries **no submission time**. A minute-accurate
  timestamp is close to a name in a quiet shop: staff could check the till log
  and work out who was standing there

The honest limit: Telegram stamps its own time on every message, so the hour a
complaint arrived is still visible. Only the precise minute — the value that
lines up with a receipt — is gone.

## What the team sees

```
🔴 NEW · #7K3QX
⭐️⭐️ (2/5) · Staff

Cashier was on her phone and ignored me
for five minutes at the counter.

      [ ▶️ In progress ]  [ ✅ Resolved ]
```

Tapping a button updates the message in place and records who handled it.

## Branding

Set in `.env`; everything is optional and anything blank is dropped from the
layout rather than leaving a gap.

| | |
|---|---|
| `BRAND_NAME` | Above the shop name on the poster |
| `BRAND_LOGO` | Poster, form header, **and the centre of every QR code** |
| `BRAND_LOGO_DARK` | Form header only, when the phone is in dark mode |
| `BRAND_COLOR` / `BRAND_HIGHLIGHT` / `BRAND_ACCENT` | Poster colours |
| `BRAND_PHONE` / `BRAND_EMAIL` | Optional contact block on the poster |

`BRAND_LOGO` must be a **PNG**, and must be the dark artwork: the same file is
composited into the middle of the QR, which sits on white. A pale logo would
leave a blank hole in the code. It is downscaled once at boot and served from
`/brand/logo`, so a 350 KB export does not ride along inside every page load.

The logo covers 24% of the code's width with error correction raised to H
(30%). Verified by decoding the generated image with a QR reader — the logo
costs nothing measurable in scan reliability. **Still scan the printed copy
before a print run**: a decoder on a clean image is not a phone camera at an
angle under shop lighting.

## Stack

Node 22 · Express · SQLite (`better-sqlite3`) · nginx or Nginx Proxy Manager ·
pm2 or systemd.

The Telegram Bot API is called with plain `fetch` — it is a handful of
endpoints, and a client library would be larger than the wrapper.

**The poster image needs headless Chromium** (`puppeteer`). That is a heavy
dependency and it was not the first choice, but it is the only text engine
tested here that shapes Khmer correctly. Lighter rasterisers place subscripts
and pre-base vowels wrongly, which turns a word like បញ្ហា into an illegible
blob on a printed poster. If Chromium cannot start, `/add` and `/qr` fall back
to the plain QR plus a link to the printable page and say so — the system keeps
working, it just stops producing the ready-made image.

## Setup

Full runbook, including the Telegram-side steps and Chromium's system
libraries: **[deploy/DEPLOY.md](deploy/DEPLOY.md)**

Trying it on your own machine first, with no domain and no Telegram account:
**[deploy/LOCAL.md](deploy/LOCAL.md)**

```bash
npm install
npm run fonts                          # Khmer webfont + the TTFs the poster needs
cp .env.example .env                   # LOCAL.md has a ready-made local set
npm run seed -- "Test Shop" test 0     # a location, without touching Telegram
npm run dev                            # http://localhost:3000/f/test
npm run peek                           # what actually landed in the database
```

Everything the customer touches works offline. Only the bot half needs real
Telegram: expose the port with a tunnel (`cloudflared tunnel --url
http://localhost:3000`), point `PUBLIC_BASE_URL` at the tunnel URL, and run
`npm run set-webhook`.

## Layout

```
src/
  server.js      routes, validation, CSP, startup
  config.js      env parsing, fails fast on anything missing or still an example
  db.js          schema, prepared statements, the rate-limit transaction
  views.js       customer form and notice pages (HTML/CSS/JS in one file)
  i18n.js        EN + KM strings
  telegram.js    Bot API wrapper
  auth.js        "is this user a group admin?", cached
  commands.js    admin commands
  callbacks.js   status buttons
  feedback.js    message formatting + delivery
  qr.js          QR PNG/SVG, cached, with the logo composited in
  poster.js      the A5 sheet: SVG layout, print page, and the PNG
  brand.js       logo loading, downscaling, and which variant goes where
  ratelimit.js   IP hashing, limits, purge
scripts/         seed, peek, set-webhook, fetch-fonts, purge
deploy/          nginx.conf, feedback.service, ecosystem.config.cjs, DEPLOY.md, LOCAL.md
```

### Reverse proxy

`BIND_HOST` and `TRUST_PROXY` have to agree with reality, because together they
decide who the rate limiter thinks you are.

`TRUST_PROXY` is a **hop count**: `0` with nothing in front, `1` behind nginx or
NPM alone, `2` with Cloudflare's orange cloud in front of those. Count every
proxy. Set it too low and every customer collapses onto the proxy's own address,
so the tenth submission of the hour locks out a whole shop; too high and a
forged header becomes the identity, which is a free bypass of the per-IP limit.

With `BIND_HOST=0.0.0.0` — needed when the proxy is on another machine —
**firewall the port to that machine**, or the header is client-supplied again.

### Anti-abuse

The form is public and unauthenticated, so it is a spam target. In order:

| Layer | Behaviour |
|---|---|
| nginx `limit_req` | 10 req/min per IP at the edge, before Node does any work |
| Per IP **per location** | 10/hour. Checked and consumed in one SQLite transaction — split across an `await`, a concurrent burst would all read the same count and pass |
| Per location | 60/hour. Over that, submissions are still **stored** and the customer still gets a real reference; only the Telegram push stops, and the topic gets one warning. A flood cannot bury real complaints, and nothing is discarded |
| Honeypot + time-on-page | Stored as `quarantined` rather than dropped, so a false positive never silently eats a genuine complaint |
| Turnstile | Wired but off by default — enable it if real abuse appears |

Customer text is HTML-escaped before it reaches Telegram, link previews are
disabled on every outbound message (a preview card would let a spammer push
arbitrary images into the group), and the escaped length is capped so Telegram
cannot reject an oversized message after the customer has been told it sent.

## A note on the Khmer

The Khmer in `src/i18n.js` was drafted by a developer and then **reviewed by a
native speaker**, who corrected phrasing that read as direct translation from
English — `បណ្តឹង` alone reads as a legal lawsuit, `សំណើ` is a formal business
proposal, and the rating question landed nearer "how was your coming to play?".
Their reasoning is kept in comments beside the strings so it does not get
quietly undone.

Two sets of strings have **not** been through that review yet, and both end up
on paper or in front of a customer at the last moment:

- `POSTER` — the poster heading and labels
- the thank-you screen — `thanksHeading`, `thanksBody`, `refHelp`

Have them read before the next print run.

### Why Kantumruy Pro

Noto Sans Khmer is the obvious choice and it is the wrong one here. It does not
apply the foot-removal substitution for `ញ`: when that letter takes a subscript
its foot should disappear so the subscript can sit in the vacated space. Noto
keeps the foot and draws the subscript straight through it, so `បញ្ហា`
("problem") renders as one tangled shape — worst at bold, which is exactly where
a heading lives. Confirmed against the Windows text engine and three other
Khmer faces, all of which get it right.
