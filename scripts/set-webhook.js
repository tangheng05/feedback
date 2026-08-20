#!/usr/bin/env node
/**
 * Points Telegram at this server and prints a health summary.
 * Run once after deploy, and again any time PUBLIC_BASE_URL changes.
 */
import { config } from '../src/config.js';
import { setWebhook, getWebhookInfo, getMe } from '../src/telegram.js';

const url = `${config.baseUrl}/tg/${config.telegram.webhookPath}`;

const me = await getMe();
console.log(`bot:     @${me.username} (${me.first_name})`);

await setWebhook(url, config.telegram.webhookSecret);
console.log(`webhook: ${config.baseUrl}/tg/****`);

const info = await getWebhookInfo();
console.log(`pending: ${info.pending_update_count}`);
if (info.last_error_message) {
  console.log(`\n⚠ last error from Telegram: ${info.last_error_message}`);
  console.log('  Usually means the URL is unreachable or its TLS certificate is not valid yet.');
} else {
  console.log('\n✅ Webhook registered. Send /help in the group to test.');
}
