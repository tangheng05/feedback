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

/**
 * Telegram rejects messages over 4096 characters.
 *
 * The cap has to be measured AFTER escaping, not before: `&` becomes `&amp;`,
 * so a 2000-character message of ampersands escapes to 10,000. Checking only
 * the raw length means Telegram 400s, the push is lost, and the customer still
 * sees a success screen — the worst possible split between what each side
 * believes happened.
 */
const TELEGRAM_BODY_MAX = 3500;

function escapeAndFit(text) {
  const escaped = tg.esc(text);
  if (escaped.length <= TELEGRAM_BODY_MAX) return escaped;
  return (
    escaped
      .slice(0, TELEGRAM_BODY_MAX)
      // A lone high surrogate is invalid UTF-16 and Telegram rejects the whole
      // message; slicing mid-emoji in a complaint is not a rare case.
      .replace(/[\uD800-\uDBFF]$/, '')
      // Trim any half-written entity left by the cut, or Telegram sees `&a`.
      .replace(/&[a-zA-Z]{0,5}$/, '') + '…'
  );
}

/**
 * Build the Telegram message for one submission.
 *
 * `handledBy` is appended once someone taps a status button, so the group can
 * see who picked it up without opening anything.
 */
export function formatFeedback({ entry, location, handledBy }) {
  const status = STATUS[entry.status] || STATUS.new;
  const stars = entry.rating ? `${'⭐️'.repeat(entry.rating)} (${entry.rating}/5) · ` : '';

  const head = `${status.icon} <b>${status.label}</b> · <code>#${entry.ref}</code>`;
  const meta = `${stars}${tg.esc(categoryLabel(entry.category, 'en'))}`;
  const handled = handledBy ? `\n👤 ${tg.esc(handledBy)}` : '';

  /*
   * No timestamp line.
   *
   * It read "12 Jan 2026, 14:32 · Bak Touk" and it was working against the
   * promise on the form. In a quiet shop a minute-accurate time is close to a
   * name: staff can look at the till log and work out who was standing there.
   * The location is already implied by the topic the message lands in.
   *
   * Be clear about the limit of this: Telegram stamps its own time on every
   * message, so the hour is still visible. What this removes is the precise
   * minute of SUBMISSION, which is the value that lines up with a receipt.
   */
  // Customer text is escaped, never trusted — it arrives from a public form.
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

/**
 * Store the submission, then push it into its location's topic.
 *
 * The write happens first and deliberately: if Telegram is down or rate
 * limiting us, the feedback is still safely on disk rather than lost, and the
 * customer still gets a real reference code. Delivery failure is logged and
 * counted, never surfaced — the person who just complained about a cashier can
 * do nothing useful with a Bot API error.
 *
 * `status` of 'held' or 'quarantined' stores without pushing.
 */
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

/**
 * Warn the topic once per hour that the flood cap is suppressing pushes.
 *
 * Without this the group simply goes quiet during an attack, which looks
 * identical to a slow day — the shop would have no idea it was being silenced.
 */
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
