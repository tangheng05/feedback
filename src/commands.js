import { config } from './config.js';
import {
  getLocation,
  listLocations,
  reserveLocation,
  setLocationTopic,
  deleteLocation,
  renameLocation,
  setLocationActive,
  statsSince,
  listPending,
  countPending,
  markDelivered,
  now,
} from './db.js';
import * as tg from './telegram.js';
import { isAdmin } from './auth.js';
import { formatFeedback, statusKeyboard } from './feedback.js';
import { qrPng, qrSvg, formUrl, posterUrl } from './qr.js';

// Telegram's fixed id for messages sent under the group's own identity.
const GROUP_ANONYMOUS_BOT_ID = 1087968824;

/* ------------------------------------------------------------------- slugs */

/**
 * Slugs are permanent and appear in printed QR codes, so they must be short,
 * URL-safe and stable. A Khmer-only shop name percent-encodes into a long ugly
 * URL that makes a dense, hard-to-scan QR, so those fall back to a short code.
 */
const SLUG_FALLBACK_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomSlug(len = 4) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SLUG_FALLBACK_ALPHABET[Math.floor(Math.random() * SLUG_FALLBACK_ALPHABET.length)];
  }
  return out;
}

export function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12)
    .replace(/-+$/g, '');

  return base || randomSlug();
}

/**
 * Normalise a slug an admin TYPED, for lookup only.
 *
 * Must not go through slugify(): that truncates to 12 characters, and
 * uniqueSlug mints slugs up to 14 ("phnom-penh-c-2"). Slugifying a typed
 * "phnom-penh-c-2" yields "phnom-penh-c" — a different, existing shop. The
 * admin copies the slug straight out of /list, and /off or /rename would
 * silently act on the wrong location.
 */
const lookupSlug = (arg) => String(arg || '').trim().toLowerCase();

