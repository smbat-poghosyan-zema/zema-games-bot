/**
 * Cloudflare Worker that wakes the Render free service and triggers the daily reminder.
 *
 * One cron trigger (wrangler.jsonc) calls GET /cron/reminder every 10 minutes during office hours.
 * Every call keeps the service awake, and the bot itself decides whether a reminder is due
 * (REMINDER_TIME / REMINDER_DAYS, at most once per day), so the time is configured in one place.
 * Replaces cron-job.org, whose requests Render started answering with 429.
 */

interface Env {
  /** Bot base URL, e.g. https://zema-games-bot.onrender.com */
  BOT_URL: string;
  /** Same value as the bot's CRON_SECRET (set with `wrangler secret put CRON_SECRET`). */
  CRON_SECRET: string;
}

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 20_000;

async function callReminder(env: Env): Promise<string> {
  const res = await fetch(`${env.BOT_URL.replace(/\/+$/, '')}/cron/reminder`, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = (await res.text()).slice(0, 100);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body}`);
  return body;
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    // Render holds the request while a sleeping service boots (about a minute), so a slow first
    // call is normal. Retries cover transient errors such as a 429 or 502 from Render's edge.
    for (let attempt = 1; ; attempt++) {
      try {
        console.log(`[cron] /cron/reminder: ${await callReminder(env)}`);
        return;
      } catch (err) {
        console.warn(`[cron] attempt ${attempt} failed: ${String(err)}`);
        if (attempt >= ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  },
};
