import 'dotenv/config';
import { handleTelegramUpdate } from './api/telegram/bot_service.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not configured in .env');
  process.exit(1);
}

console.log('----------------------------------------------------');
console.log('🤖 POShere Enterprise Telegram AI Bot Poller');
console.log('----------------------------------------------------');

async function deleteWebhook() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    const data = await res.json();
    console.log('Webhook status reset for polling mode:', data.description || 'OK');
  } catch (err) {
    console.warn('Webhook reset warning:', err.message);
  }
}

async function startPolling() {
  await deleteWebhook();
  let offset = 0;
  console.log('✅ Bot is actively listening for Telegram messages!');
  console.log('👉 Open your Telegram and chat with: t.me/poshere_enterprise_bot');
  console.log('Press Ctrl+C to stop.\n');

  while (true) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`);
      const data = await res.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const sender = update.message?.from?.username || update.message?.from?.first_name || 'unknown';
          const text = update.message?.text || '[non-text message]';
          console.log(`📩 [Chat received] @${sender}: "${text}"`);
          
          handleTelegramUpdate(update)
            .then(res => console.log(`📤 [Reply sent to @${sender}]:`, res?.status || 'done'))
            .catch(err => console.error(`❌ [Error for @${sender}]:`, err.message));
        }
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error('Polling connection error:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

startPolling();
