import { randomUUID } from 'node:crypto';
import type { Api } from 'grammy';
import type { Poll, PollAnswer } from 'grammy/types';
import type { Game } from './games.js';
import { escapeHtml, gameNames, mention, mentionAll, teamReadyMessage, toPlayer, type Player } from './format.js';
import { dealIntoGroups, MIN_PLAYERS_TO_PLAY, planAfterJoin, resolveVote, type Rng } from './plan.js';
import { localDateKey } from './schedule.js';
import { log } from './log.js';
import type { JsonStore, Session } from './store.js';
import { texts } from './texts.js';

/** The Bot API methods the flow needs; a narrow type keeps tests simple. */
export type FlowApi = Pick<Api, 'sendMessage' | 'sendPoll' | 'stopPoll' | 'getChatMember' | 'editMessageReplyMarkup'>;

export interface FlowOptions {
  chatId: number;
  joinPollSeconds: number;
  gamePollSeconds: number;
  timezone: string;
  /** Extra wait after a poll's close time before the fallback finalizer runs. */
  fallbackGraceMs?: number;
  rng?: Rng;
  now?: () => Date;
}

const HTML = { parse_mode: 'HTML' } as const;
export const PLAY_CALLBACK = 'play';
export const START_NOW_CALLBACK = 'start_now';

/**
 * Drives one game session at a time:
 * join poll -> (game poll) -> final message.
 *
 * Telegram's own updates move the session forward (poll_answer for joins/votes and the
 * `poll` update with is_closed=true when open_period ends). State is persisted after every
 * change, and a fallback timer finalizes a poll if its close update never arrives.
 */
export class GameFlow {
  private queue: Promise<unknown> = Promise.resolve();
  private fallbackTimer: NodeJS.Timeout | undefined;
  private readonly rng: Rng;
  private readonly now: () => Date;
  private readonly graceMs: number;

  constructor(
    private readonly api: FlowApi,
    private readonly store: JsonStore,
    private readonly games: readonly Game[],
    private readonly opts: FlowOptions,
  ) {
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? (() => new Date());
    this.graceMs = opts.fallbackGraceMs ?? 15_000;
  }

  get session(): Session | null {
    return this.store.get().session;
  }

  /** Runs tasks one after another so concurrent updates can't corrupt the session. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Re-arms the fallback timer after a restart. */
  resume(): void {
    this.armFallback();
  }

  stop(): void {
    clearTimeout(this.fallbackTimer);
  }

  start(starter: Player): Promise<'started' | 'active'> {
    return this.exclusive(async () => {
      const active = this.session;
      if (active) {
        const replyTo = active.stage === 'voting' && active.vote ? active.vote.messageId : active.join.messageId;
        await this.api.sendMessage(this.opts.chatId, texts.sessionAlreadyActive, {
          reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
        });
        return 'active';
      }

      const minutes = Math.round(this.opts.joinPollSeconds / 60);
      const msg = await this.api.sendPoll(
        this.opts.chatId,
        texts.joinPollQuestion(minutes),
        [{ text: texts.joinOptionYes }, { text: texts.joinOptionNo }],
        {
          is_anonymous: false,
          open_period: this.opts.joinPollSeconds,
          reply_markup: { inline_keyboard: [[{ text: texts.startNowButton, callback_data: START_NOW_CALLBACK }]] },
        },
      );
      if (!msg.poll) throw new Error('sendPoll returned no poll');

      this.store.update((s) => {
        s.session = {
          id: randomUUID(),
          chatId: this.opts.chatId,
          starterId: starter.id,
          startedAt: this.now().toISOString(),
          stage: 'joining',
          join: {
            pollId: msg.poll!.id,
            messageId: msg.message_id,
            closesAt: this.closesAt(this.opts.joinPollSeconds),
          },
          players: [],
        };
      });
      this.armFallback();
      return 'started';
    });
  }

  onPollAnswer(answer: PollAnswer): Promise<void> {
    return this.exclusive(async () => {
      const session = this.session;
      const user = answer.user;
      if (!session || !user) return;

      if (session.stage === 'joining' && answer.poll_id === session.join.pollId) {
        const joined = answer.option_ids.includes(0);
        this.store.update((s) => {
          const players = s.session!.players.filter((p) => p.id !== user.id);
          s.session!.players = joined ? [...players, toPlayer(user)] : players;
        });
      } else if (session.stage === 'voting' && answer.poll_id === session.vote?.pollId) {
        this.store.update((s) => {
          const votes = s.session!.vote!.votes;
          if (answer.option_ids.length === 0) delete votes[user.id];
          else votes[user.id] = [...answer.option_ids];
        });
      }
    });
  }

