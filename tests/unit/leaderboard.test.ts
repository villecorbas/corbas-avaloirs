import { describe, expect, it } from 'vitest';
import { buildLeaderboard } from '../../src/lib/leaderboard';
import type { OsmDrain } from '../../src/lib/overpass';

const d = (id: number, user: string, photo = false, timestamp = '2026-11-10T10:00:00Z'): OsmDrain => ({
  type: 'node', id, lat: 45, lon: 4.9, user, timestamp,
  tags: { manhole: 'drain', ...(photo ? { panoramax: `p${id}` } : {}) },
});

describe('Classement des participants', () => {
  const drains = [d(1, 'Alex', true), d(2, 'Alex'), d(3, 'Sam', true), d(4, 'Sam', true), d(5, 'Dom', false, '2026-01-01T00:00:00Z'), d(6, 'Dom')];

  it('score = 10 par avaloir + 5 par photo, trié', () => {
    const lb = buildLeaderboard(drains);
    expect(lb.map((e) => [e.user, e.score, e.rank])).toEqual([
      ['Sam', 30, 1],
      ['Alex', 25, 2],
      ['Dom', 20, 3],
    ]);
  });

  it('période : seules les modifications récentes comptent', () => {
    const lb = buildLeaderboard(drains, { since: Date.parse('2026-11-01T00:00:00Z') });
    expect(lb.find((e) => e.user === 'Dom')?.drains).toBe(1);
  });

  it('ex aequo : même rang', () => {
    const lb = buildLeaderboard([d(1, 'A'), d(2, 'B')]);
    expect(lb.map((e) => e.rank)).toEqual([1, 1]);
  });
});
