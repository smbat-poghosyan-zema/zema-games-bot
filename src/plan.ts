import { gamesForPlayers, type Game } from './games.js';

export const MIN_PLAYERS_TO_PLAY = 2;

export interface SplitGroup {
  size: number;
  games: Game[];
}

/** What to do once the join poll has closed. */
export type JoinPlan =
  | { kind: 'tooFew' }
  | { kind: 'single'; game: Game }
  | { kind: 'vote'; games: Game[] }
  | { kind: 'split'; groups: SplitGroup[] }
  | { kind: 'noFit' };

/** Splits `total` into `parts` sizes that differ by at most one, largest first. */
export function balancedSizes(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Finds the smallest number of groups (2 or more) where every group size has at
 * least one fitting game. Returns null when no split works.
 */
export function planSplit(games: readonly Game[], players: number): SplitGroup[] | null {
  for (let parts = 2; parts <= Math.floor(players / MIN_PLAYERS_TO_PLAY); parts++) {
    const sizes = balancedSizes(players, parts);
    const groups = sizes.map((size) => ({ size, games: gamesForPlayers(games, size) }));
    if (groups.every((g) => g.games.length > 0)) return groups;
  }
  return null;
}

export function planAfterJoin(games: readonly Game[], players: number): JoinPlan {
  if (players < MIN_PLAYERS_TO_PLAY) return { kind: 'tooFew' };

  const fitting = gamesForPlayers(games, players);
  if (fitting.length === 1) return { kind: 'single', game: fitting[0]! };
  if (fitting.length > 1) return { kind: 'vote', games: fitting };

  const maxSupported = Math.max(...games.map((g) => g.maxPlayers));
  if (players > maxSupported) {
    const groups = planSplit(games, players);
    if (groups) return { kind: 'split', groups };
  }
  return { kind: 'noFit' };
}

export interface VoteResult {
  winner: string;
  /** True when several options shared the top vote count and the winner was drawn randomly. */
  wasTie: boolean;
  tied: string[];
}

export type Rng = () => number;

/** Picks the option with most votes; on a tie, picks randomly among the tied options. */
export function resolveVote(
  options: readonly { text: string; votes: number }[],
  rng: Rng = Math.random,
): VoteResult {
  if (options.length === 0) throw new Error('resolveVote needs at least one option');
  const top = Math.max(...options.map((o) => o.votes));
  const tied = options.filter((o) => o.votes === top).map((o) => o.text);
  const index = Math.min(Math.floor(rng() * tied.length), tied.length - 1);
  return { winner: tied[index]!, wasTie: tied.length > 1, tied };
}

/** Fisher-Yates shuffle that returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Deals players into groups with the given sizes, in random order. */
export function dealIntoGroups<T>(players: readonly T[], sizes: readonly number[], rng: Rng = Math.random): T[][] {
  const shuffled = shuffle(players, rng);
  const groups: T[][] = [];
  let offset = 0;
  for (const size of sizes) {
    groups.push(shuffled.slice(offset, offset + size));
    offset += size;
  }
  return groups;
}
