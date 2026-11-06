import type { Update, UserFromGetMe } from 'grammy/types';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot } from '../src/bot.js';
import { loadConfig } from '../src/config.js';
import { GameFlow } from '../src/flow.js';
import { loadGames } from '../src/games.js';
import { JsonStore } from '../src/store.js';
import { texts } from '../src/texts.js';

const GROUP = -100777;
const botInfo = { id: 42, is_bot: true, first_name: 'Zema Games', username: 'ZemaGamesBot' } as UserFromGetMe;

describe('bot handlers', () => {
  let dir: string;
  let calls: { method: string; payload: Record<string, unknown> }[];
  let bot: ReturnType<typeof createBot>['bot'];
  let flow: ReturnType<typeof createBot>['flow'];
  let updateId = 1;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zema-bot-'));
    calls = [];
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'test:token', TELEGRAM_CHAT_ID: String(GROUP) });
    const games = loadGames();
    ({ bot, flow } = createBot(
      config,
      games,
      (api) =>
        new GameFlow(api, new JsonStore(join(dir, 'state.json')), games, {
          chatId: GROUP,
          joinPollSeconds: 600,
          gamePollSeconds: 300,
          timezone: 'Asia/Yerevan',
        }),
      { botInfo },
    ));
    // Intercept every outgoing Bot API call; nothing reaches Telegram.
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      const result = method === 'sendPoll' ? { message_id: 10, poll: { id: 'p1' } } : { message_id: 9 };
      return { ok: true, result } as never;
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const message = (chat: { id: number; type: string }, text: string): Update =>
    ({
      update_id: updateId++,
      message: {
        message_id: 1,
        date: 0,
        chat: { ...chat, title: 'x', first_name: 'x' },
        from: { id: 5, is_bot: false, first_name: 'Ann', username: 'ann' },
        text,
        entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
      },
    }) as unknown as Update;

  const dm = { id: 5, type: 'private' };
  const group = { id: GROUP, type: 'supergroup' };
  const sessionId = () => flow.sessions[0]!.id;

  const callback = (data: string, fromId = 5): Update =>
    ({
      update_id: updateId++,
      callback_query: {
        id: `cb${updateId}`,
        chat_instance: 'x',
        data,
        from: { id: fromId, is_bot: false, first_name: fromId === 5 ? 'Ann' : 'Other' },
        message: { message_id: 9, date: 0, chat: { ...group, title: 'x' } },
      },
    }) as unknown as Update;

  it('answers /help and /start in a private chat', async () => {
    await bot.handleUpdate(message(dm, '/help'));
    await bot.handleUpdate(message(dm, '/start'));
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage']);
    expect(calls[0]!.payload).toMatchObject({ chat_id: 5, parse_mode: 'HTML' });
    expect(String(calls[0]!.payload.text)).toContain('/play');
  });

  it('lists games with player counts in a private chat', async () => {
    await bot.handleUpdate(message(dm, '/games'));
    const text = String(calls[0]!.payload.text);
    expect(text).toContain('<b>Blokus</b> (սեղանի) · 2-4 հոգի · ~20 րոպե');
    expect(text).toContain('<b>Gartic Phone</b> (օնլայն)');
    expect(text).toContain('https://garticphone.com/');
    expect(text).toContain('<b>Kitten Kaboom</b> (օնլայն) · 2-10 հոգի · ~20-30 րոպե');
  });

  it('points /play in a private chat to the group', async () => {
    await bot.handleUpdate(message(dm, '/play'));
    expect(calls[0]!.payload.text).toBe(texts.playOnlyInGroup);
  });

  it('opens the game picker on /play@ZemaGamesBot, then a 10-minute poll after Done', async () => {
    await bot.handleUpdate(message(group, '/play@ZemaGamesBot'));
    expect(calls[0]).toMatchObject({ method: 'sendMessage', payload: { chat_id: GROUP, parse_mode: 'HTML' } });
    const id = sessionId();

    await bot.handleUpdate(callback(`pick:${id}:1`));
    await bot.handleUpdate(callback(`pick:${id}:4`));
    await bot.handleUpdate(callback(`pickdone:${id}`));
    expect(calls.map((c) => c.method)).toEqual([
      'sendMessage',
      'editMessageReplyMarkup',
      'answerCallbackQuery',
      'editMessageReplyMarkup',
      'answerCallbackQuery',
      'sendPoll',
      'deleteMessage',
      'answerCallbackQuery',
    ]);
    expect(calls[5]!.payload).toMatchObject({ chat_id: GROUP, is_anonymous: false, open_period: 600 });
    expect(String(calls[5]!.payload.question)).toContain('Ann 🎲 Azul, Gartic Phone');
  });

  it('refuses picker taps from someone else', async () => {
    await bot.handleUpdate(message(group, '/play'));
    await bot.handleUpdate(callback(`pick:${sessionId()}:1`, 6));
    expect(calls.at(-1)).toMatchObject({
      method: 'answerCallbackQuery',
      payload: { text: texts.pickerForbidden, show_alert: true },
    });
  });

  it('deletes a session with its Delete button', async () => {
    await bot.handleUpdate(message(group, '/play'));
    await bot.handleUpdate(callback(`del:${sessionId()}`));
    expect(calls.slice(1).map((c) => c.method)).toEqual(['deleteMessage', 'answerCallbackQuery']);
    expect(calls.at(-1)!.payload).toMatchObject({ text: texts.deleted });
    expect(flow.sessions).toEqual([]);
  });

  it('answers buttons of finished or pre-upgrade polls as closed', async () => {
    await bot.handleUpdate(callback('start_now'));
    await bot.handleUpdate(callback('start:gone'));
    expect(calls.map((c) => c.payload.text)).toEqual([texts.startNowClosed, texts.startNowClosed]);
  });

  it('starts with a chosen game on /play <name>', async () => {
    await bot.handleUpdate(message(group, '/play@ZemaGamesBot exploding kittens'));
    expect(calls[0]).toMatchObject({ method: 'sendPoll' });
    expect(String(calls[0]!.payload.question)).toContain('Exploding Kittens (2-10 հոգի)');
  });

  it('lists the games when /play <name> matches nothing', async () => {
    await bot.handleUpdate(message(group, '/play chess'));
    expect(calls[0]!.method).toBe('sendMessage');
    expect(String(calls[0]!.payload.text)).toBe(
      texts.gameNotFound('Blokus, Azul, Exploding Kittens, Spot it, Gartic Phone, Bloomgrid, Kitten Kaboom'),
    );
  });

  it('ignores other groups', async () => {
    await bot.handleUpdate(message({ id: -100999, type: 'supergroup' }, '/help'));
    await bot.handleUpdate(message({ id: -100999, type: 'supergroup' }, '/play'));
    expect(calls).toEqual([]);
  });
});
