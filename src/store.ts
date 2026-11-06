import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Player } from './format.js';
import { log } from './log.js';

export interface PollRef {
  pollId: string;
  messageId: number;
  /** ISO time when Telegram closes the poll (open_period). */
  closesAt: string;
}

export interface VoteStage extends PollRef {
  /** Game names, in poll option order. */
  options: string[];
  /** userId -> chosen option indexes, tracked from poll_answer. */
  votes: Record<string, number[]>;
}

/** Game picker shown before the join poll of a plain /play. */
export interface PickerStage {
  messageId: number;
  /** ISO time when an unfinished picker is dropped. */
  closesAt: string;
  /** Ticked game names. */
  selected: string[];
}

export interface Session {
  /** Short id used in callback data. */
  id: string;
  chatId: number;
  /** Who opened the session; only they can start it early. */
  starter: Player;
  startedAt: string;
  stage: 'picking' | 'joining' | 'voting';
  picker?: PickerStage;
  join?: PollRef;
  /** Single game picked up front (/play <game> or one ticked game); skips the game vote. */
  chosenGame?: string;
  /** Games ticked in the picker; the final game is chosen among them. */
  candidates?: string[];
  /** Players who chose "I'm in", in join order. */
  players: Player[];
  vote?: VoteStage;
}

export interface State {
  version: 2;
  /** Open sessions, at most one per starter. */
  sessions: Session[];
  /** YYYY-MM-DD (bot timezone) of the last reminder sent, to avoid duplicates after restarts. */
  lastReminderDate?: string;
  lastReminderIndex?: number;
}

const EMPTY: State = { version: 2, sessions: [] };

/**
 * Tiny JSON file store. The whole state is a few KB, so every update rewrites the
 * file atomically (write to a temp file, then rename).
 */
export class JsonStore {
  private state: State;

  constructor(private readonly file: string) {
    this.state = JsonStore.read(file);
  }

  private static read(file: string): State {
    if (!existsSync(file)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Omit<Partial<State>, 'version'> & { version?: number };
      // Version 1 kept a single session in another shape; it is dropped (polls close within minutes).
      if (parsed.version !== 2) {
        const { lastReminderDate, lastReminderIndex } = parsed;
        return { ...structuredClone(EMPTY), lastReminderDate, lastReminderIndex };
      }
      return { ...structuredClone(EMPTY), ...(parsed as State) };
    } catch (err) {
      log.error(`[store] could not read ${file}, starting empty:`, err);
      return structuredClone(EMPTY);
    }
  }

  get(): Readonly<State> {
    return this.state;
  }

  update(change: (draft: State) => void): State {
    const draft = structuredClone(this.state);
    change(draft);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(draft, null, 2));
    renameSync(tmp, this.file);
    this.state = draft;
    return draft;
  }
}