function uniqueSlug(desired) {
  if (!getLocation(desired)) return desired;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${desired}-${i}`.slice(0, 16);
    if (!getLocation(candidate)) return candidate;
  }
  // Extremely unlikely; a random code is guaranteed to terminate the search.
  let fallback = randomSlug(5);
  while (getLocation(fallback)) fallback = randomSlug(5);
  return fallback;
}

/* ---------------------------------------------------------------- responses */

const esc = tg.esc;

function reply(threadId, text, extra = {}) {
  return tg.sendMessage({
    message_thread_id: threadId,
    text,
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

const HELP = `<b>Feedback bot commands</b>

<code>/add Shop Name</code> — create a location: makes a topic, generates the QR
<code>/add Shop Name | slug</code> — same, but pick the URL yourself
<code>/list</code> — every location and its link
<code>/qr slug</code> — re-send the QR and poster
<code>/rename slug New Name</code> — rename (the printed QR keeps working)
<code>/off slug</code> — stop accepting feedback there
<code>/on slug</code> — start again
<code>/stats</code> or <code>/stats 30</code> — totals for the last 7 / 30 days
<code>/pending</code> — feedback that never reached this group, and re-send it
<code>/help</code> — this list`;

/* ------------------------------------------------------------ command: /add */

async function cmdAdd(arg, threadId) {
  if (!arg) {
    return reply(threadId, 'Usage: <code>/add Shop Name</code>\nOr: <code>/add Shop Name | customslug</code>');
  }

  const [rawName, rawSlug] = arg.split('|').map((s) => s.trim());
  const name = rawName;
  if (!name) return reply(threadId, 'That location needs a name.');
  if (name.length > 60) return reply(threadId, 'That name is too long (max 60 characters).');

  let slug;
  if (rawSlug) {
    slug = slugify(rawSlug);
    if (getLocation(slug)) {
      return reply(threadId, `The slug <code>${esc(slug)}</code> is already taken. Pick another.`);
    }
  } else {
    slug = uniqueSlug(slugify(name));
  }

  let topic;
  try {
    topic = await tg.createForumTopic(name);
  } catch (err) {
    console.error('[add] createForumTopic failed:', err.message);
    return reply(
      threadId,
      `Could not create the topic: <i>${esc(err.description || err.message)}</i>\n\n` +
        'Check that this group has <b>Topics</b> turned on and that I am an admin with the <b>Manage Topics</b> permission.'
    );
  }

  const location = insertLocation({ slug, name, topicId: topic.message_thread_id });

  // A header inside the new topic, so anyone who taps into it knows what it is.
  await reply(
    location.topic_id,
    `📍 <b>${esc(name)}</b>\n\nFeedback scanned at this location lands here.\n${esc(formUrl(slug))}`
  ).catch((err) => console.error('[add] topic header failed:', err.message));

  const caption =
    `✅ <b>${esc(name)}</b> is live.\n\n` +
    `Link: ${esc(formUrl(slug))}\n` +
    `Printable poster: ${esc(posterUrl(slug))}\n\n` +
    `Print the poster (A5) or use the PNG below. Feedback will arrive in the <b>${esc(name)}</b> topic.`;

  const png = await qrPng(slug);
  await tg.sendPhoto({
    buffer: png,
    filename: `${slug}-qr.png`,
    caption,
    messageThreadId: threadId,
  });

  // Telegram recompresses photos, which softens QR edges. The SVG is the copy
  // to actually print from - vector, so it stays sharp at any paper size.
  const svg = await qrSvg(slug);
  await tg
    .sendDocument({
      buffer: Buffer.from(svg, 'utf8'),
      filename: `${slug}-qr.svg`,
      mime: 'image/svg+xml',
      caption: 'Vector copy — use this one for printing.',
      messageThreadId: threadId,
    })
    .catch((err) => console.error('[add] sendDocument failed:', err.message));

  return null;
}

/* ---------------------------------------------------------- command: /list */

function cmdList(threadId) {
  const locations = listLocations();
  if (!locations.length) {
    return reply(threadId, 'No locations yet. Add the first with <code>/add Shop Name</code>.');
  }

  const lines = locations.map((l) => {
    const mark = l.active ? '🟢' : '⚪️';
    return `${mark} <b>${esc(l.name)}</b>\n   <code>${esc(l.slug)}</code> · ${esc(formUrl(l.slug))}`;
  });

  return reply(threadId, `<b>Locations (${locations.length})</b>\n\n${lines.join('\n\n')}`);
}

/* ------------------------------------------------------------ command: /qr */

async function cmdQr(arg, threadId) {
  if (!arg) return reply(threadId, 'Usage: <code>/qr slug</code> — see <code>/list</code> for slugs.');
  const slug = lookupSlug(arg);
  const location = getLocation(slug);
  if (!location) {
    return reply(threadId, `No location with slug <code>${esc(slug)}</code>. Try <code>/list</code>.`);
  }

  const png = await qrPng(location.slug);
  await tg.sendPhoto({
    buffer: png,
    filename: `${location.slug}-qr.png`,
    caption:
      `<b>${esc(location.name)}</b>\n${esc(formUrl(location.slug))}\n\n` +
      `Printable poster: ${esc(posterUrl(location.slug))}`,
    messageThreadId: threadId,
  });

  const svg = await qrSvg(location.slug);
  await tg
    .sendDocument({
      buffer: Buffer.from(svg, 'utf8'),
      filename: `${location.slug}-qr.svg`,
      mime: 'image/svg+xml',
      caption: 'Vector copy — use this one for printing.',
      messageThreadId: threadId,
    })
    .catch((err) => console.error('[qr] sendDocument failed:', err.message));

  return null;
}

/* -------------------------------------------------------- command: /rename */

async function cmdRename(arg, threadId) {
  const match = String(arg || '').match(/^(\S+)\s+(.+)$/);
  if (!match) return reply(threadId, 'Usage: <code>/rename slug New Shop Name</code>');

  const [, rawSlug, newName] = match;
  const location = getLocation(lookupSlug(rawSlug));
  if (!location) {
    return reply(threadId, `No location with slug <code>${esc(rawSlug)}</code>. Try <code>/list</code>.`);
  }
  if (newName.length > 60) return reply(threadId, 'That name is too long (max 60 characters).');

  try {
    await tg.editForumTopic(location.topic_id, newName);
  } catch (err) {
    console.error('[rename] editForumTopic failed:', err.message);
    return reply(threadId, `Could not rename the topic: <i>${esc(err.description || err.message)}</i>`);
  }
  renameLocation(location.slug, newName);

  return reply(
    threadId,
    `✏️ <b>${esc(location.name)}</b> → <b>${esc(newName)}</b>\n\n` +
      `The link is unchanged, so every QR already printed keeps working:\n${esc(formUrl(location.slug))}`
  );
}

/* ------------------------------------------------------- command: /on, /off */

function cmdToggle(arg, threadId, active) {
  if (!arg) {
    return reply(threadId, `Usage: <code>/${active ? 'on' : 'off'} slug</code> — see <code>/list</code> for slugs.`);
  }
  const slug = lookupSlug(arg);
  const location = getLocation(slug);
  if (!location) {
    return reply(threadId, `No location with slug <code>${esc(slug)}</code>. Try <code>/list</code>.`);
  }

  setLocationActive(location.slug, active);

  return reply(
    threadId,
    active
      ? `🟢 <b>${esc(location.name)}</b> is accepting feedback again.`
      : `⚪️ <b>${esc(location.name)}</b> is paused. Scanning its QR now shows a "not available" page instead of the form — the code itself stays valid, so nothing needs reprinting.`
  );
}

/* --------------------------------------------------------- command: /stats */

function cmdStats(arg, threadId) {
  const days = Math.min(Math.max(Number.parseInt(arg, 10) || 7, 1), 365);
  const rows = statsSince(now() - days * 86400);

  if (!rows.length) {
    return reply(threadId, 'No locations yet. Add one with <code>/add Shop Name</code>.');
  }

  const lines = rows.map((r) => {
    const avg = r.avg_rating ? `${'★'.repeat(Math.round(r.avg_rating))} ${r.avg_rating.toFixed(1)}` : '—';
    return (
      `<b>${esc(r.name)}</b>\n` +
      `   ${r.total} total · ${r.open} open · ${r.resolved} resolved\n` +
      `   avg ${avg}`
    );
  });

  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return reply(threadId, `<b>Last ${days} days</b> — ${total} total\n\n${lines.join('\n\n')}`);
}

/* ------------------------------------------------------- command: /pending */

/**
 * List and re-push feedback that never reached the group.
 *
 * Submissions can be stored but undelivered for several reasons — Telegram was
 * down, the topic was deleted, the flood cap suppressed the push, or the bot
 * checks flagged it as automated. In every case the customer was shown a real
 * reference code and told it had been sent. Without this command the shop has
 * no way to find out those messages exist.
 */
async function cmdPending(arg, threadId) {
  const slug = arg ? lookupSlug(arg) : null;
  if (slug && !getLocation(slug)) {
    return reply(threadId, `No location with slug <code>${esc(slug)}</code>. Try <code>/list</code>.`);
  }

  const total = countPending(slug);
  if (!total) return reply(threadId, '✅ Nothing pending — everything reached the group.');

  const rows = listPending(slug, 20);
  await reply(
    threadId,
    `<b>${total} undelivered</b>${slug ? ` at <code>${esc(slug)}</code>` : ''}` +
      `${total > rows.length ? ` (showing ${rows.length})` : ''}
` +
      'Re-sending them into their topics now.'
  );

  let sent = 0;
  for (const entry of rows) {
    const location = getLocation(entry.slug);
    if (!location || !location.topic_id) continue;
    try {
      const msg = await tg.sendMessage({
        message_thread_id: location.topic_id,
        text: formatFeedback({ entry: { ...entry, status: 'new' }, location }),
        reply_markup: statusKeyboard(entry.ref, 'new'),
      });
      markDelivered(entry.id, msg.message_id);
      sent++;
    } catch (err) {
      console.error(`[pending] #${entry.ref} still undeliverable:`, err.message);
    }
  }

  return reply(threadId, `Delivered ${sent} of ${rows.length}.`);
}

