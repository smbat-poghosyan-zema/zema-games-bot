/**
 * Cloudflare Worker that keeps the Render free service awake and makes sure the daily reminder goes out.
 *
 * Two cron triggers (wrangler.jsonc):
 * - keep-warm, every 10 minutes during office hours: GET /healthz so the service doesn't sleep.
 * - reminder, at REMINDER_TIME: GET /cron/reminder, so the bot sends it with its own rules (skipped
 *   while a session is open, at most once per day). When the bot can't be reached, the Worker sends
 *   the reminder straight through the Telegram Bot API. Render's edge answers 429 ("Just a moment...")
 *   to automated requests that would wake a sleeping service, so the bot is often unreachable then.
 *   Telegram's webhook still wakes it, so the reminder's button works either way.
 */
import { texts } from '../src/texts.js';

export interface Env {
  /** Bot base URL, e.g. https://zema-games-bot.onrender.com */
  BOT_URL: string;
  /** Must equal the reminder entry in wrangler.jsonc `triggers.crons`. */
  REMINDER_CRON: string;
  /** Same value as the bot's CRON_SECRET (`wrangler secret put CRON_SECRET`). */
  CRON_SECRET: string;
  /** Same values as the bot's (`wrangler secret put`); used only when the bot is unreachable. */
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

/** Same as PLAY_CALLBACK in src/flow.ts (not imported, to keep Node-only modules out of the bundle). */
export const PLAY_CALLBACK = 'play';

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 20_000;

type Sleep = (ms: number) => Promise<void>;
const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function botUrl(env: Env, path: string): string {
  return `${env.BOT_URL.replace(/\/+$/, '')}${path}`;
}

async function callReminder(env: Env): Promise<string> {
  const res = await fetch(botUrl(env, '/cron/reminder'), {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = (await res.text()).slice(0, 100);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body}`);
  return body;
}

/** Sends a random reminder text with the Play button, like Flow.sendReminder does. */
async function sendDirect(env: Env, rng: () => number): Promise<void> {
  const count = texts.reminders.length;
  const text = texts.reminders[Math.floor(rng() * count) % count]!;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      reply_markup: { inline_keyboard: [[{ text: texts.reminderButton, callback_data: PLAY_CALLBACK }]] },
    }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Asks the bot to send the reminder; falls back to Telegram when every attempt fails. */
export async function remind(env: Env, wait: Sleep = sleep, rng: () => number = Math.random): Promise<string> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return `bot: ${await callReminder(env)}`;
    } catch (err) {
      console.warn(`[cron] attempt ${attempt} failed: ${String(err)}`);
      if (attempt < ATTEMPTS) await wait(RETRY_DELAY_MS);
    }
  }
  // The bot never got the request, so it can't have sent the reminder itself.
  await sendDirect(env, rng);
  return 'sent directly via Telegram';
}

/** Pings the bot so Render keeps it awake. Failing is expected while the service is asleep. */
export async function keepWarm(env: Env): Promise<string> {
  try {
    const res = await fetch(botUrl(env, '/healthz'));
    return `healthz HTTP ${res.status}`;
  } catch (err) {
    return `healthz failed: ${String(err)}`;
  }
}

export default {
  async scheduled(controller: { cron: string }, env: Env): Promise<void> {
    if (controller.cron === env.REMINDER_CRON) console.log(`[cron] reminder: ${await remind(env)}`);
    else console.log(`[cron] keep-warm: ${await keepWarm(env)}`);
  },
};
