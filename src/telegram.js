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

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Previews off so a spammer's URL can't push images into the group.
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

export const deleteForumTopic = (messageThreadId) =>
  call('deleteForumTopic', { chat_id: config.telegram.groupId, message_thread_id: messageThreadId });

export const getChatMember = (userId) =>
  call('getChatMember', { chat_id: config.telegram.groupId, user_id: userId });

export const answerCallbackQuery = (id, text, alert = false) =>
  call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });

export const setWebhook = (url, secret) =>
  call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });

export const getWebhookInfo = () => call('getWebhookInfo', {});
export const getMe = () => call('getMe', {});

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