/* ------------------------------------------------------------------ router */

export async function handleCommand(message) {
  const text = message.text || '';
  if (!text.startsWith('/')) return;

  // Ignore anything outside the configured group entirely. Someone who finds
  // the bot and DMs it gets no response at all - not even an error, which would
  // confirm the bot exists and is worth probing.
  if (String(message.chat.id) !== String(config.telegram.groupId)) return;

  /*
   * Telegram's GroupAnonymousBot: an admin who posted "as the group".
   *
   * getChatMember on this id fails, isAdmin fails closed, and the command is
   * dropped in total silence -- so a real admin sees the bot ignore them with
   * no way to find out why. Say so once, in the thread they typed in.
   */
  const userId = message.from?.id;
  if (userId === GROUP_ANONYMOUS_BOT_ID) {
    await reply(
      message.message_thread_id,
      'That command came from the group identity, so I cannot check who sent it. ' +
        'Turn off <b>Send as group</b> (the profile icon in the message box) and try again.'
    ).catch(() => {});
    return;
  }
  if (!userId || !(await isAdmin(userId))) return;

  // Strip the @botname suffix Telegram adds in groups.
  const match = text.match(/^\/([a-zA-Z_]+)(?:@\S+)?\s*([\s\S]*)$/);
  if (!match) return;

  const [, command, arg] = match;
  const threadId = message.message_thread_id;
  const trimmed = arg.trim();

  try {
    switch (command.toLowerCase()) {
      case 'add':
        return await cmdAdd(trimmed, threadId);
      case 'list':
        return cmdList(threadId);
      case 'qr':
        return await cmdQr(trimmed, threadId);
      case 'rename':
        return await cmdRename(trimmed, threadId);
      case 'off':
      case 'disable':
        return cmdToggle(trimmed, threadId, false);
      case 'on':
      case 'enable':
        return cmdToggle(trimmed, threadId, true);
      case 'stats':
        return cmdStats(trimmed, threadId);
      case 'pending':
        return await cmdPending(trimmed, threadId);
      case 'help':
      case 'start':
        return reply(threadId, HELP);
      default:
        return; // not one of ours - stay quiet
    }
  } catch (err) {
    console.error(`[command:${command}]`, err);
    return reply(threadId, `Something broke running that: <i>${esc(err.message)}</i>`).catch(() => {});
  }
}
