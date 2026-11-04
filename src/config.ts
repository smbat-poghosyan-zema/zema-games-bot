import { DEFAULT_REMINDER, reminderCronPattern, type ReminderConfig } from './schedule.js';

export interface WebhookConfig {
  /** Public HTTPS base URL, e.g. https://bot.example.com */
  url: string;
  /** Path the bot listens on, e.g. /telegram */
  path: string;
  port: number;
  /** Sent by Telegram in X-Telegram-Bot-Api-Secret-Token on every request. */
  secret: string;
}

export interface Config {
  token: string;
  chatId: number;
  mode: 'polling' | 'webhook';
  webhook?: WebhookConfig;
  dataFile: string;
  joinPollSeconds: number;
  gamePollSeconds: number;
  reminder: ReminderConfig;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required env variable ${key}`);
  return value;
}

function intInRange(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${key} must be true or false, got "${raw}"`);
}

export function loadConfig(env: Env = process.env): Config {
  const token = required(env, 'TELEGRAM_BOT_TOKEN');
  const chatId = Number(required(env, 'TELEGRAM_CHAT_ID'));
  if (!Number.isInteger(chatId)) throw new Error('TELEGRAM_CHAT_ID must be a number');

  const mode = (env.BOT_MODE?.trim() || 'polling') as Config['mode'];
  if (mode !== 'polling' && mode !== 'webhook') {
    throw new Error(`BOT_MODE must be "polling" or "webhook", got "${mode}"`);
  }

  let webhook: WebhookConfig | undefined;
  if (mode === 'webhook') {
    const url = required(env, 'WEBHOOK_URL').replace(/\/+$/, '');
    if (!url.startsWith('https://')) throw new Error('WEBHOOK_URL must start with https://');
    const secret = required(env, 'WEBHOOK_SECRET');
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
      throw new Error('WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and - (1-256 chars)');
    }
    const path = env.WEBHOOK_PATH?.trim() || '/telegram';
    webhook = {
      url,
      path: path.startsWith('/') ? path : `/${path}`,
      port: intInRange(env, 'PORT', 8080, 1, 65535),
      secret,
    };
  }

  const reminder: ReminderConfig = {
    enabled: bool(env, 'REMINDER_ENABLED', DEFAULT_REMINDER.enabled),
    time: env.REMINDER_TIME?.trim() || DEFAULT_REMINDER.time,
    days: env.REMINDER_DAYS?.trim() || DEFAULT_REMINDER.days,
    timezone: env.TIMEZONE?.trim() || DEFAULT_REMINDER.timezone,
  };
  // Fail fast on a bad time/days value instead of at the first tick.
  reminderCronPattern(reminder);

  return {
    token,
    chatId,
    mode,
    webhook,
    dataFile: env.DATA_FILE?.trim() || 'data/state.json',
    joinPollSeconds: intInRange(env, 'JOIN_POLL_SECONDS', 300, 5, 600),
    gamePollSeconds: intInRange(env, 'GAME_POLL_SECONDS', 120, 5, 600),
    reminder,
  };
}
