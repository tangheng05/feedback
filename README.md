# Shop Feedback

Anonymous QR-code feedback for retail stores, delivered straight into Telegram.

A customer scans the QR code in a store, writes a message in English or Khmer, and taps send. Seconds later it shows up in that store's topic in your team's Telegram group. There's no app, no account and no name.

```
Customer scans QR  ──►  /f/baktouk  ──►  Telegram group
                                          ├─ General      admin commands
                                          ├─ Bak Touk     ← feedback lands here
                                          └─ Takhmauy
```

## Features

- **One group, one topic per store.** Run `/add Store Name` and the bot creates the topic and sends back a print-ready A5 poster (300 dpi).
- **Bilingual form.** English and Khmer on one small page with no framework and no third-party requests.
- **Track issues in the chat.** Each message has *In progress* and *Resolved* buttons, and the message shows who handled it.
- **Anonymous by design.** The form has no identifying fields, messages carry no submission time, IPs are only kept as salted hashes, and nginx doesn't log submissions.
- **Spam protection.** Rate limits per IP and per store, a honeypot field, and optional Cloudflare Turnstile. Suspicious submissions are stored rather than dropped.

## Bot commands

Only group admins can use these, and only inside the configured group.

| Command | Description |
|---|---|
| `/add Name` or `/add Name \| slug` | Add a store and get its poster |
| `/list` | List every store and its link |
| `/qr slug` | Re-send the poster |
| `/rename slug New Name` | Rename a store (printed QR codes keep working) |
| `/off slug` / `/on slug` | Pause or resume a store |
| `/stats [days]` | Totals and average rating (default 7 days) |
| `/pending` | Re-send feedback that never reached the group |

## Quick start

Requires Node.js 18.17 or later (22 recommended).

```bash
npm install
npm run fonts                          # download the Khmer fonts
npm run seed -- "Test Shop" test 0     # create a store without Telegram
npm run dev                            # http://localhost:3000/f/test
npm run peek                           # inspect stored feedback
```

Settings are read from `.env`, using [`.env.example`](.env.example) as the template. For a ready-made local setup that needs no Telegram account, see [deploy/LOCAL.md](deploy/LOCAL.md). For a production deployment with nginx, TLS and the bot, see [deploy/DEPLOY.md](deploy/DEPLOY.md).

> `PUBLIC_BASE_URL` is printed into every QR code, so choose it before you print any posters.

## Tech stack

Node.js · Express · SQLite (`better-sqlite3`) · Puppeteer · nginx · pm2 or systemd

The Telegram Bot API is called directly with `fetch`. Posters are rendered with headless Chromium, the only engine we tested that shapes Khmer text correctly. If Chromium is unavailable, the bot sends the plain QR code instead.

## Project structure

```
src/       server, Telegram bot, form, QR and poster rendering
scripts/   seed, peek, set-webhook, fetch-fonts, purge
deploy/    nginx, systemd and pm2 configs, deployment guides
```

## Translations

The Khmer strings in `src/i18n.js` were reviewed by a native speaker. Two sets still need that review before the next print run: the poster text (`POSTER`) and the thank-you screen.
