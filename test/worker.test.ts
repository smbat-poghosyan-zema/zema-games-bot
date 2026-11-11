import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAY_CALLBACK as FLOW_PLAY_CALLBACK } from '../src/flow.js';
import { texts } from '../src/texts.js';
import worker, { keepWarm, PLAY_CALLBACK, remind, type Env } from '../worker/index.js';

const env: Env = {
  BOT_URL: 'https://bot.example.com/',
  REMINDER_CRON: '0 10 * * MON-FRI',
  CRON_SECRET: 'secret',
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_CHAT_ID: '-100',
};
const noWait = async () => {};

function mockFetch(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => handler(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('worker remind', () => {
  it('lets the bot send the reminder when it is reachable', async () => {
    const fetchMock = mockFetch(() => new Response('sent'));
    expect(await remind(env, noWait)).toBe('bot: sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://bot.example.com/cron/reminder');
    expect(init?.headers).toEqual({ authorization: 'Bearer secret' });
  });

  it('retries, then sends through Telegram when the bot answers 429', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = mockFetch((url) =>
      url.startsWith('https://api.telegram.org/')
        ? new Response('{"ok":true}')
        : new Response('Just a moment...', { status: 429 }),
    );
    expect(await remind(env, noWait, () => 0)).toBe('sent directly via Telegram');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[3]!;
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: '-100',
      text: texts.reminders[0],
      reply_markup: { inline_keyboard: [[{ text: texts.reminderButton, callback_data: 'play' }]] },
    });
  });

  it('fails when Telegram rejects the fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch((url) => new Response('nope', { status: url.includes('telegram') ? 400 : 502 }));
    await expect(remind(env, noWait)).rejects.toThrow(/Telegram sendMessage HTTP 400/);
  });

  it('uses the same Play callback as the bot', () => {
    expect(PLAY_CALLBACK).toBe(FLOW_PLAY_CALLBACK);
  });
});

describe('worker scheduled', () => {
  it('pings /healthz on the keep-warm trigger and never throws', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = mockFetch(() => new Response('', { status: 429 }));
    await worker.scheduled({ cron: '*/10 5-14 * * MON-FRI' }, env);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://bot.example.com/healthz']);

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('down'))));
    expect(await keepWarm(env)).toMatch(/healthz failed/);
  });

  it('runs the reminder on the reminder trigger', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = mockFetch(() => new Response('skipped'));
    await worker.scheduled({ cron: env.REMINDER_CRON }, env);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://bot.example.com/cron/reminder']);
  });
});
