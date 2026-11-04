import type { Game } from '../src/games.js';

export function game(name: string, minPlayers: number, maxPlayers: number, extra: Partial<Game> = {}): Game {
  return {
    name,
    type: 'physical',
    minPlayers,
    maxPlayers,
    durationMinutes: 15,
    description: `${name} description`,
    source: 'test',
    ...extra,
  };
}

/** Deterministic rng that returns the given values in order (then repeats the last one). */
export function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}
