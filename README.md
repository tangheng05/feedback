# Shop Feedback

Anonymous QR feedback for retail locations, delivered straight into Telegram.

A customer scans a printed QR in the shop, writes what they think, and taps
send. The message appears seconds later in the team's Telegram group — in a
topic dedicated to that specific shop. No app, no account, no name.

```
Customer phone                      Telegram group (one, forever)
  scans QR                            ├─ 🏠 General      ← admin commands
     │                                ├─ 🏬 Aeon Mall    ← /f/aeon lands here
     ▼                                ├─ 🏬 Toul Kork    ← /f/tk lands here
  feedback.shop.com/f/aeon  ────────► └─ 🏬 …            ← added by /add
```

## Why topics, not groups

Adding a shop must not mean creating another Telegram group, re-inviting staff,
and re-configuring a bot. A **forum supergroup** gives each location its own
thread inside one group: separate conversations, separate mute settings, shared
membership. Adding a location is a single chat message:

```
/add Aeon Mall
```

The bot creates the topic, generates the slug, saves it, and replies with a
print-ready QR and an A5 poster link. No deploy, no developer.

## Adding a location

Type in the group:

| Command | What it does |
|---|---|
| `/add Shop Name` | Creates the topic and sends back the QR + poster |
| `/add Shop Name \| slug` | Same, but you choose the URL |
| `/list` | Every location and its link |
| `/qr slug` | Re-send the QR (reprints) |
| `/rename slug New Name` | Rename — **printed QRs keep working** |
| `/off slug` / `/on slug` | Pause / resume a location |
| `/stats` / `/stats 30` | Totals and average rating, last 7 / 30 days |

Only group admins can run these, and only inside the configured group.
Everyone else is ignored silently.

## What the customer sees

A single page: shop name, an EN / ខ្មែរ toggle, six category chips, an optional
1–5 star rating, and a message box. It sends, shows a reference code, done.

Anonymity is designed in, not asserted:

- No name, phone, email, or account — those fields don't exist
- No tracking cookies, no analytics
- nginx does not log `/api/` at all. An access-log line plus a feedback row
  share a timestamp, and joining them would deanonymise every submission
  without needing to break anything
- Rate limiting stores a **salted daily hash** of the IP as an *hourly bucket
  counter* — no per-submission timestamp, so a counter cannot be tied back to
  any individual message. Purged after two hours

What it does not promise: the shop still sees when a message arrived. In a
quiet store that is a hint about who sent it, so the form says "nothing you
send here identifies you" rather than claiming the shop cannot guess.

## What the team sees

```
🔴 NEW · #7K3QX
⭐️⭐️ (2/5) · Staff

Cashier was on her phone and ignored me
for five minutes at the counter.

🕒 19 Aug 2026, 14:32 · Aeon Mall
      [ ▶️ In progress ]  [ ✅ Resolved ]
```

Tapping a button updates the message in place and records who handled it.

## Stack

Node 20+ · Express · SQLite (`better-sqlite3`) · nginx · systemd.
Four dependencies. The Telegram Bot API is called with plain `fetch` — it's a
handful of endpoints and a client library would be larger than the wrapper.

## Setup

Full runbook, including the Telegram-side steps: **[deploy/DEPLOY.md](deploy/DEPLOY.md)**

Trying it on your own machine first, with no domain and no Telegram account:
**[deploy/LOCAL.md](deploy/LOCAL.md)**

```bash
npm install
npm run fonts                          # Khmer webfont (one variable file)
cp .env.example .env                   # fill it in (LOCAL.md has a ready-made local set)
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
  config.js      env parsing, fails fast on anything missing
  db.js          schema, prepared statements, the rate-limit transaction
  views.js       customer form and notice pages (HTML/CSS/JS in one file)
  i18n.js        EN + KM strings  ← proofread before printing
  telegram.js    Bot API wrapper
  auth.js        "is this user a group admin?", cached
  commands.js    admin commands
  callbacks.js   status buttons
  feedback.js    message formatting + delivery
  qr.js          QR PNG/SVG (cached) + A5 poster
  ratelimit.js   IP hashing, limits, purge
scripts/         seed, set-webhook, fetch-fonts, purge
deploy/          nginx.conf, feedback.service, DEPLOY.md
```

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

The Khmer strings in `src/i18n.js` were written by a developer, not a native
speaker. **Have someone who speaks Khmer read them before you print a poster.**
The categories and the poster wording matter most — those end up on paper in
your shop, where a mistake is expensive to fix.
