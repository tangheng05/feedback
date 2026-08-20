# Deployment runbook

Work through this top to bottom. Steps 1–4 are done in Telegram on your phone;
steps 5–9 are on the server.

---

## 1. Create the bot

1. Open Telegram, search for **@BotFather**, press Start.
2. Send `/newbot`.
3. Give it a display name (e.g. `Shop Feedback`) and a username ending in `bot`
   (e.g. `myshop_feedback_bot`).
4. BotFather replies with a token like `7123456789:AAF...`. **Copy it** — this is
   `TELEGRAM_BOT_TOKEN`.
5. Send `/setprivacy` → choose your bot → **Enable**. The bot only needs to see
   commands, not every message staff type.

---

## 2. Create the group and turn on Topics

1. Telegram → new **Group**. Name it e.g. `Shop Feedback`. Add at least one
   other person (a group needs a second member before it can be upgraded).
2. Open the group → tap the name → **Edit** → **Topics** → turn **on**, save.

> If you don't see a Topics switch, the group is not a supergroup yet. Adding
> more members or setting a public link upgrades it; then the switch appears.
> **Nothing in this system works without Topics** — it is what lets one group
> hold every location separately.

---

## 3. Add the bot as an admin

1. Group → tap the name → **Administrators** → **Add Admin** → pick your bot.
2. Turn **on** these permissions:
   - **Manage Topics** ← required, `/add` fails without it
   - **Send Messages**
   - **Pin Messages** (optional, nice to have)
3. Save.

---

## 4. Find the group ID

Send any message in the group, then open this URL in a browser, replacing
`<TOKEN>`:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Look for `"chat":{"id":-1001234567890,...}`. That negative number is
`TELEGRAM_GROUP_ID`. It always starts with `-100`.

> Seeing `"result":[]`? Send another message in the group and reload. Telegram
> only returns recent updates.

---

## 5. Prepare the server

Ubuntu 22.04 or 24.04. **Use Node 22 LTS.**

Not the newest release: `better-sqlite3` ships prebuilt binaries only for
established versions, so on a brand-new Node it falls back to compiling from
source and fails on a machine with no compiler (`gyp ERR! stack Error: not
found: make`). Node 22 installs in seconds with no build step.

```bash
node -v      # if this is not v22.x, fix it before going further
```

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx \
  libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
  libgtk-3-0 libnss3 libxcomposite1 libxdamage1 libxfixes3 \
  libxkbcommon0 libxrandr2 libasound2 libpango-1.0-0 libcairo2 \
  fonts-liberation xdg-utils

# A dedicated unprivileged user — the app never needs root
sudo useradd --system --home /opt/feedback --shell /usr/sbin/nologin feedback
sudo mkdir -p /opt/feedback
sudo chown feedback:feedback /opt/feedback

# Firewall. The app itself binds to 127.0.0.1 so it is not directly reachable,
# but close the rest of the box anyway.
sudo ufw allow 22,80,443/tcp
sudo ufw --force enable
```

The poster PNG is rendered by Puppeteer's bundled Chromium so Khmer OpenType
shaping uses the browser's HarfBuzz stack. Install dependencies normally with
`npm ci`; if Puppeteer reports that its browser is missing, run
`npx puppeteer browsers install chrome` as the `feedback` user.

> **Do not expose port 3000.** The app binds to loopback deliberately. Anything
> that reaches it without passing through nginx supplies its own
> `X-Forwarded-For`, which makes the per-IP rate limit free to defeat.

---

## 5b. Chromium's system libraries

The poster image is rendered by headless Chromium. It is the only text engine
that shapes Khmer correctly — resvg and other lightweight rasterisers place
subscripts and pre-base vowels wrongly, which turns a word like បញ្ហា into
an illegible blob on a printed poster.

Chromium needs about twenty shared libraries that a minimal VPS image does not
ship. Without them the poster route fails with errors like
`libXcomposite.so.1: cannot open shared object file`:

```bash
apt-get update
apt-get install -y   libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0   libcups2 libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1   libxfixes3 libxrandr2 libxshmfence1 libpango-1.0-0 libcairo2   libasound2t64 || apt-get install -y libasound2
```

Confirm nothing is still missing:

```bash
ldd ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | grep "not found"
```

Silence means it is ready. If the list is not empty, install what it names.

> If you would rather not run Chromium at all, the system still works: `/add`
> and `/qr` fall back to sending the plain QR image plus a link to the
> printable page, and say so in the message. Only the ready-made poster image
> is lost.

---

## 6. Install the app

```bash
sudo -u feedback git clone <your-repo-url> /opt/feedback
cd /opt/feedback
sudo -u feedback npm ci --omit=dev
sudo -u feedback npm run fonts        # downloads the Khmer fonts
test -s public/fonts/KhmerUI.woff2   # fail deployment if the font download was skipped
```

Create `/opt/feedback/.env` from `.env.example`:

```bash
sudo -u feedback cp .env.example .env
sudo -u feedback nano .env
```

Generate the two secrets it asks for:

```bash
openssl rand -hex 24   # TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 32   # IP_HASH_SALT
```

Lock the file down — it holds your bot token:

```bash
sudo chmod 600 /opt/feedback/.env
```

> `PUBLIC_BASE_URL` is baked into **every QR code you print**. Set it to the
> final domain now. Changing it later means reprinting every poster.

---

## 7. DNS and TLS

Point an `A` record for `feedback.yourdomain.com` at the server's IP, then:

```bash
# The rate-limit and cache zones must live in http{}, so they go in conf.d/
sudo tee /etc/nginx/conf.d/feedback-zones.conf >/dev/null <<'EOF'
limit_req_zone $binary_remote_addr zone=fb_api:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=fb_gen:10m rate=60r/m;
proxy_cache_path /var/cache/nginx/feedback levels=1:2 keys_zone=fb_qr:10m max_size=64m inactive=7d;
EOF

