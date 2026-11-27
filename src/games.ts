import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type GameType = 'physical' | 'online';

/** What a game session needs to know about a game: catalog games and games added in the picker both fit. */
export interface PlayableGame {
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /** Link to play (online games only). */
  link?: string;
}

/** A game the session starter typed in the picker, kept for that session only. */
export type AddedGame = Pick<PlayableGame, 'name' | 'minPlayers' | 'maxPlayers'>;

/** A catalog game from games.json. */
export interface Game extends PlayableGame {
  type: GameType;
  /** Average play time in minutes (the lower end when `maxDurationMinutes` is set). */
  durationMinutes: number;
  /** Upper end of the play time, for games listed as a range like 20-30 minutes. */
  maxDurationMinutes?: number;
  /** One-line description in Armenian. */
  description: string;
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

/** True when two game names are the same, ignoring case, spaces and punctuation. */
export function sameGameName(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

export const MAX_ADDED_NAME_LENGTH = 40;
export const MAX_ADDED_PLAYERS = 50;

/**
 * Parses a game typed in the picker: "<name> <min>-<max>" or "<name> <count>",
 * e.g. "Codenames 4-8" or "Chess 2". Returns null when the text doesn't fit that format.
 */
export function parseAddedGame(text: string): AddedGame | null {
  const match = /^(.+?)\s+(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/su.exec(text.trim());
  if (!match) return null;
  const name = match[1]!.replace(/\s+/g, ' ').trim();
  const minPlayers = Number(match[2]);
  const maxPlayers = match[3] === undefined ? minPlayers : Number(match[3]);
  if (!normalize(name) || name.length > MAX_ADDED_NAME_LENGTH) return null;
  if (minPlayers < 1 || minPlayers > maxPlayers || maxPlayers > MAX_ADDED_PLAYERS) return null;
  return { name, minPlayers, maxPlayers };
}

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
export function gamesForPlayers<T extends PlayableGame>(games: readonly T[], players: number): T[] {
  return games.filter((g) => g.minPlayers <= players && players <= g.maxPlayers);
}
