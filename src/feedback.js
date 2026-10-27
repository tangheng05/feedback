import { config } from './config.js';
import { insertFeedback, markDelivered } from './db.js';
import * as tg from './telegram.js';
import { categoryLabel } from './i18n.js';

export const STATUS = {
  new: { icon: '🔴', label: 'NEW' },
  progress: { icon: '🟡', label: 'IN PROGRESS' },
  resolved: { icon: '🟢', label: 'RESOLVED' },
  held: { icon: '⚪️', label: 'HELD' },
  quarantined: { icon: '⚪️', label: 'QUARANTINED' },
};

// Telegram caps messages at 4096; measured after escaping, since & becomes &amp;.
const TELEGRAM_BODY_MAX = 3500;

function escapeAndFit(text) {
  const escaped = tg.esc(text);
  if (escaped.length <= TELEGRAM_BODY_MAX) return escaped;
  return (
    escaped
      .slice(0, TELEGRAM_BODY_MAX)
      // Don't leave half an emoji or half an entity.
      .replace(/[\uD800-\uDBFF]$/, '')
      .replace(/&[a-zA-Z]{0,5}$/, '') + '…'
  );
}

export function formatFeedback({ entry, location, handledBy }) {
  const status = STATUS[entry.status] || STATUS.new;
  const stars = entry.rating ? `${'⭐️'.repeat(entry.rating)} (${entry.rating}/5) · ` : '';

  const head = `${status.icon} <b>${status.label}</b> · <code>#${entry.ref}</code>`;
  const meta = `${stars}${tg.esc(categoryLabel(entry.category, 'en'))}`;
  const handled = handledBy ? `\n👤 ${tg.esc(handledBy)}` : '';

  // No timestamp on purpose: a minute-accurate time can be matched to a till receipt.
  return `${head}
${meta}

${escapeAndFit(entry.message)}${handled}`;
}

export function statusKeyboard(ref, status) {
  const buttons = [];
  if (status !== 'progress') {
    buttons.push({ text: '▶️ In progress', callback_data: `s:progress:${ref}` });
  }
  if (status !== 'resolved') {
    buttons.push({ text: '✅ Resolved', callback_data: `s:resolved:${ref}` });
  }
  if (status !== 'new') {
    buttons.push({ text: '↩️ Reopen', callback_data: `s:new:${ref}` });
  }
  return { inline_keyboard: [buttons] };
}

// Store first, then push. Delivery failures are logged, never shown to the customer.
export async function submitFeedback({ location, category, rating, message, lang, status = 'new' }) {
  const { id, ref } = insertFeedback({
    slug: location.slug,
    category,
    rating: rating || null,
    message,
    lang,
    status,
  });

  if (status !== 'new') return ref;

  const entry = {
    ref,
    category,
    rating,
    message,
    status: 'new',
    created_at: Math.floor(Date.now() / 1000),
  };

  try {
    const sent = await tg.sendMessage({
      message_thread_id: location.topic_id,
      text: formatFeedback({ entry, location }),
      reply_markup: statusKeyboard(ref, 'new'),
    });
    markDelivered(id, sent.message_id);
  } catch (err) {
    console.error(`[feedback] #${ref} stored but not delivered:`, err.message);
  }

  return ref;
}

// Once per hour, so a flood doesn't look like a quiet day.
const throttleNoticeSentAt = new Map();

export async function noticeThrottled(location) {
  const hour = Math.floor(Date.now() / 3600000);
  if (throttleNoticeSentAt.get(location.slug) === hour) return;
  throttleNoticeSentAt.set(location.slug, hour);

  await tg
    .sendMessage({
      message_thread_id: location.topic_id,
      text:
        `⚠️ <b>Unusual volume at ${tg.esc(location.name)}</b>\n\n` +
        `More than ${config.limits.perLocationPerHour} submissions this hour. ` +
        `Further messages are still being saved but will not be posted here until the hour ends, ` +
        `so genuine complaints don't get buried.`,
      link_preview_options: { is_disabled: true },
    })
    .catch((err) => console.error('[feedback] throttle notice failed:', err.message));
}