sudo cp deploy/nginx.conf /etc/nginx/sites-available/feedback
sudo nano /etc/nginx/sites-available/feedback     # replace feedback.example.com
sudo ln -s /etc/nginx/sites-available/feedback /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d feedback.yourdomain.com
```

Certbot installs its own renewal timer; no cron needed.

---

## 7b. If your reverse proxy is on another machine

Running Nginx Proxy Manager (or any proxy) on a separate host? Skip step 7
entirely and do this instead.

The app binds to `127.0.0.1` by default, which another machine cannot reach.
Open it up, and tell it the proxy is real:

```ini
# .env
BIND_HOST=0.0.0.0
TRUST_PROXY=1
```

Both are required, and the second one is easy to miss.

`TRUST_PROXY` is the number of proxies in front of the app, and it decides
which entry of `X-Forwarded-For` is treated as the customer:

| Your setup | Value |
|---|---|
| Nothing in front (local testing) | `0` |
| nginx or NPM alone | `1` |
| **Cloudflare (orange cloud) in front of nginx / NPM** | **`2`** |

Count every proxy, including Cloudflare. Set it too low and every customer
collapses onto the proxy's own address, so the tenth submission of the hour
locks out the whole shop; set it too high and a forged header becomes the
identity, which is a free bypass of the per-IP limit.

Check it after starting — the log says how many hops it is counting:

```
trusting 2 proxy hop(s) for the client address
```

**Then firewall the port.** With `BIND_HOST=0.0.0.0` anyone who can reach it
supplies their own `X-Forwarded-For`, and the per-IP limit becomes free to
bypass with a fresh fake address per request:

```bash
sudo ufw allow 22/tcp
sudo ufw allow from <PROXY_SERVER_IP> to any port 3000 proto tcp
sudo ufw --force enable
sudo ufw status                     # confirm 3000 is not open to Anywhere
```

In Nginx Proxy Manager: **Proxy Hosts → Add**, forward to this server's IP on
port 3000, scheme `http`, and enable **Block Common Exploits** plus an SSL
certificate with **Force SSL**. Its defaults already send
`X-Forwarded-For` correctly.

`PUBLIC_BASE_URL` is still the public https address customers reach — never
the `http://<internal-ip>:3000` the proxy talks to.

---

## 8. Start the service

Two options. **pm2** is simpler and works with a Node installed through nvm;
**systemd** is the smaller-footprint choice if Node is at `/usr/bin/node`.

### Option A — pm2

```bash
npm install -g pm2

cd /opt/feedback
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup                 # prints a command -- run it, or reboots lose the app
```

Check it:

```bash
pm2 status
pm2 logs feedback           # live; Ctrl+C stops watching, not the app
curl http://127.0.0.1:3000/healthz
```

Day to day:

| Task | Command |
|---|---|
| Logs | `pm2 logs feedback` |
| Last 100 lines | `pm2 logs feedback --lines 100` |
| Restart (after any `.env` edit) | `pm2 restart feedback` |
| Stop | `pm2 stop feedback` |
| Memory / uptime / restarts | `pm2 status` |

Keep the logs from filling the disk:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

> `.env` is read once at startup. Editing it does nothing until
> `pm2 restart feedback`, and that catches people out every time.

### Option B — systemd

Requires Node at `/usr/bin/node` (a NodeSource install, not nvm — the unit's
`ProtectHome=true` cannot see `/root/.nvm`).

```bash
sudo cp deploy/feedback.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now feedback
sudo systemctl status feedback
```

```bash
journalctl -u feedback -f
curl http://127.0.0.1:3000/healthz     # {"ok":true}
```

---

## 9. Register the webhook

```bash
cd /opt/feedback && sudo -u feedback npm run set-webhook
```

