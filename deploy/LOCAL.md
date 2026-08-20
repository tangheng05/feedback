# Testing on your own machine

You can exercise **everything a customer touches** — the form, both languages,
validation, rate limiting, the QR, the printable poster — with no domain, no
VPS and no Telegram account. Only the bot half needs real Telegram.

---

## 1. Install

```bash
cd feedback
npm install
npm run fonts      # downloads the Khmer font; without it Khmer renders in a fallback
```

## 2. Create `.env.local`

Copy this verbatim. The token and group id are deliberate fakes — nothing here
reaches Telegram, so nothing here is a secret.

```ini
PUBLIC_BASE_URL=http://localhost:3000
PORT=3000

# Fake. Every Telegram push will fail with 401 and log "stored but not
# delivered" — which is the correct, designed behaviour, not a bug.
TELEGRAM_BOT_TOKEN=0000000000:LOCAL_TEST_NO_TELEGRAM
TELEGRAM_GROUP_ID=-1009999999999

# Any 24+ characters of A-Z a-z 0-9 _ - will do for local use.
TELEGRAM_WEBHOOK_SECRET=localtestlocaltestlocaltestlocaltest1234
IP_HASH_SALT=localsaltlocalsaltlocalsaltlocalsaltlocalsalt

DB_PATH=./data/local.db
```

> On a real server every one of these becomes a genuine value, and
> `PUBLIC_BASE_URL` must be `https://` — see `DEPLOY.md`.

## 3. Create a location without the bot

`/add` needs Telegram. This does the same thing offline:

```bash
node scripts/seed.js "Test Shop" test 0
#   Seeded "Test Shop" as /f/test
#   http://localhost:3000/f/test
```

## 4. Run it

```bash
npm run dev          # restarts on file changes
```

Open **http://localhost:3000/f/test**.

---

## What to check

| | |
|---|---|
| The form | Toggle **EN / ខ្មែរ**. Khmer must not look clipped — the subscript marks hang below the line and need the room. |
| Sending | Pick a category, write 10+ characters, send. You get a reference code. |
| The log | `stored but not delivered … 401 Unauthorized` — correct. The complaint is safe in SQLite; only the push failed. |
| Too fast | Submit within 3 seconds of loading. It succeeds, but is stored `quarantined` and never pushed. |
| Rate limit | Send 11 times. The 11th returns 429. |
| The poster | http://localhost:3000/poster/test — this is what you print. |
| The QR | http://localhost:3000/qr/test.png |

Read what actually landed (no sqlite3 CLI needed):

```bash
npm run peek
```

> The QR and poster encode `PUBLIC_BASE_URL`. While that is `localhost` they
> only work on this machine. **Do not print them.**

---

## Testing on a real phone

A phone cannot reach `localhost` on your laptop, and the server binds to
loopback on purpose. For LAN testing only, override both:

```bash
# Find your laptop's LAN address first (ipconfig / ifconfig), e.g. 192.168.1.20
BIND_HOST=0.0.0.0 PUBLIC_BASE_URL=http://192.168.1.20:3000 npm run dev
```

Then open `http://192.168.1.20:3000/f/test` on a phone on the same wifi, or
scan the QR from `/poster/test` on screen.

The server prints a warning while this is on, and stops trusting
`X-Forwarded-For` — without nginx in front, any device on the wifi could
otherwise claim any IP and walk straight past the rate limit. **Never set
`BIND_HOST` on the real server.**

---

## Testing the Telegram half

This is the one part that cannot be faked: Telegram has to reach your webhook
over public HTTPS. Two options.

**A. Just deploy it.** `DEPLOY.md` takes about 30 minutes and this stops being
a local problem.

**B. Tunnel to your laptop.** Do steps 1–4 of `DEPLOY.md` (real bot, real
group, Topics on), then:

```bash
cloudflared tunnel --url http://localhost:3000
#   https://random-words-here.trycloudflare.com
```

Put that URL in `PUBLIC_BASE_URL`, restart, and register the webhook:

```bash
npm run set-webhook
```

Now `/help` and `/add Test Shop` work in your real group. The tunnel URL
changes every restart, so re-run `set-webhook` each time — and treat any QR it
generates as disposable.

---

## Starting over

```bash
rm -f data/local.db*
node scripts/seed.js "Test Shop" test 0
```