  /** Handles `poll` updates; only closed polls of the active session matter. */
  onPoll(poll: Poll): Promise<void> {
    if (!poll.is_closed) return Promise.resolve();
    return this.exclusive(() => this.finishPoll(poll.id, poll));
  }

  /**
   * Closes the join poll early ("start now" button) once enough players joined.
   * Joined players, the starter and group admins may do it.
   */
  startNow(by: Player): Promise<'started' | 'none' | 'tooFew' | 'forbidden'> {
    return this.exclusive(async () => {
      const session = this.session;
      if (!session || session.stage !== 'joining') return 'none';
      const allowed =
        by.id === session.starterId || session.players.some((p) => p.id === by.id) || (await this.isAdmin(by.id));
      if (!allowed) return 'forbidden';
      if (session.players.length < MIN_PLAYERS_TO_PLAY) return 'tooFew';

      // stopPoll returns the closed poll; Telegram also sends a `poll` update for it, which
      // finishPoll ignores because the stage has already moved on.
      const poll = await this.api.stopPoll(this.opts.chatId, session.join.messageId).catch(() => undefined);
      await this.finishPoll(session.join.pollId, poll);
      return 'started';
    });
  }

  cancel(by: Player): Promise<'cancelled' | 'none' | 'forbidden'> {
    return this.exclusive(async () => {
      const session = this.session;
      if (!session) return 'none';
      if (by.id !== session.starterId && !(await this.isAdmin(by.id))) return 'forbidden';

      this.clearSession();
      const messageId = session.stage === 'voting' && session.vote ? session.vote.messageId : session.join.messageId;
      await this.api.stopPoll(this.opts.chatId, messageId).catch(() => undefined);
      await this.api.sendMessage(this.opts.chatId, texts.cancelled(mention(by)), HTML);
      return 'cancelled';
    });
  }

  /** Sends the daily reminder unless a session is running or it was already sent today. */
  sendReminder(): Promise<'sent' | 'skipped'> {
    return this.exclusive(async () => {
      const state = this.store.get();
      const today = localDateKey(this.now(), this.opts.timezone);
      if (state.session || state.lastReminderDate === today) return 'skipped';

      const count = texts.reminders.length;
      let index = Math.floor(this.rng() * count) % count;
      if (count > 1 && index === state.lastReminderIndex) index = (index + 1) % count;

      await this.api.sendMessage(this.opts.chatId, texts.reminders[index]!, {
        reply_markup: { inline_keyboard: [[{ text: texts.reminderButton, callback_data: PLAY_CALLBACK }]] },
      });
      this.store.update((s) => {
        s.lastReminderDate = today;
        s.lastReminderIndex = index;
      });
      return 'sent';
    });
  }

  // ---------------------------------------------------------------------------

  private closesAt(seconds: number): string {
    return new Date(this.now().getTime() + seconds * 1000).toISOString();
  }

  private async isAdmin(userId: number): Promise<boolean> {
    try {
      const member = await this.api.getChatMember(this.opts.chatId, userId);
      return member.status === 'creator' || member.status === 'administrator';
    } catch {
      return false;
    }
  }

  private clearSession(): void {
    clearTimeout(this.fallbackTimer);
    this.store.update((s) => {
      s.session = null;
    });
  }

