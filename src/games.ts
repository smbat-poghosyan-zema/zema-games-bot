import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type GameType = 'physical' | 'online';

export interface Game {
  name: string;
  type: GameType;
  minPlayers: number;
  maxPlayers: number;
  /** Average play time in minutes (the lower end when `maxDurationMinutes` is set). */
  durationMinutes: number;
  /** Upper end of the play time, for games listed as a range like 20-30 minutes. */
  maxDurationMinutes?: number;
  /** One-line description in Armenian. */
  description: string;
  /** Link to play (online games only). */
  link?: string;
  /** Where player counts and duration come from. */
  source: string;
}

const DEFAULT_GAMES_PATH = fileURLToPath(new URL('../games.json', import.meta.url));

/** Validates raw JSON and returns a typed game list. Throws with a readable message on bad data. */
export function parseGames(raw: unknown): Game[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('games.json must be a non-empty array');
  }
  return raw.map((item: unknown, i) => {
    const g = item as Partial<Game>;
    const where = `games.json[${i}]`;
    if (typeof g.name !== 'string' || !g.name) throw new Error(`${where}: name is required`);
    if (g.type !== 'physical' && g.type !== 'online') {
      throw new Error(`${where} (${g.name}): type must be "physical" or "online"`);
    }
    for (const key of ['minPlayers', 'maxPlayers', 'durationMinutes'] as const) {
      const v = g[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
        throw new Error(`${where} (${g.name}): ${key} must be a positive integer`);
      }
    }
    if (g.maxDurationMinutes !== undefined) {
      const v = g.maxDurationMinutes;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < g.durationMinutes!) {
        throw new Error(`${where} (${g.name}): maxDurationMinutes must be an integer >= durationMinutes`);
      }
    }
    if (g.minPlayers! > g.maxPlayers!) {
      throw new Error(`${where} (${g.name}): minPlayers is greater than maxPlayers`);
    }
    if (typeof g.description !== 'string' || !g.description) {
      throw new Error(`${where} (${g.name}): description is required`);
    }
    if (g.type === 'online' && (typeof g.link !== 'string' || !g.link.startsWith('http'))) {
      throw new Error(`${where} (${g.name}): online games need a link`);
    }
    return g as Game;
  });
}

export function loadGames(path = DEFAULT_GAMES_PATH): Game[] {
  return parseGames(JSON.parse(readFileSync(path, 'utf8')));
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Finds games by a user-typed name: case-insensitive, ignores spaces and punctuation,
 * accepts partial names ("kittens", "spot"). An exact match wins over partial ones.
 */
export function findGames(games: readonly Game[], query: string): Game[] {
  const q = normalize(query);
  if (!q) return [];
  const exact = games.filter((g) => normalize(g.name) === q);
  return exact.length > 0 ? exact : games.filter((g) => normalize(g.name).includes(q));
}

/** Games that can be played by exactly `players` people. */
export function gamesForPlayers(games: readonly Game[], players: number): Game[] {
  return games.filter((g) => g.minPlayers <= players && players <= g.maxPlayers);
}
