import { randomUUID } from 'node:crypto';
import type { Api } from 'grammy';
import type { InlineKeyboardButton, Poll, PollAnswer } from 'grammy/types';
import { gamesForPlayers, type Game } from './games.js';
import {
  displayName,
  escapeHtml,
  gameNames,
  mention,
  mentionAll,
  playersRange,
  teamReadyMessage,
  toPlayer,
  type Player,
} from './format.js';
import { dealIntoGroups, MIN_PLAYERS_TO_PLAY, planAfterJoin, requiredPlayers, resolveVote, type Rng } from './plan.js';
import { localDateKey } from './schedule.js';
import { log } from './log.js';
import type { JsonStore, PollRef, Session } from './store.js';
import { texts } from './texts.js';

/** The Bot API methods the flow needs; a narrow type keeps tests simple. */
export type FlowApi = Pick<
  Api,
  'sendMessage' | 'sendPoll' | 'stopPoll' | 'getChatMember' | 'editMessageReplyMarkup' | 'deleteMessage'
>;

export interface FlowOptions {
  chatId: number;
  joinPollSeconds: number;
  gamePollSeconds: number;
  /** How long the starter has to tick games before the picker is dropped. */
  pickerSeconds?: number;
  timezone: string;
  /** Extra wait after a poll's close time before the fallback finalizer runs. */
  fallbackGraceMs?: number;
  rng?: Rng;
  now?: () => Date;
}

const HTML = { parse_mode: 'HTML' } as const;
/** Telegram's limit for poll questions. */
const MAX_POLL_QUESTION = 300;

/**
 * Callback data. Session ids are short, so every payload stays well under Telegram's 64 bytes.
 * `play` is the button under the daily reminder; `start_now` is the pre-multi-session button,
 * still answered for polls sent before the upgrade.
 */
export const PLAY_CALLBACK = 'play';
export const LEGACY_START_NOW_CALLBACK = 'start_now';
export const callbacks = {
  pick: (sid: string, gameIndex: number) => `pick:${sid}:${gameIndex}`,
  pickDone: (sid: string) => `pickdone:${sid}`,
  start: (sid: string) => `start:${sid}`,
  remove: (sid: string) => `del:${sid}`,
  /** Delete the starter's open session `sid` and open a new one (optionally with a game). */
  replace: (sid: string, gameIndex?: number) => `replace:${sid}:${gameIndex ?? ''}`,
  keep: (userId: number) => `keep:${userId}`,
};

export type StartResult = 'started' | 'own';
export type ActionResult = 'ok' | 'none' | 'forbidden';

/**
 * Drives game sessions. Anyone in the group can open one, at most one per person:
 * game picker -> join poll -> (game poll) -> final message.
 * `/play <game>` skips the picker and the game poll.
 *
 * Telegram's own updates move a session forward (poll_answer for joins/votes and the
 * `poll` update with is_closed=true when open_period ends). State is persisted after every
 * change, and a per-session fallback timer finalizes a stage if its close update never arrives.
 */
export class GameFlow {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly rng: Rng;
  private readonly now: () => Date;
  private readonly graceMs: number;
  private readonly pickerSeconds: number;

  constructor(
    private readonly api: FlowApi,
    private readonly store: JsonStore,
    private readonly games: readonly Game[],
    private readonly opts: FlowOptions,
  ) {
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? (() => new Date());
    this.graceMs = opts.fallbackGraceMs ?? 15_000;
    this.pickerSeconds = opts.pickerSeconds ?? 300;
  }

  get sessions(): readonly Session[] {
    return this.store.get().sessions;
  }

