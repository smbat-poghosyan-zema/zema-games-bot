import { Cron } from 'croner';
import { log } from './log.js';

export interface ReminderConfig {
  enabled: boolean;
  /** "HH:MM", 24-hour clock. */
  time: string;
  /** Cron day-of-week field, e.g. "MON-FRI", "1-5" or "MON,WED,FRI". */
  days: string;
  timezone: string;
}

export const DEFAULT_REMINDER: ReminderConfig = {
  enabled: true,
  time: '14:00',
  days: 'MON-FRI',
  timezone: 'Asia/Yerevan',
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Builds a 5-field cron pattern ("m h * * days") from the reminder config. */
export function reminderCronPattern(config: Pick<ReminderConfig, 'time' | 'days'>): string {
  const match = TIME_RE.exec(config.time.trim());
  if (!match) throw new Error(`REMINDER_TIME must be HH:MM (24h), got "${config.time}"`);
  const days = config.days.trim().replace(/\s+/g, '');
  if (!days) throw new Error('REMINDER_DAYS must not be empty');
  return `${Number(match[2])} ${Number(match[1])} * * ${days}`;
}

/**
 * Creates the reminder job. Pass `run` to schedule it; omit it to get a paused job
 * that can only be inspected (used by tests and startup validation).
 */
export function createReminderJob(config: ReminderConfig, run?: () => Promise<void> | void): Cron {
  const options = {
    timezone: config.timezone,
    protect: true,
    catch: (err: unknown) => log.error('[reminder] job failed:', err),
    paused: !run,
  };
  const pattern = reminderCronPattern(config);
  return run ? new Cron(pattern, options, run) : new Cron(pattern, options);
}

/** Next `count` reminder times after `from`. */
export function nextReminders(config: ReminderConfig, count: number, from: Date): Date[] {
  const job = createReminderJob(config);
  try {
    return job.nextRuns(count, from);
  } finally {
    job.stop();
  }
}

/**
 * True when the most recent scheduled reminder time is at most `windowMinutes` ago.
 * Used by the /cron/reminder endpoint: an external scheduler wakes the bot up around the
 * reminder time, and this keeps REMINDER_TIME / REMINDER_DAYS the single source of truth.
 */
export function isReminderDue(config: ReminderConfig, now: Date, windowMinutes = 30): boolean {
  const job = createReminderJob(config);
  try {
    // previousRuns() excludes the reference itself, so look from one second ahead to count
    // a call that lands exactly on the reminder time.
    const previous = job.previousRuns(1, new Date(now.getTime() + 1000))[0];
    if (!previous) return false;
    return now.getTime() - previous.getTime() <= windowMinutes * 60_000;
  } finally {
    job.stop();
  }
}

/** Calendar date (YYYY-MM-DD) of `date` in the given timezone. */
export function localDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
