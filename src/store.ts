import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Player } from './format.js';

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

export interface Session {
  id: string;
  chatId: number;
  starterId: number;
  startedAt: string;
  stage: 'joining' | 'voting';
  join: PollRef;
  /** Players who chose "I'm in", in join order. */
  players: Player[];
  vote?: VoteStage;
}

export interface State {
  version: 1;
  session: Session | null;
  /** YYYY-MM-DD (bot timezone) of the last reminder sent, to avoid duplicates after restarts. */
  lastReminderDate?: string;
  lastReminderIndex?: number;
}

const EMPTY: State = { version: 1, session: null };

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
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as State;
      return { ...structuredClone(EMPTY), ...parsed };
    } catch (err) {
      console.error(`[store] could not read ${file}, starting empty:`, err);
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
