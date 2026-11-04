import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Poll, PollAnswer, User } from 'grammy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameFlow, type FlowApi } from '../src/flow.js';
import { JsonStore } from '../src/store.js';
import { texts } from '../src/texts.js';
import { game, seq } from './helpers.js';

const CHAT = -100500;
const games = [game('Small', 2, 4), game('Mid', 3, 6), game('Party', 4, 8, { type: 'online', link: 'https://example.com' })];

const user = (id: number, username?: string): User => ({
  id,
  is_bot: false,
  first_name: `User${id}`,
  ...(username ? { username } : {}),
});

function fakeApi(adminIds: number[] = []) {
  let nextMessage = 1;
  const sent: { method: string; text: string; options?: unknown; extra?: unknown }[] = [];
  const api = {
    sendMessage: vi.fn(async (_chat: number, text: string, extra?: unknown) => {
      sent.push({ method: 'sendMessage', text, extra });
      return { message_id: nextMessage++ };
    }),
    sendPoll: vi.fn(async (_chat: number, question: string, options: { text: string }[]) => {
      const id = nextMessage++;
      sent.push({ method: 'sendPoll', text: question, options: options.map((o) => o.text) });
      return { message_id: id, poll: { id: `poll-${id}` } };
    }),
    stopPoll: vi.fn(async () => {
      throw new Error('poll has already been closed');
    }),
    getChatMember: vi.fn(async (_chat: number, userId: number) => ({
      status: adminIds.includes(userId) ? 'administrator' : 'member',
    })),
  };
  return { api: api as unknown as FlowApi & typeof api, sent };
}

const answer = (pollId: string, u: User, optionIds: number[]): PollAnswer =>
  ({ poll_id: pollId, user: u, option_ids: optionIds }) as PollAnswer;

const closed = (pollId: string, counts: number[] = []): Poll =>
  ({ id: pollId, is_closed: true, options: counts.map((c, i) => ({ text: `o${i}`, voter_count: c })) }) as Poll;

