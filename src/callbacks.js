import { config } from './config.js';
import { getFeedbackByRef, setFeedbackStatus, getLocation } from './db.js';
import * as tg from './telegram.js';
import { isAdmin } from './auth.js';
import { formatFeedback, statusKeyboard, STATUS } from './feedback.js';

const displayName = (user) =>
  [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'someone';

// Never throws: the status change is already committed by the time we ack.
const ack = (id, text, alert = false) =>
  tg.answerCallbackQuery(id, text, alert).catch((err) => {
    console.error('[callback] ack failed:', err.message);
  });

// Every path must ack, or Telegram leaves the button spinning.
export async function handleCallback(query) {
  const data = query.data || '';

  if (String(query.message?.chat?.id) !== String(config.telegram.groupId)) {
    return ack(query.id, 'Not available here.');
  }

  if (!(await isAdmin(query.from?.id))) {
    return ack(query.id, 'Admins only.', true);
  }

  const match = data.match(/^s:(new|progress|resolved):([A-Z0-9]+)$/);
  if (!match) return ack(query.id, '');

  const [, status, ref] = match;
  const entry = getFeedbackByRef(ref);
  if (!entry) {
    return ack(query.id, 'That feedback is no longer in the database.', true);
  }

  if (entry.status === status) {
    return ack(query.id, `Already ${STATUS[status].label.toLowerCase()}.`);
  }

  const location = getLocation(entry.slug);
  if (!location) {
    return ack(query.id, 'That location has been removed.', true);
  }

  setFeedbackStatus(ref, status);

  const who = displayName(query.from);
  const handledBy = status === 'new' ? null : `${who} · ${STATUS[status].label.toLowerCase()}`;

  try {
    await tg.editMessageText({
      message_id: query.message.message_id,
      text: formatFeedback({ entry: { ...entry, status }, location, handledBy }),
      reply_markup: statusKeyboard(ref, status),
    });
  } catch (err) {
    if (!String(err.message).includes('not modified')) {
      console.error(`[callback] edit failed for #${ref}:`, err.message);
    }
  }

  return ack(query.id, `Marked ${STATUS[status].label.toLowerCase()}.`);
}