  /** Finalizes the current stage if `pollId` belongs to it. Idempotent. */
  private async finishPoll(pollId: string, closedPoll?: Poll): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (session.stage === 'joining' && session.join.pollId === pollId) {
      await this.finishJoin(session);
    } else if (session.stage === 'voting' && session.vote?.pollId === pollId) {
      await this.finishVote(session, closedPoll);
    }
  }

  private async finishJoin(session: Session): Promise<void> {
    const players = session.players;
    const plan = planAfterJoin(this.games, players.length);
    // Drop the "start now" button from the closed join poll.
    await this.api.editMessageReplyMarkup(this.opts.chatId, session.join.messageId).catch(() => undefined);
    const chatId = this.opts.chatId;

    switch (plan.kind) {
      case 'tooFew':
        this.clearSession();
        await this.api.sendMessage(chatId, texts.tooFew(MIN_PLAYERS_TO_PLAY), HTML);
        return;

      case 'single':
        this.clearSession();
        await this.api.sendMessage(
          chatId,
          `${texts.singleGame(players.length, escapeHtml(plan.game.name))}\n\n${teamReadyMessage(plan.game, players)}`,
          HTML,
        );
        return;

      case 'vote': {
        const minutes = Math.round(this.opts.gamePollSeconds / 60);
        const options = plan.games.map((g) => g.name);
        const msg = await this.api.sendPoll(
          chatId,
          texts.gamePollQuestion(players.length, minutes),
          options.map((text) => ({ text })),
          { is_anonymous: false, open_period: this.opts.gamePollSeconds },
        );
        if (!msg.poll) throw new Error('sendPoll returned no poll');
        this.store.update((s) => {
          s.session!.stage = 'voting';
          s.session!.vote = {
            pollId: msg.poll!.id,
            messageId: msg.message_id,
            closesAt: this.closesAt(this.opts.gamePollSeconds),
            options,
            votes: {},
          };
        });
        this.armFallback();
        return;
      }

      case 'split': {
        this.clearSession();
        const groups = dealIntoGroups(players, plan.groups.map((g) => g.size), this.rng);
        const parts = plan.groups.map((g, i) =>
          texts.splitGroup({ index: i + 1, size: g.size, mentions: mentionAll(groups[i]!), games: gameNames(g.games) }),
        );
        await this.api.sendMessage(chatId, [texts.splitIntro(players.length), ...parts, texts.splitOutro].join('\n\n'), HTML);
        return;
      }

      case 'noFit':
        this.clearSession();
        await this.api.sendMessage(chatId, texts.noFit(players.length, mentionAll(players)), HTML);
        return;
    }
  }

  private async finishVote(session: Session, closedPoll?: Poll): Promise<void> {
    const vote = session.vote!;
    const joinedIds = new Set(session.players.map((p) => p.id));
    const counts = vote.options.map(() => 0);

    // Count votes of joined players only (tracked from poll_answer). If none were tracked
    // (e.g. updates were lost), fall back to the totals Telegram sent with the closed poll.
    const tracked = Object.entries(vote.votes).filter(([userId]) => joinedIds.has(Number(userId)));
    if (tracked.length > 0) {
      for (const [, optionIds] of tracked) for (const i of optionIds) if (i < counts.length) counts[i]! += 1;
    } else if (closedPoll) {
      closedPoll.options.forEach((o, i) => {
        if (i < counts.length) counts[i] = o.voter_count;
      });
    }

    const result = resolveVote(vote.options.map((text, i) => ({ text, votes: counts[i]! })), this.rng);
    const game = this.games.find((g) => g.name === result.winner);
    this.clearSession();
    if (!game) throw new Error(`Voted game "${result.winner}" is no longer in games.json`);

    const header = result.wasTie
      ? texts.voteTie(result.tied.map(escapeHtml).join(', '), escapeHtml(game.name))
      : texts.voteWinner(escapeHtml(game.name));
    await this.api.sendMessage(this.opts.chatId, `${header}\n\n${teamReadyMessage(game, session.players)}`, HTML);
  }

  /**
   * Schedules a check shortly after the current poll should have closed. Normally the
   * `poll` update arrives first and this does nothing; otherwise it stops the poll itself
   * (stopPoll returns the final results) and finalizes the stage.
   */
  private armFallback(): void {
    clearTimeout(this.fallbackTimer);
    const session = this.session;
    if (!session) return;
    const ref = session.stage === 'voting' && session.vote ? session.vote : session.join;
    const delay = Math.max(0, new Date(ref.closesAt).getTime() - this.now().getTime()) + this.graceMs;
    this.fallbackTimer = setTimeout(() => {
      void this.exclusive(async () => {
        const current = this.session;
        const currentRef = current?.stage === 'voting' ? current.vote : current?.join;
        if (!currentRef || currentRef.pollId !== ref.pollId) return;
        log.warn(`[flow] no close update for poll ${ref.pollId}, finalizing via fallback`);
        const poll = await this.api.stopPoll(this.opts.chatId, ref.messageId).catch(() => undefined);
        await this.finishPoll(ref.pollId, poll);
      }).catch((err) => log.error('[flow] fallback failed:', err));
    }, delay);
    this.fallbackTimer.unref?.();
  }
}
