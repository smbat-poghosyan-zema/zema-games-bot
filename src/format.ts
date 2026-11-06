import type { User } from 'grammy/types';
import type { Game } from './games.js';
import { texts } from './texts.js';

/** Minimal player info kept in the session store. */
export interface Player {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
}

export function toPlayer(user: User): Player {
  return {
    id: user.id,
    firstName: user.first_name,
    ...(user.last_name ? { lastName: user.last_name } : {}),
    ...(user.username ? { username: user.username } : {}),
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function displayName(p: Player): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

/** @username when the player has one, otherwise an HTML text mention by user id. */
export function mention(p: Player): string {
  if (p.username) return `@${p.username}`;
  return `<a href="tg://user?id=${p.id}">${escapeHtml(displayName(p))}</a>`;
}

export function mentionAll(players: readonly Player[]): string {
  return players.map(mention).join(', ');
}

export function gameNames(games: readonly Game[]): string {
  return games.map((g) => escapeHtml(g.name)).join(', ');
}

export function playersRange(g: Game): string {
  return g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}-${g.maxPlayers}`;
}

export function durationRange(g: Game): string {
  return g.maxDurationMinutes && g.maxDurationMinutes !== g.durationMinutes
    ? `${g.durationMinutes}-${g.maxDurationMinutes}`
    : `${g.durationMinutes}`;
}

export function gamesListMessage(games: readonly Game[]): string {
  const lines = games.map((g) =>
    texts.gameLine({
      name: escapeHtml(g.name),
      kind: texts.gameKind[g.type],
      players: playersRange(g),
      minutes: durationRange(g),
      description: escapeHtml(g.description),
      ...(g.link ? { link: escapeHtml(g.link) } : {}),
    }),
  );
  return [texts.gamesHeader, '', ...lines].join('\n');
}

/** Final "team is set" message for a single chosen game. */
export function teamReadyMessage(game: Game, players: readonly Player[]): string {
  return texts.teamReady({
    game: escapeHtml(game.name),
    mentions: mentionAll(players),
    ...(game.link ? { link: escapeHtml(game.link) } : {}),
  });
}
