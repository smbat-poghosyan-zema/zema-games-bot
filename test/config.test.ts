import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '-100123' };

describe('loadConfig', () => {
  it('uses polling and the default reminder when only the required vars are set', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      chatId: -100123,
      mode: 'polling',
      joinPollSeconds: 300,
      gamePollSeconds: 120,
      reminder: { enabled: true, time: '14:00', days: 'MON-FRI', timezone: 'Asia/Yerevan' },
    });
  });

  it('requires token and chat id', () => {
    expect(() => loadConfig({ TELEGRAM_CHAT_ID: '-1' })).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: 'x' })).toThrow(/TELEGRAM_CHAT_ID/);
  });

  it('validates webhook settings', () => {
    expect(() => loadConfig({ ...base, BOT_MODE: 'webhook' })).toThrow(/WEBHOOK_URL/);
    expect(() =>
      loadConfig({ ...base, BOT_MODE: 'webhook', WEBHOOK_URL: 'http://x.dev', WEBHOOK_SECRET: 's' }),
    ).toThrow(/https/);
    const c = loadConfig({ ...base, BOT_MODE: 'webhook', WEBHOOK_URL: 'https://x.dev/', WEBHOOK_SECRET: 'abc_123' });
    expect(c.webhook).toEqual({ url: 'https://x.dev', path: '/telegram', port: 8080, secret: 'abc_123' });
  });

  it('reads reminder overrides and fails fast on bad values', () => {
    const c = loadConfig({ ...base, REMINDER_TIME: '15:30', REMINDER_DAYS: 'TUE,THU', REMINDER_ENABLED: 'false' });
    expect(c.reminder).toMatchObject({ enabled: false, time: '15:30', days: 'TUE,THU' });
    expect(() => loadConfig({ ...base, REMINDER_TIME: '3pm' })).toThrow(/REMINDER_TIME/);
    expect(() => loadConfig({ ...base, JOIN_POLL_SECONDS: '2' })).toThrow(/JOIN_POLL_SECONDS/);
  });
});