describe('GameFlow', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zema-games-'));
    file = join(dir, 'state.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const makeFlow = (api: FlowApi, rng = seq(0)) =>
    new GameFlow(api, new JsonStore(file), games, {
      chatId: CHAT,
      joinPollSeconds: 300,
      gamePollSeconds: 120,
      timezone: 'Asia/Yerevan',
      fallbackGraceMs: 60_000,
      rng,
    });

  it('runs join poll -> game poll -> final message with mentions', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api);

    expect(await flow.start({ id: 1, firstName: 'Ann' })).toBe('started');
    const joinPoll = flow.session!.join.pollId;

    await flow.onPollAnswer(answer(joinPoll, user(1, 'ann'), [0]));
    await flow.onPollAnswer(answer(joinPoll, user(2), [0]));
    await flow.onPollAnswer(answer(joinPoll, user(3, 'cat'), [0]));
    await flow.onPollAnswer(answer(joinPoll, user(4, 'dan'), [1])); // said no
    await flow.onPollAnswer(answer(joinPoll, user(5, 'eve'), [0]));
    await flow.onPollAnswer(answer(joinPoll, user(5, 'eve'), [])); // retracted
    expect(flow.session!.players.map((p) => p.id)).toEqual([1, 2, 3]);

    await flow.onPoll(closed(joinPoll));
    expect(flow.session!.stage).toBe('voting');
    const gamePoll = sent.at(-1)!;
    expect(gamePoll.method).toBe('sendPoll');
    expect(gamePoll.options).toEqual(['Small', 'Mid']);

    const votePoll = flow.session!.vote!.pollId;
    await flow.onPollAnswer(answer(votePoll, user(1, 'ann'), [1]));
    await flow.onPollAnswer(answer(votePoll, user(2), [1]));
    await flow.onPollAnswer(answer(votePoll, user(3, 'cat'), [0]));
    await flow.onPollAnswer(answer(votePoll, user(9, 'outsider'), [0])); // not joined, ignored
    await flow.onPoll(closed(votePoll, [2, 2]));

    expect(flow.session).toBeNull();
    const final = sent.at(-1)!.text;
    expect(final).toContain(texts.voteWinner('Mid'));
    expect(final).toContain('@ann');
    expect(final).toContain('<a href="tg://user?id=2">User2</a>');
    expect(final).toContain('@cat');
  });

  it('announces the tie and the random pick', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api, seq(0.99));
    await flow.start({ id: 1, firstName: 'Ann' });
    const joinPoll = flow.session!.join.pollId;
    for (const id of [1, 2, 3]) await flow.onPollAnswer(answer(joinPoll, user(id, `u${id}`), [0]));
    await flow.onPoll(closed(joinPoll));
    const votePoll = flow.session!.vote!.pollId;
    await flow.onPollAnswer(answer(votePoll, user(1, 'u1'), [0]));
    await flow.onPollAnswer(answer(votePoll, user(2, 'u2'), [1]));
    await flow.onPoll(closed(votePoll));
    expect(sent.at(-1)!.text).toContain(texts.voteTie('Small, Mid', 'Mid'));
  });

  it('skips the vote when one game fits and includes the online link', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api);
    await flow.start({ id: 1, firstName: 'Ann' });
    const joinPoll = flow.session!.join.pollId;
    for (const id of [1, 2, 3, 4, 5, 6, 7]) await flow.onPollAnswer(answer(joinPoll, user(id, `u${id}`), [0]));
    await flow.onPoll(closed(joinPoll));
    expect(flow.session).toBeNull();
    expect(sent.filter((s) => s.method === 'sendPoll')).toHaveLength(1);
    expect(sent.at(-1)!.text).toContain('<b>Party</b>');
    expect(sent.at(-1)!.text).toContain('https://example.com');
  });

  it('cancels with too few players', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api);
    await flow.start({ id: 1, firstName: 'Ann' });
    const joinPoll = flow.session!.join.pollId;
    await flow.onPollAnswer(answer(joinPoll, user(1), [0]));
    await flow.onPoll(closed(joinPoll));
    expect(flow.session).toBeNull();
    expect(sent.at(-1)!.text).toBe(texts.tooFew(2));
  });

  it('suggests groups when too many players joined', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api);
    await flow.start({ id: 1, firstName: 'Ann' });
    const joinPoll = flow.session!.join.pollId;
    for (let id = 1; id <= 10; id++) await flow.onPollAnswer(answer(joinPoll, user(id, `u${id}`), [0]));
    await flow.onPoll(closed(joinPoll));
    const text = sent.at(-1)!.text;
    expect(text).toContain(texts.splitIntro(10));
    expect(text).toContain('<b>Խումբ 1</b> (5 հոգի)');
    expect(text).toContain('<b>Խումբ 2</b> (5 հոգի)');
    for (let id = 1; id <= 10; id++) expect(text).toContain(`@u${id}`);
  });

  it('allows only one session and survives a restart', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api);
    await flow.start({ id: 1, firstName: 'Ann' });
    expect(await flow.start({ id: 2, firstName: 'Bob' })).toBe('active');
    expect(sent.at(-1)!.text).toBe(texts.sessionAlreadyActive);

    const joinPoll = flow.session!.join.pollId;
    await flow.onPollAnswer(answer(joinPoll, user(1, 'a'), [0]));
    flow.stop();

    // A new process reads the same file and keeps going.
    const restarted = makeFlow(api);
    expect(restarted.session?.players.map((p) => p.id)).toEqual([1]);
    await restarted.onPollAnswer(answer(joinPoll, user(2, 'b'), [0]));
    await restarted.onPollAnswer(answer(joinPoll, user(3, 'c'), [0]));
    await restarted.onPoll(closed(joinPoll));
    expect(restarted.session?.stage).toBe('voting');
  });

  it('ignores a duplicate close update', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api);
    await flow.start({ id: 1, firstName: 'Ann' });
    const joinPoll = flow.session!.join.pollId;
    await flow.onPoll(closed(joinPoll));
    await flow.onPoll(closed(joinPoll));
    expect(sent.filter((s) => s.text === texts.tooFew(2))).toHaveLength(1);
  });

  it('lets only the starter or an admin cancel', async () => {
    const { api, sent } = fakeApi([7]);
    const flow = makeFlow(api);
    expect(await flow.cancel({ id: 1, firstName: 'Ann' })).toBe('none');
    await flow.start({ id: 1, firstName: 'Ann' });
    expect(await flow.cancel({ id: 2, firstName: 'Bob' })).toBe('forbidden');
    expect(await flow.cancel({ id: 7, firstName: 'Admin', username: 'boss' })).toBe('cancelled');
    expect(flow.session).toBeNull();
    expect(api.stopPoll).toHaveBeenCalled();
    expect(sent.at(-1)!.text).toBe(texts.cancelled('@boss'));
  });

  it('finalizes via the fallback timer when no close update arrives', async () => {
    vi.useFakeTimers();
    try {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await flow.start({ id: 1, firstName: 'Ann' });
      await vi.advanceTimersByTimeAsync(300_000 + 60_000 + 10);
      expect(api.stopPoll).toHaveBeenCalled();
      expect(flow.session).toBeNull();
      expect(sent.at(-1)!.text).toBe(texts.tooFew(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends one reminder per day with a play button and skips during a session', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api, seq(0));
    expect(await flow.sendReminder()).toBe('sent');
    expect(texts.reminders).toContain(sent.at(-1)!.text);
    expect(sent.at(-1)!.extra).toMatchObject({
      reply_markup: { inline_keyboard: [[{ callback_data: 'play' }]] },
    });
    expect(await flow.sendReminder()).toBe('skipped');
  });
});