  session(id: string): Session | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  /** Runs tasks one after another so concurrent updates can't corrupt the state. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Re-arms the fallback timers after a restart. */
  resume(): void {
    for (const s of this.sessions) this.armFallback(s.id);
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Players needed to start session `id` early (the chosen game's minimum, or 2). */
  requiredPlayersFor(id: string): number {
    return requiredPlayers(this.chosenGame(this.session(id)));
  }

  private chosenGame(session: Session | undefined): Game | undefined {
    return session?.chosenGame ? this.findGame(session.chosenGame) : undefined;
  }

  private findGame(name: string): Game | undefined {
    return this.games.find((g) => g.name === name);
  }

  /**
   * Opens a session for `starter`: the game picker, or straight the join poll with `game`
   * (/play <game>). A starter who already has an open session is asked to replace it instead.
   */
  start(starter: Player, game?: Game): Promise<StartResult> {
    return this.exclusive(async () => {
      const own = this.sessions.find((s) => s.starter.id === starter.id);
      if (own) {
        const gameIndex = game ? this.games.indexOf(game) : undefined;
        await this.api.sendMessage(this.opts.chatId, texts.ownSessionExists(mention(starter)), {
          ...HTML,
          reply_parameters: { message_id: this.currentMessageId(own), allow_sending_without_reply: true },
          reply_markup: {
            inline_keyboard: [
              [
                { text: texts.replaceButton, callback_data: callbacks.replace(own.id, gameIndex) },
                { text: texts.keepButton, callback_data: callbacks.keep(starter.id) },
              ],
            ],
          },
        });
        return 'own';
      }
      await this.open(starter, game);
      return 'started';
    });
  }

  /** "Delete and open new" button: the owner drops session `oldId` and opens a new one. */
  replace(by: Player, oldId: string, game?: Game): Promise<StartResult | 'forbidden'> {
    return this.exclusive(async () => {
      const old = this.session(oldId);
      if (old && old.starter.id !== by.id) return 'forbidden';
      if (old) await this.discard(old);
      // The old session may have finished meanwhile; a newer one could exist too.
      if (this.sessions.some((s) => s.starter.id === by.id)) return 'own';
      await this.open(by, game);
      return 'started';
    });
  }

  private async open(starter: Player, game?: Game): Promise<void> {
    const id = randomUUID().slice(0, 8);
    const base: Session = {
      id,
      chatId: this.opts.chatId,
      starter,
      startedAt: this.now().toISOString(),
      stage: 'picking',
      players: [],
    };

    if (game) {
      const join = await this.sendJoinPoll({ ...base, chosenGame: game.name });
      this.store.update((s) => {
        s.sessions.push({ ...base, stage: 'joining', chosenGame: game.name, join });
      });
    } else {
      const minutes = Math.round(this.pickerSeconds / 60);
      const msg = await this.api.sendMessage(this.opts.chatId, texts.pickerPrompt(mention(starter), minutes), {
        ...HTML,
        reply_markup: { inline_keyboard: this.pickerKeyboard(id, []) },
      });
      this.store.update((s) => {
        s.sessions.push({
          ...base,
          picker: { messageId: msg.message_id, closesAt: this.closesAt(this.pickerSeconds), selected: [] },
        });
      });
    }
    this.armFallback(id);
  }

  /** Ticks or unticks a game in the picker. Only the starter may. */
  togglePick(by: Player, id: string, gameIndex: number): Promise<ActionResult> {
    return this.exclusive(async () => {
      const session = this.session(id);
      const game = this.games[gameIndex];
      if (!session || session.stage !== 'picking' || !session.picker || !game) return 'none';
      if (session.starter.id !== by.id) return 'forbidden';

      const was = session.picker.selected;
      const selected = was.includes(game.name) ? was.filter((n) => n !== game.name) : [...was, game.name];
      // Keep catalog order so the join poll lists games the same way every time.
      const ordered = this.games.map((g) => g.name).filter((n) => selected.includes(n));
      this.updateSession(id, (s) => {
        s.picker!.selected = ordered;
      });
      await this.api
        .editMessageReplyMarkup(this.opts.chatId, session.picker.messageId, {
          reply_markup: { inline_keyboard: this.pickerKeyboard(id, ordered) },
        })
        .catch((err) => log.warn('[flow] could not update picker:', err));
      return 'ok';
    });
  }

  /** "Done" in the picker: removes it and posts the join poll for the ticked games. */
  finishPicking(by: Player, id: string): Promise<ActionResult | 'empty'> {
    return this.exclusive(async () => {
      const session = this.session(id);
      if (!session || session.stage !== 'picking' || !session.picker) return 'none';
      if (session.starter.id !== by.id) return 'forbidden';
      const selected = session.picker.selected;
      if (selected.length === 0) return 'empty';

      // One ticked game behaves like /play <game>.
      const choice = selected.length === 1 ? { chosenGame: selected[0]! } : { candidates: selected };
      const join = await this.sendJoinPoll({ ...session, ...choice });
      await this.removeMessage(session.picker.messageId);
      this.updateSession(id, (s) => {
        s.stage = 'joining';
        delete s.picker;
        Object.assign(s, choice, { join });
      });
      this.armFallback(id);
      return 'ok';
    });
  }

  onPollAnswer(answer: PollAnswer): Promise<void> {
    return this.exclusive(async () => {
      const user = answer.user;
      if (!user) return;
      const session = this.sessions.find(
        (s) => s.join?.pollId === answer.poll_id || s.vote?.pollId === answer.poll_id,
      );
      if (!session) return;

      if (session.stage === 'joining' && answer.poll_id === session.join?.pollId) {
        const joined = answer.option_ids.includes(0);
        this.updateSession(session.id, (s) => {
          const players = s.players.filter((p) => p.id !== user.id);
          s.players = joined ? [...players, toPlayer(user)] : players;
        });
      } else if (session.stage === 'voting' && answer.poll_id === session.vote?.pollId) {
        this.updateSession(session.id, (s) => {
          const votes = s.vote!.votes;
          if (answer.option_ids.length === 0) delete votes[user.id];
          else votes[user.id] = [...answer.option_ids];
        });
      }
    });
  }

  /** Handles `poll` updates; only closed polls of open sessions matter. */
  onPoll(poll: Poll): Promise<void> {
    if (!poll.is_closed) return Promise.resolve();
    return this.exclusive(() => this.finishPoll(poll.id, poll));
  }

  /** Closes the join poll early ("start now" button). Only the starter may, once enough players joined. */
  startNow(by: Player, id: string): Promise<ActionResult | 'tooFew'> {
    return this.exclusive(async () => {
      const session = this.session(id);
      if (!session || session.stage !== 'joining' || !session.join) return 'none';
      if (session.starter.id !== by.id) return 'forbidden';
      if (session.players.length < requiredPlayers(this.chosenGame(session))) return 'tooFew';

      // stopPoll returns the closed poll; Telegram also sends a `poll` update for it, which
      // finishPoll ignores because the stage has already moved on.
      const poll = await this.api.stopPoll(this.opts.chatId, session.join.messageId).catch(() => undefined);
      await this.finishPoll(session.join.pollId, poll);
      return 'ok';
    });
  }

  /** "Delete" button: the starter or a group admin removes the session and its message. */
  remove(by: Player, id: string): Promise<ActionResult> {
    return this.exclusive(async () => {
      const session = this.session(id);
      if (!session) return 'none';
      if (by.id !== session.starter.id && !(await this.isAdmin(by.id))) return 'forbidden';
      await this.discard(session);
      return 'ok';
    });
  }

  /** /cancel: deletes the caller's own open session. */
  cancel(by: Player): Promise<'cancelled' | 'none'> {
    return this.exclusive(async () => {
      const session = this.sessions.find((s) => s.starter.id === by.id);
      if (!session) return 'none';
      await this.discard(session);
      await this.api.sendMessage(this.opts.chatId, texts.cancelled(mention(by)), HTML);
      return 'cancelled';
    });
  }

  /** Sends the daily reminder unless a session is open or it was already sent today. */
  sendReminder(): Promise<'sent' | 'skipped'> {
    return this.exclusive(async () => {
      const state = this.store.get();
      const today = localDateKey(this.now(), this.opts.timezone);
      if (state.sessions.length > 0 || state.lastReminderDate === today) return 'skipped';

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

  private pickerKeyboard(id: string, selected: readonly string[]): InlineKeyboardButton[][] {
    const buttons = this.games.map((g, i) => ({
      text: `${selected.includes(g.name) ? '✅' : '⬜'} ${g.name}`,
      callback_data: callbacks.pick(id, i),
    }));
    const rows: InlineKeyboardButton[][] = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([
      { text: texts.pickerDoneButton, callback_data: callbacks.pickDone(id) },
      { text: texts.deleteButton, callback_data: callbacks.remove(id) },
    ]);
    return rows;
  }

  private async sendJoinPoll(session: Session): Promise<PollRef> {
    const minutes = Math.round(this.opts.joinPollSeconds / 60);
    const starter = displayName(session.starter);
    const chosen = this.chosenGame(session);
    const question = chosen
      ? texts.joinPollQuestionForGame(starter, chosen.name, playersRange(chosen), minutes)
      : texts.joinPollQuestion(starter, (session.candidates ?? []).join(', '), minutes);
    const msg = await this.api.sendPoll(
      this.opts.chatId,
      question.slice(0, MAX_POLL_QUESTION),
      [{ text: texts.joinOptionYes }, { text: texts.joinOptionNo }],
      {
        is_anonymous: false,
        open_period: this.opts.joinPollSeconds,
        reply_markup: {
          inline_keyboard: [
            [
              { text: texts.startNowButton, callback_data: callbacks.start(session.id) },
              { text: texts.deleteButton, callback_data: callbacks.remove(session.id) },
            ],
          ],
        },
      },
    );
    if (!msg.poll) throw new Error('sendPoll returned no poll');
    return { pollId: msg.poll.id, messageId: msg.message_id, closesAt: this.closesAt(this.opts.joinPollSeconds) };
  }

  /** The message that represents the session right now (picker, join poll or game poll). */
  private currentMessageId(session: Session): number {
    if (session.stage === 'voting' && session.vote) return session.vote.messageId;
    if (session.stage === 'joining' && session.join) return session.join.messageId;
    return session.picker?.messageId ?? session.join?.messageId ?? 0;
  }

  /** Deletes a message; when Telegram refuses (e.g. older than 48h), at least drops its buttons. */
  private async removeMessage(messageId: number): Promise<void> {
    await this.api.deleteMessage(this.opts.chatId, messageId).catch(async () => {
      await this.api.stopPoll(this.opts.chatId, messageId).catch(() => undefined);
      await this.api.editMessageReplyMarkup(this.opts.chatId, messageId).catch(() => undefined);
    });
  }

  /** Removes a session and its current message. */
  private async discard(session: Session): Promise<void> {
    this.removeSession(session.id);
    await this.removeMessage(this.currentMessageId(session));
  }

  private async isAdmin(userId: number): Promise<boolean> {
    try {
      const member = await this.api.getChatMember(this.opts.chatId, userId);
      return member.status === 'creator' || member.status === 'administrator';
    } catch {
      return false;
    }
  }

  private updateSession(id: string, change: (session: Session) => void): void {
    this.store.update((s) => {
      const session = s.sessions.find((x) => x.id === id);
      if (session) change(session);
    });
  }

  private removeSession(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.store.update((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== id);
    });
  }

  /** Finalizes the stage `pollId` belongs to, if it is still current. Idempotent. */
  private async finishPoll(pollId: string, closedPoll?: Poll): Promise<void> {
    const session = this.sessions.find((s) =>
      s.stage === 'joining' ? s.join?.pollId === pollId : s.stage === 'voting' && s.vote?.pollId === pollId,
    );
    if (!session) return;
    if (session.stage === 'joining') await this.finishJoin(session);
    else await this.finishVote(session, closedPoll);
  }

  private async finishJoin(session: Session): Promise<void> {
    const players = session.players;
    const chosen = this.chosenGame(session);
    const candidates = session.candidates
      ?.map((name) => this.findGame(name))
      .filter((g): g is Game => g !== undefined);
    const pool = candidates && candidates.length > 0 ? candidates : this.games;
    const plan = planAfterJoin(pool, players.length, chosen);
    // Drop the "start now" / "delete" buttons from the closed join poll.
    await this.api.editMessageReplyMarkup(this.opts.chatId, session.join!.messageId).catch(() => undefined);
    const chatId = this.opts.chatId;
    const done = () => this.removeSession(session.id);

    switch (plan.kind) {
      case 'tooFew':
        done();
        await this.api.sendMessage(chatId, texts.tooFew(MIN_PLAYERS_TO_PLAY), HTML);
        return;

      case 'tooFewForGame':
        done();
        await this.api.sendMessage(
          chatId,
          texts.tooFewForGame(escapeHtml(plan.game.name), requiredPlayers(plan.game), players.length),
          HTML,
        );
        return;

      case 'single': {
        done();
        const ready = teamReadyMessage(plan.game, players);
        const text = chosen ? ready : `${texts.singleGame(players.length, escapeHtml(plan.game.name))}\n\n${ready}`;
        await this.api.sendMessage(chatId, text, HTML);
        return;
      }

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
        this.updateSession(session.id, (s) => {
          s.stage = 'voting';
          s.vote = {
            pollId: msg.poll!.id,
            messageId: msg.message_id,
            closesAt: this.closesAt(this.opts.gamePollSeconds),
            options,
            votes: {},
          };
        });
        this.armFallback(session.id);
        return;
      }

      case 'split': {
        done();
        const groups = dealIntoGroups(players, plan.groups.map((g) => g.size), this.rng);
        const parts = plan.groups.map((g, i) =>
          texts.splitGroup({ index: i + 1, size: g.size, mentions: mentionAll(groups[i]!), games: gameNames(g.games) }),
        );
        const intro = chosen
          ? texts.splitIntroForGame(escapeHtml(chosen.name), players.length, chosen.maxPlayers)
          : texts.splitIntro(players.length);
        await this.api.sendMessage(chatId, [intro, ...parts, texts.splitOutro].join('\n\n'), HTML);
        return;
      }

      case 'noFit': {
        done();
        // None of the ticked games fits: suggest other catalog games that do.
        const others = candidates ? gamesForPlayers(this.games, players.length).filter((g) => !pool.includes(g)) : [];
        const text =
          others.length > 0
            ? texts.noPickedFit(players.length, gameNames(others), mentionAll(players))
            : texts.noFit(players.length, mentionAll(players));
        await this.api.sendMessage(chatId, text, HTML);
        return;
      }
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
    const game = this.findGame(result.winner);
    this.removeSession(session.id);
    if (!game) throw new Error(`Voted game "${result.winner}" is no longer in games.json`);

    const header = result.wasTie
      ? texts.voteTie(result.tied.map(escapeHtml).join(', '), escapeHtml(game.name))
      : texts.voteWinner(escapeHtml(game.name));
    await this.api.sendMessage(this.opts.chatId, `${header}\n\n${teamReadyMessage(game, session.players)}`, HTML);
  }

  /**
   * Schedules a check shortly after the session's current stage should have ended. An
   * unfinished picker is dropped. For polls, normally the `poll` update arrives first and this
   * does nothing; otherwise it stops the poll itself (stopPoll returns the final results) and
   * finalizes the stage.
   */
  private armFallback(id: string): void {
    clearTimeout(this.timers.get(id));
    const session = this.session(id);
    if (!session) return;
    const stage = session.stage;
    const ref = stage === 'picking' ? session.picker : stage === 'joining' ? session.join : session.vote;
    if (!ref) return;
    const delay = Math.max(0, new Date(ref.closesAt).getTime() - this.now().getTime()) + this.graceMs;
    const timer = setTimeout(() => {
      void this.exclusive(async () => {
        const current = this.session(id);
        if (!current || current.stage !== stage) return;
        if (stage === 'picking') {
          log.info(`[flow] picker ${id} expired`);
          await this.discard(current);
          return;
        }
        const pollRef = stage === 'joining' ? current.join : current.vote;
        if (!pollRef) return;
        log.warn(`[flow] no close update for poll ${pollRef.pollId}, finalizing via fallback`);
        const poll = await this.api.stopPoll(this.opts.chatId, pollRef.messageId).catch(() => undefined);
        await this.finishPoll(pollRef.pollId, poll);
      }).catch((err) => log.error('[flow] fallback failed:', err));
    }, delay);
    timer.unref?.();
    this.timers.set(id, timer);
  }
}
