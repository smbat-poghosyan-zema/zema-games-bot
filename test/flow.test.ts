import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Poll, PollAnswer, User } from 'grammy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../src/format.js';
import { callbacks, GameFlow, type FlowApi } from '../src/flow.js';
import { JsonStore } from '../src/store.js';
import { texts } from '../src/texts.js';
import { game, seq } from './helpers.js';

const CHAT = -100500;
const games = [game('Small', 2, 4), game('Mid', 3, 6), game('Party', 4, 8, { type: 'online', link: 'https://example.com' })];
const [SMALL, MID, PARTY] = [0, 1, 2];

const ann: Player = { id: 1, firstName: 'Ann' };
const bob: Player = { id: 2, firstName: 'Bob' };

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
    sendPoll: vi.fn(async (_chat: number, question: string, options: { text: string }[], extra?: unknown) => {
      const id = nextMessage++;
      sent.push({ method: 'sendPoll', text: question, options: options.map((o) => o.text), extra });
      return { message_id: id, poll: { id: `poll-${id}` } };
    }),
    stopPoll: vi.fn(async () => {
      throw new Error('poll has already been closed');
    }),
    editMessageReplyMarkup: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
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
      pickerSeconds: 300,
      timezone: 'Asia/Yerevan',
      fallbackGraceMs: 60_000,
      rng,
    });

  const own = (flow: GameFlow, starter: Player) => flow.sessions.find((s) => s.starter.id === starter.id)!;

  /** Opens the picker for `starter`, ticks `picks` and presses Done. Returns the join poll id. */
  async function pickGames(flow: GameFlow, starter: Player, picks: number[]): Promise<string> {
    expect(await flow.start(starter)).toBe('started');
    const id = own(flow, starter).id;
    for (const i of picks) expect(await flow.togglePick(starter, id, i)).toBe('ok');
    expect(await flow.finishPicking(starter, id)).toBe('ok');
    return own(flow, starter).join!.pollId;
  }

  async function joinPlayers(flow: GameFlow, pollId: string, ids: number[]) {
    for (const id of ids) await flow.onPollAnswer(answer(pollId, user(id, `u${id}`), [0]));
  }

  describe('game picker', () => {
    it('shows every game as a button plus Done and Delete', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann);
      const id = own(flow, ann).id;
      expect(own(flow, ann).stage).toBe('picking');
      expect(sent[0]!.text).toBe(texts.pickerPrompt('<a href="tg://user?id=1">Ann</a>', 5));
      expect(sent[0]!.extra).toMatchObject({
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⬜ Small', callback_data: callbacks.pick(id, SMALL) },
              { text: '⬜ Mid', callback_data: callbacks.pick(id, MID) },
            ],
            [{ text: '⬜ Party', callback_data: callbacks.pick(id, PARTY) }],
            [
              { text: texts.pickerDoneButton, callback_data: callbacks.pickDone(id) },
              { text: texts.deleteButton, callback_data: callbacks.remove(id) },
            ],
          ],
        },
      });
    });

    it('toggles ticks in catalog order and redraws the buttons', async () => {
      const { api } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann);
      const id = own(flow, ann).id;
      await flow.togglePick(ann, id, PARTY);
      await flow.togglePick(ann, id, SMALL);
      await flow.togglePick(ann, id, MID);
      await flow.togglePick(ann, id, MID);
      expect(own(flow, ann).picker!.selected).toEqual(['Small', 'Party']);
      expect(api.editMessageReplyMarkup).toHaveBeenLastCalledWith(CHAT, own(flow, ann).picker!.messageId, {
        reply_markup: { inline_keyboard: expect.arrayContaining([[expect.objectContaining({ text: '✅ Small' }), expect.objectContaining({ text: '⬜ Mid' })]]) },
      });
    });

    it('lets only the starter tick and finish, and needs at least one game', async () => {
      const { api } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann);
      const id = own(flow, ann).id;
      expect(await flow.togglePick(bob, id, SMALL)).toBe('forbidden');
      expect(await flow.finishPicking(bob, id)).toBe('forbidden');
      expect(await flow.finishPicking(ann, id)).toBe('empty');
      expect(await flow.togglePick(ann, 'nope', SMALL)).toBe('none');
    });

    it('posts a join poll naming the starter and the ticked games, then removes the picker', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await pickGames(flow, ann, [SMALL, PARTY]);
      const session = own(flow, ann);
      expect(session.stage).toBe('joining');
      expect(session.candidates).toEqual(['Small', 'Party']);
      expect(session.picker).toBeUndefined();
      expect(api.deleteMessage).toHaveBeenCalledWith(CHAT, 1);
      const poll = sent.at(-1)!;
      expect(poll.text).toBe(texts.joinPollQuestion('Ann', 'Small, Party', 5));
      expect(poll.extra).toMatchObject({
        is_anonymous: false,
        open_period: 300,
        reply_markup: {
          inline_keyboard: [
            [
              { text: texts.startNowButton, callback_data: callbacks.start(session.id) },
              { text: texts.deleteButton, callback_data: callbacks.remove(session.id) },
            ],
          ],
        },
      });
    });

    it('treats a single ticked game like /play <game>', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const poll = await pickGames(flow, ann, [MID]);
      expect(own(flow, ann).chosenGame).toBe('Mid');
      expect(sent.at(-1)!.text).toBe(texts.joinPollQuestionForGame('Ann', 'Mid', '3-6', 5));
      await joinPlayers(flow, poll, [1, 2, 3]);
      await flow.onPoll(closed(poll));
      expect(sent.at(-1)!.text).toBe(texts.teamReady({ game: 'Mid', mentions: '@u1, @u2, @u3' }));
    });

    it('drops an unfinished picker after its time runs out', async () => {
      vi.useFakeTimers();
      try {
        const { api } = fakeApi();
        const flow = makeFlow(api);
        await flow.start(ann);
        await vi.advanceTimersByTimeAsync(300_000 + 60_000 + 10);
        expect(flow.sessions).toEqual([]);
        expect(api.deleteMessage).toHaveBeenCalledWith(CHAT, 1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('after the join poll', () => {
    it('lets the joined players vote among the ticked games that fit', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID, PARTY]);

      await flow.onPollAnswer(answer(joinPoll, user(1, 'ann'), [0]));
      await flow.onPollAnswer(answer(joinPoll, user(2), [0]));
      await flow.onPollAnswer(answer(joinPoll, user(3, 'cat'), [0]));
      await flow.onPollAnswer(answer(joinPoll, user(4, 'dan'), [1])); // said no
      await flow.onPollAnswer(answer(joinPoll, user(5, 'eve'), [0]));
      await flow.onPollAnswer(answer(joinPoll, user(5, 'eve'), [])); // retracted
      expect(own(flow, ann).players.map((p) => p.id)).toEqual([1, 2, 3]);

      await flow.onPoll(closed(joinPoll));
      expect(own(flow, ann).stage).toBe('voting');
      expect(api.editMessageReplyMarkup).toHaveBeenLastCalledWith(CHAT, own(flow, ann).join!.messageId);
      expect(sent.at(-1)!.options).toEqual(['Small', 'Mid']);

      const votePoll = own(flow, ann).vote!.pollId;
      await flow.onPollAnswer(answer(votePoll, user(1, 'ann'), [1]));
      await flow.onPollAnswer(answer(votePoll, user(2), [1]));
      await flow.onPollAnswer(answer(votePoll, user(3, 'cat'), [0]));
      await flow.onPollAnswer(answer(votePoll, user(9, 'outsider'), [0])); // not joined, ignored
      await flow.onPoll(closed(votePoll, [2, 2]));

      expect(flow.sessions).toEqual([]);
      const final = sent.at(-1)!.text;
      expect(final).toContain(texts.voteWinner('Mid'));
      expect(final).toContain('@ann');
      expect(final).toContain('<a href="tg://user?id=2">User2</a>');
      expect(final).toContain('@cat');
    });

    it('announces the tie and the random pick', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api, seq(0.99));
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      await joinPlayers(flow, joinPoll, [1, 2, 3]);
      await flow.onPoll(closed(joinPoll));
      const votePoll = own(flow, ann).vote!.pollId;
      await flow.onPollAnswer(answer(votePoll, user(1, 'u1'), [0]));
      await flow.onPollAnswer(answer(votePoll, user(2, 'u2'), [1]));
      await flow.onPoll(closed(votePoll));
      expect(sent.at(-1)!.text).toContain(texts.voteTie('Small, Mid', 'Mid'));
    });

    it('skips the vote when one ticked game fits and includes the online link', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, PARTY]);
      await joinPlayers(flow, joinPoll, [1, 2, 3, 4, 5, 6, 7]);
      await flow.onPoll(closed(joinPoll));
      expect(flow.sessions).toEqual([]);
      expect(sent.filter((s) => s.method === 'sendPoll')).toHaveLength(1);
      expect(sent.at(-1)!.text).toContain(texts.singleGame(7, 'Party'));
      expect(sent.at(-1)!.text).toContain('https://example.com');
    });

    it('suggests other games when none of the ticked ones fits', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [MID, PARTY]);
      await joinPlayers(flow, joinPoll, [1, 2]);
      await flow.onPoll(closed(joinPoll));
      expect(flow.sessions).toEqual([]);
      expect(sent.at(-1)!.text).toBe(texts.noPickedFit(2, 'Small', '@u1, @u2'));
    });

    it('splits into groups using the ticked games when too many joined', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      await joinPlayers(flow, joinPoll, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      await flow.onPoll(closed(joinPoll));
      const text = sent.at(-1)!.text;
      expect(text).toContain(texts.splitIntro(10));
      expect(text).toContain('<b>Խումբ 1</b> (5 հոգի)');
      expect(text).toContain('Խաղեր՝ Mid');
      expect(text).not.toContain('Party');
      for (let id = 1; id <= 10; id++) expect(text).toContain(`@u${id}`);
    });

    it('ends with too few players', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      await joinPlayers(flow, joinPoll, [1]);
      await flow.onPoll(closed(joinPoll));
      expect(flow.sessions).toEqual([]);
      expect(sent.at(-1)!.text).toBe(texts.tooFew(2));
    });

    it('ignores a duplicate close update', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      await flow.onPoll(closed(joinPoll));
      await flow.onPoll(closed(joinPoll));
      expect(sent.filter((s) => s.text === texts.tooFew(2))).toHaveLength(1);
    });

    it('finalizes via the fallback timer when no close update arrives', async () => {
      vi.useFakeTimers();
      try {
        const { api, sent } = fakeApi();
        const flow = makeFlow(api);
        await pickGames(flow, ann, [SMALL, MID]);
        await vi.advanceTimersByTimeAsync(300_000 + 60_000 + 10);
        expect(api.stopPoll).toHaveBeenCalled();
        expect(flow.sessions).toEqual([]);
        expect(sent.at(-1)!.text).toBe(texts.tooFew(2));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('parallel sessions', () => {
    it('runs sessions of different starters side by side', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const annPoll = await pickGames(flow, ann, [SMALL, MID]);
      const bobPoll = await pickGames(flow, bob, [PARTY, MID]);
      expect(flow.sessions).toHaveLength(2);

      await joinPlayers(flow, annPoll, [1, 3]);
      await joinPlayers(flow, bobPoll, [2, 3, 4, 5]); // 3 joined both
      expect(own(flow, ann).players.map((p) => p.id)).toEqual([1, 3]);
      expect(own(flow, bob).players.map((p) => p.id)).toEqual([2, 3, 4, 5]);

      await flow.onPoll(closed(annPoll));
      expect(sent.at(-1)!.text).toContain(texts.singleGame(2, 'Small'));
      expect(flow.sessions.map((s) => s.starter.id)).toEqual([2]);
      expect(own(flow, bob).stage).toBe('joining');
    });

    it('asks a starter with an open session before replacing it', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await pickGames(flow, ann, [SMALL, MID]);
      const old = own(flow, ann);

      expect(await flow.start(ann, games[PARTY])).toBe('own');
      expect(flow.sessions).toHaveLength(1);
      const prompt = sent.at(-1)!;
      expect(prompt.text).toBe(texts.ownSessionExists('<a href="tg://user?id=1">Ann</a>'));
      expect(prompt.extra).toMatchObject({
        reply_parameters: { message_id: old.join!.messageId },
        reply_markup: {
          inline_keyboard: [
            [
              { text: texts.replaceButton, callback_data: callbacks.replace(old.id, PARTY) },
              { text: texts.keepButton, callback_data: callbacks.keep(ann.id) },
            ],
          ],
        },
      });

      expect(await flow.replace(bob, old.id, games[PARTY])).toBe('forbidden');
      expect(await flow.replace(ann, old.id, games[PARTY])).toBe('started');
      expect(api.deleteMessage).toHaveBeenLastCalledWith(CHAT, old.join!.messageId);
      expect(flow.sessions).toHaveLength(1);
      expect(own(flow, ann).id).not.toBe(old.id);
      expect(own(flow, ann).chosenGame).toBe('Party');
    });

    it('survives a restart', async () => {
      const { api } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      await joinPlayers(flow, joinPoll, [1]);
      flow.stop();

      // A new process reads the same file and keeps going.
      const restarted = makeFlow(api);
      expect(own(restarted, ann).players.map((p) => p.id)).toEqual([1]);
      await joinPlayers(restarted, joinPoll, [2, 3]);
      await restarted.onPoll(closed(joinPoll));
      expect(own(restarted, ann).stage).toBe('voting');
      restarted.stop();
    });

    it('drops a version 1 state but keeps the reminder bookkeeping', () => {
      writeFileSync(
        file,
        JSON.stringify({ version: 1, session: { starterId: 1 }, lastReminderDate: '2026-11-05', lastReminderIndex: 2 }),
      );
      expect(new JsonStore(file).get()).toEqual({
        version: 2,
        sessions: [],
        lastReminderDate: '2026-11-05',
        lastReminderIndex: 2,
      });
    });
  });

  describe('start now button', () => {
    it('closes the join poll early, only for the starter', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      const id = own(flow, ann).id;
      await joinPlayers(flow, joinPoll, [1, 2, 3]);
      api.stopPoll.mockResolvedValueOnce(closed(joinPoll) as never);

      expect(await flow.startNow(bob, id)).toBe('forbidden');
      expect(await flow.startNow(ann, id)).toBe('ok');
      expect(api.stopPoll).toHaveBeenCalledWith(CHAT, own(flow, ann).join!.messageId);
      expect(own(flow, ann).stage).toBe('voting');
      expect(sent.at(-1)!.options).toEqual(['Small', 'Mid']);

      // The `poll` update Telegram sends for the stopped poll changes nothing.
      await flow.onPoll(closed(joinPoll));
      expect(own(flow, ann).stage).toBe('voting');
      expect(sent.filter((s) => s.method === 'sendPoll')).toHaveLength(2);
    });

    it('refuses an admin who is not the starter', async () => {
      const { api } = fakeApi([7]);
      const flow = makeFlow(api);
      const joinPoll = await pickGames(flow, ann, [SMALL, MID]);
      await joinPlayers(flow, joinPoll, [1, 2]);
      expect(await flow.startNow({ id: 7, firstName: 'Admin' }, own(flow, ann).id)).toBe('forbidden');
    });

    it('needs the required players', async () => {
      const { api } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann, games[MID]);
      const id = own(flow, ann).id;
      await joinPlayers(flow, own(flow, ann).join!.pollId, [1, 2]);
      expect(flow.requiredPlayersFor(id)).toBe(3);
      expect(await flow.startNow(ann, id)).toBe('tooFew');
      expect(api.stopPoll).not.toHaveBeenCalled();
    });

    it('says the poll is closed for an unknown session', async () => {
      const { api } = fakeApi();
      expect(await makeFlow(api).startNow(ann, 'gone')).toBe('none');
    });
  });

  describe('delete', () => {
    it('lets the starter or an admin delete, nobody else', async () => {
      const { api } = fakeApi([7]);
      const flow = makeFlow(api);
      await pickGames(flow, ann, [SMALL, MID]);
      const { id, join: joinRef } = own(flow, ann);
      expect(await flow.remove(bob, id)).toBe('forbidden');
      expect(await flow.remove({ id: 7, firstName: 'Admin' }, id)).toBe('ok');
      expect(api.deleteMessage).toHaveBeenLastCalledWith(CHAT, joinRef!.messageId);
      expect(flow.sessions).toEqual([]);
      expect(await flow.remove(ann, id)).toBe('none');
    });

    it('deletes a picker too', async () => {
      const { api } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann);
      expect(await flow.remove(ann, own(flow, ann).id)).toBe('ok');
      expect(api.deleteMessage).toHaveBeenCalledWith(CHAT, 1);
      expect(flow.sessions).toEqual([]);
    });

    it('closes the poll when Telegram refuses to delete it', async () => {
      const { api } = fakeApi();
      const flow = makeFlow(api);
      await pickGames(flow, ann, [SMALL, MID]);
      api.deleteMessage.mockRejectedValueOnce(new Error('message to delete not found'));
      await flow.remove(ann, own(flow, ann).id);
      expect(api.stopPoll).toHaveBeenCalled();
    });

    it('/cancel deletes the caller\'s own session', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      expect(await flow.cancel(ann)).toBe('none');
      await pickGames(flow, ann, [SMALL, MID]);
      await pickGames(flow, bob, [SMALL, MID]);
      expect(await flow.cancel({ ...bob, username: 'bob' })).toBe('cancelled');
      expect(flow.sessions.map((s) => s.starter.id)).toEqual([1]);
      expect(sent.at(-1)!.text).toBe(texts.cancelled('@bob'));
    });
  });

  describe('chosen game (/play <game>)', () => {
    const mid = games[MID]!;

    it('names the starter and the game in the poll and skips the vote', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann, mid);
      expect(sent[0]!.text).toBe(texts.joinPollQuestionForGame('Ann', 'Mid', '3-6', 5));
      const joinPoll = own(flow, ann).join!.pollId;
      await joinPlayers(flow, joinPoll, [1, 2, 3]);
      await flow.onPoll(closed(joinPoll));
      expect(flow.sessions).toEqual([]);
      expect(sent.filter((s) => s.method === 'sendPoll')).toHaveLength(1);
      expect(sent.at(-1)!.text).toBe(texts.teamReady({ game: 'Mid', mentions: '@u1, @u2, @u3' }));
    });

    it('ends when fewer than the game minimum joined', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann, mid);
      const joinPoll = own(flow, ann).join!.pollId;
      await joinPlayers(flow, joinPoll, [1, 2]);
      await flow.onPoll(closed(joinPoll));
      expect(sent.at(-1)!.text).toBe(texts.tooFewForGame('Mid', 3, 2));
    });

    it('splits into groups for that game when too many joined', async () => {
      const { api, sent } = fakeApi();
      const flow = makeFlow(api);
      await flow.start(ann, mid);
      const joinPoll = own(flow, ann).join!.pollId;
      await joinPlayers(flow, joinPoll, [1, 2, 3, 4, 5, 6, 7, 8]);
      await flow.onPoll(closed(joinPoll));
      expect(sent.at(-1)!.text).toContain(texts.splitIntroForGame('Mid', 8, 6));
      expect(sent.at(-1)!.text).toContain('(4 հոգի)');
    });
  });

  it('sends one reminder per day with a play button and skips while a session is open', async () => {
    const { api, sent } = fakeApi();
    const flow = makeFlow(api, seq(0));
    await flow.start(ann);
    expect(await flow.sendReminder()).toBe('skipped');
    await flow.remove(ann, own(flow, ann).id);

    expect(await flow.sendReminder()).toBe('sent');
    expect(texts.reminders).toContain(sent.at(-1)!.text);
    expect(sent.at(-1)!.extra).toMatchObject({
      reply_markup: { inline_keyboard: [[{ callback_data: 'play' }]] },
    });
    expect(await flow.sendReminder()).toBe('skipped');
  });
});