It prints the bot username and confirms registration. If Telegram reports an
error, TLS or DNS isn't ready yet — fix that and re-run.

---

## 10. First location

In the group's **General** topic:

```
/help
/add Test Shop
```

You should get a topic named `Test Shop`, a QR image, and a poster link. Open
the poster link, print it, and scan the printed copy **on mobile data** — not
shop wifi. That's how a customer will actually reach it, and it's where a DNS
or TLS mistake shows up that localhost testing hides.

---

## Day-to-day

In Telegram:

| Task | Command |
|---|---|
| Add a location | `/add Shop Name` |
| Reprint a poster | `/qr slug` |
| See all locations | `/list` |
| Pause / resume | `/off slug` · `/on slug` |
| Rename (QR keeps working) | `/rename slug New Name` |
| Weekly numbers | `/stats` or `/stats 30` |
| Anything that never arrived | `/pending` — lists it and re-sends |

On the server:

| Task | pm2 | systemd |
|---|---|---|
| Logs | `pm2 logs feedback` | `journalctl -u feedback -f` |
| Restart | `pm2 restart feedback` | `systemctl restart feedback` |
| What is stored | `npm run peek` | `npm run peek` |

> Restart after **any** `.env` change. It is read once at startup, and the logo
> and QR images are cached for the life of the process.

### Updating

```bash
cd /opt/feedback
sudo -u feedback git pull
sudo -u feedback npm ci --omit=dev
sudo -u feedback npm run fonts      # re-run: new font files are added over time
sudo systemctl restart feedback     # or: pm2 restart feedback
```

> `npm run fonts` fetches the TTFs the poster renderer needs, not just the
> woff2 the browser uses. Skip it after an update that adds them and the
> poster image comes out with **no text on it at all** — the renderer is
> deliberately not allowed to fall back to system fonts, because a VPS has a
> different set from a laptop and the substitute would print Khmer as boxes.

### Backups

Everything lives in one SQLite file. Back it up with the `.backup` command
rather than `cp` — copying a live database can capture a half-written page.

```bash
D=/opt/feedback/data
sudo -u feedback sqlite3 $D/feedback.db ".backup '$D/backup-$(date +%F).db'"

# The live database purges rate-limit counters on a timer, but a backup taken
# before a purge would preserve them forever, next to the feedback they were
# supposed to outlive. Clear them from the copy.
sudo -u feedback sqlite3 $D/backup-$(date +%F).db "DELETE FROM rate_buckets; VACUUM;"
```

Nightly copy with a two-week retention — add to root's crontab:

```
0 3 * * * sudo -u feedback sh -c 'D=/opt/feedback/data; F=$D/backup-$(date +\%F).db; sqlite3 $D/feedback.db ".backup $F"; sqlite3 $F "DELETE FROM rate_buckets; VACUUM;"; find $D -name "backup-*.db" -mtime +14 -delete'
```

### Log retention

`/api/` and `/tg/` already set `access_log off` — the first because an access
log line plus a feedback row is enough to deanonymise every submission by
timestamp, the second because there is no reason to write webhook paths to
disk. Tighten what remains:

```bash
sudo sed -i 's/^\trotate 14$/\trotate 7/' /etc/logrotate.d/nginx
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=14day\n' | sudo tee /etc/systemd/journald.conf.d/retention.conf
sudo systemctl restart systemd-journald
```

---

## Troubleshooting

**`/add` says it can't create the topic**
The bot is missing **Manage Topics**, or the group isn't a forum. Re-check
steps 2 and 3.

**Commands do nothing at all**
By design: the bot ignores everyone who isn't a group admin, and ignores every
chat except the configured group. Confirm you're an admin of the group, and
that `TELEGRAM_GROUP_ID` matches it exactly (including the leading `-100`).

**Feedback isn't arriving in Telegram**
Check `journalctl -u feedback -f`. A line reading `stored but not delivered`
means the submission is safe in the database and only the Telegram push failed
— usually a bad token or a network blip. Nothing is lost.

**Khmer text looks cramped or clipped**
The fonts didn't download. Run `npm run fonts` and restart.

**The poster image has no text on it**
Same cause, different file: `public/fonts/KhmerUI-Regular.ttf` is
missing. `npm run fonts` fetches it. `ls public/fonts` should show the
`KhmerUI` `.ttf` files alongside the `.woff2`.

**`npm ci` fails on @resvg/resvg-js**
It ships prebuilt binaries for common platforms and needs no compiler. If your
architecture is not covered, the poster PNG is the only thing that breaks —
the form, the QR images and Telegram delivery all work without it.

**A customer says the QR doesn't work**
Open `https://feedback.yourdomain.com/f/<slug>` yourself. If that loads, the
printed code is damaged — reprint with `/qr <slug>`.
