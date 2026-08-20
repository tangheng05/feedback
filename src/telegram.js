import { config } from './config.js';

const API = `https://api.telegram.org/bot${config.telegram.token}`;

export class TelegramError extends Error {
  constructor(method, description, code) {
    super(`Telegram ${method} failed (${code}): ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
    this.description = description;
  }
}

async function call(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    throw new TelegramError(method, body.description || res.statusText, body.error_code || res.status);
  }
  return body.result;
}

/** Escape text destined for parse_mode: 'HTML'. Customer text is untrusted. */
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/*
 * Link previews are disabled by default on every outbound message.
 *
 * Customer feedback is escaped, but Telegram still auto-detects URLs in the
 * text and renders a preview card with a title, description and IMAGE fetched
 * from that host. Without this, the ceiling on abuse is not lines of text in
 * the group — it is full-size images of a spammer's choosing. A caller can
 * still opt in explicitly by passing its own link_preview_options.
 */
const defaults = {
  chat_id: config.telegram.groupId,
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
};

export const sendMessage = (payload) => call('sendMessage', { ...defaults, ...payload });

export const editMessageText = (payload) => call('editMessageText', { ...defaults, ...payload });

export const createForumTopic = (name) =>
  call('createForumTopic', { chat_id: config.telegram.groupId, name });

export const editForumTopic = (messageThreadId, name) =>
  call('editForumTopic', {
    chat_id: config.telegram.groupId,
    message_thread_id: messageThreadId,
    name,
  });

export const getChatMember = (userId) =>
  call('getChatMember', { chat_id: config.telegram.groupId, user_id: userId });

export const answerCallbackQuery = (id, text, alert = false) =>
  call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });

export const setWebhook = (url, secret) =>
  call('setWebhook', {
    url,
    secret_token: secret,
    // We only ever act on these two. Narrowing the list keeps Telegram from
    // waking the server for edits, joins, reactions and other noise.
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });

export const getWebhookInfo = () => call('getWebhookInfo', {});
export const getMe = () => call('getMe', {});

/** Send a PNG buffer as a photo. Needs multipart, so it bypasses call(). */
export async function sendPhoto({ buffer, filename, caption, messageThreadId }) {
  const form = new FormData();
  form.append('chat_id', String(config.telegram.groupId));
  form.append('photo', new Blob([buffer], { type: 'image/png' }), filename);
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  if (messageThreadId) form.append('message_thread_id', String(messageThreadId));

  const res = await fetch(`${API}/sendPhoto`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    throw new TelegramError('sendPhoto', body.description || res.statusText, body.error_code);
  }
  return body.result;
}

/**
 * Telegram compresses photos, which can soften a QR's edges. We send the same
 * image as a document too so the admin always has a crisp file to print from.
 */
export async function sendDocument({ buffer, filename, caption, messageThreadId, mime = 'image/png' }) {
  const form = new FormData();
  form.append('chat_id', String(config.telegram.groupId));
  form.append('document', new Blob([buffer], { type: mime }), filename);
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  if (messageThreadId) form.append('message_thread_id', String(messageThreadId));

  const res = await fetch(`${API}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    throw new TelegramError('sendDocument', body.description || res.statusText, body.error_code);
  }
  return body.result;
}
