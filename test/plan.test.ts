import { describe, expect, it } from 'vitest';
import { gamesForPlayers, loadGames, parseGames } from '../src/games.js';
import { balancedSizes, dealIntoGroups, planAfterJoin, planSplit, resolveVote } from '../src/plan.js';
import { game, seq } from './helpers.js';

const games = [game('Duo', 2, 2), game('Small', 2, 4), game('Mid', 3, 6), game('Party', 4, 8)];
const names = (list: { name: string }[]) => list.map((g) => g.name);

describe('gamesForPlayers', () => {
  it('keeps games where minPlayers <= players <= maxPlayers', () => {
    expect(names(gamesForPlayers(games, 2))).toEqual(['Duo', 'Small']);
    expect(names(gamesForPlayers(games, 4))).toEqual(['Small', 'Mid', 'Party']);
    expect(names(gamesForPlayers(games, 7))).toEqual(['Party']);
    expect(gamesForPlayers(games, 9)).toEqual([]);
  });

  it('includes both bounds', () => {
    expect(names(gamesForPlayers(games, 3))).toContain('Mid');
    expect(names(gamesForPlayers(games, 6))).toContain('Mid');
  });
});

describe('planAfterJoin', () => {
  it('cancels with fewer than 2 players', () => {
    expect(planAfterJoin(games, 0)).toEqual({ kind: 'tooFew' });
    expect(planAfterJoin(games, 1)).toEqual({ kind: 'tooFew' });
  });

  it('skips the vote when exactly one game fits', () => {
    const plan = planAfterJoin(games, 7);
    expect(plan).toMatchObject({ kind: 'single', game: { name: 'Party' } });
  });

  it('votes when two or more games fit', () => {
    const plan = planAfterJoin(games, 5);
    expect(plan.kind).toBe('vote');
    if (plan.kind === 'vote') expect(names(plan.games)).toEqual(['Mid', 'Party']);
  });

  it('suggests splitting when there are too many players', () => {
    const plan = planAfterJoin(games, 11);
    expect(plan.kind).toBe('split');
    if (plan.kind !== 'split') return;
    expect(plan.groups.map((g) => g.size)).toEqual([6, 5]);
    expect(names(plan.groups[0]!.games)).toEqual(['Mid', 'Party']);
    expect(names(plan.groups[1]!.games)).toEqual(['Mid', 'Party']);
  });

  it('uses more groups when two are still too big', () => {
    const plan = planAfterJoin(games, 20);
    expect(plan.kind).toBe('split');
    if (plan.kind === 'split') expect(plan.groups.map((g) => g.size)).toEqual([7, 7, 6]);
  });

  it('reports noFit when players are within range but no game fits', () => {
    const gappy = [game('Pair', 2, 2), game('Big', 6, 8)];
    expect(planAfterJoin(gappy, 4)).toEqual({ kind: 'noFit' });
  });

  it('works with the real games.json', () => {
    const real = loadGames();
    expect(planAfterJoin(real, 1).kind).toBe('tooFew');
    expect(planAfterJoin(real, 3).kind).toBe('vote');
    const huge = planAfterJoin(real, 31);
    expect(huge.kind).toBe('split');
  });
});

describe('planSplit', () => {
  it('returns null when no split has a game for every group', () => {
    expect(planSplit([game('Big', 6, 8)], 9)).toBeNull();
  });
});

describe('balancedSizes', () => {
  it('splits as evenly as possible, largest first', () => {
    expect(balancedSizes(10, 3)).toEqual([4, 3, 3]);
    expect(balancedSizes(9, 3)).toEqual([3, 3, 3]);
  });
});

describe('resolveVote', () => {
  it('picks the option with the most votes', () => {
    const r = resolveVote([
      { text: 'A', votes: 1 },
      { text: 'B', votes: 3 },
      { text: 'C', votes: 2 },
    ]);
    expect(r).toEqual({ winner: 'B', wasTie: false, tied: ['B'] });
  });

  it('breaks ties randomly among the tied options only', () => {
    const options = [
      { text: 'A', votes: 2 },
      { text: 'B', votes: 0 },
      { text: 'C', votes: 2 },
    ];
    expect(resolveVote(options, seq(0)).winner).toBe('A');
    expect(resolveVote(options, seq(0.99)).winner).toBe('C');
    expect(resolveVote(options, seq(0.5))).toMatchObject({ wasTie: true, tied: ['A', 'C'] });
  });

  it('treats zero votes everywhere as a tie between all options', () => {
    const r = resolveVote([
      { text: 'A', votes: 0 },
      { text: 'B', votes: 0 },
    ], seq(0.7));
    expect(r).toEqual({ winner: 'B', wasTie: true, tied: ['A', 'B'] });
  });
});

describe('dealIntoGroups', () => {
  it('puts every player in exactly one group of the right size', () => {
    const players = Array.from({ length: 11 }, (_, i) => i);
    const groups = dealIntoGroups(players, [6, 5], seq(0.3, 0.8, 0.1));
    expect(groups.map((g) => g.length)).toEqual([6, 5]);
    expect(groups.flat().sort((a, b) => a - b)).toEqual(players);
  });
});

describe('parseGames', () => {
  it('rejects bad entries with a readable error', () => {
    expect(() => parseGames([{ ...game('X', 4, 2) }])).toThrow(/minPlayers is greater/);
    expect(() => parseGames([{ ...game('X', 2, 4), type: 'online' }])).toThrow(/need a link/);
    expect(() => parseGames([])).toThrow(/non-empty/);
  });

  it('games.json has all five games with player counts and sources', () => {
    const real = loadGames();
    expect(names(real)).toEqual(['Blokus', 'Azul', 'Exploding Kittens', 'Spot it', 'Gartic Phone']);
    for (const g of real) expect(g.source.length).toBeGreaterThan(10);
  });
});
