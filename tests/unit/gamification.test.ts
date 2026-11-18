import { describe, expect, it } from 'vitest';
import { computeProgress, levelFor, needsSync, newlyUnlocked, qualityScore, recordPoints, streakDays } from '../../src/lib/gamification';
import type { DrainRecord } from '../../src/lib/db';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 18, 14, 0).getTime();

function rec(i: number, over: Partial<DrainRecord> = {}): DrainRecord {
  return {
    id: `r${i}`,
    createdAt: NOW - i * 60_000,
    updatedAt: NOW,
    position: { lat: 45, lon: 4.9, acc: 2.5, samples: 6, adjusted: false, adjustMeters: 0 },
    photoTakenAt: NOW,
    photoSharpness: 0.5,
    details: { type: 'grate' },
    observations: {},
    address: { label: 'x', street: `Rue ${i}`, citycode: '69273' },
    mode: 'new',
    quality: { score: 80, stars: 3 },
    points: 30,
    sync: { panoramax: { status: 'pending', pictureId: 'p', attempts: 0 }, osm: { status: 'pending', attempts: 0 } },
    ...over,
  };
}

describe('Gamification', () => {
  it('qualité : un relevé précis et complet obtient 3 étoiles', () => {
    const q = qualityScore({
      acc: 2,
      samples: 6,
      sharpness: 0.6,
      details: { type: 'grate', shape: 'rectangular', material: 'metal' },
      observations: { standingWater: 'no', clogged: 'no' },
    });
    expect(q.score).toBe(100);
    expect(q.stars).toBe(3);
    const channel = qualityScore({ acc: 2, samples: 6, sharpness: 0.6, details: { type: 'channel', material: 'metal' }, observations: { standingWater: 'no', clogged: 'no' } });
    expect(channel.score).toBe(100); // la forme n'est pas demandée pour un caniveau
    const poor = qualityScore({ acc: 25, samples: 1, sharpness: 0.05, details: { type: 'generic' }, observations: {} });
    expect(poor.stars).toBe(1);
  });

  it('points : bonus premier du jour et série', () => {
    const input = { acc: 2, samples: 6, sharpness: 0.6, details: { type: 'grate' as const }, observations: {}, mode: 'new' as const, at: NOW };
    const first = recordPoints(input, []);
    expect(first.lines.map((l) => l.key)).toContain('firstOfDay');
    const streak = recordPoints(input, [rec(0, { createdAt: NOW - DAY }), rec(1, { createdAt: NOW - 2 * DAY })]);
    expect(streak.lines.map((l) => l.key)).toContain('streak');
    expect(streak.total).toBeGreaterThan(20);
  });

  it('série de jours consécutifs', () => {
    expect(streakDays([NOW, NOW - DAY, NOW - 2 * DAY, NOW - 4 * DAY], NOW)).toBe(3);
    expect(streakDays([NOW - DAY, NOW - 2 * DAY], NOW)).toBe(2); // hier compte encore
    expect(streakDays([NOW - 3 * DAY], NOW)).toBe(0);
  });

  it('niveaux', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(49).level).toBe(1);
    expect(levelFor(50).level).toBe(2);
    expect(levelFor(10_000).max).toBe(true);
  });

  it('badges débloqués et progression', () => {
    const records = Array.from({ length: 10 }, (_, i) => rec(i));
    const p = computeProgress(records, NOW);
    const unlocked = p.badges.filter((b) => b.unlockedAt).map((b) => b.def.id);
    expect(unlocked).toEqual(expect.arrayContaining(['first', 'ten', 'precise', 'photographer', 'explorer']));
    expect(unlocked).not.toContain('fifty');
    expect(p.points).toBe(300);
    expect(p.today).toBe(10);
    expect(p.pending).toBe(10);

    const before = computeProgress(records.slice(1), NOW);
    expect(newlyUnlocked(before, p).map((b) => b.def.id)).toEqual(expect.arrayContaining(['ten']));
  });

  it('un relevé publié avec sa photo ne demande plus de synchronisation', () => {
    const done = rec(0, {
      sync: { panoramax: { status: 'done', pictureId: 'p', attempts: 0 }, osm: { status: 'done', osmType: 'node', osmId: 1, photoTagged: true, attempts: 0 } },
    });
    expect(needsSync(done)).toBe(false);
    const noTag = rec(0, {
      sync: { panoramax: { status: 'done', pictureId: 'p', attempts: 0 }, osm: { status: 'done', osmType: 'node', osmId: 1, photoTagged: false, attempts: 0 } },
    });
    expect(needsSync(noTag)).toBe(true);
  });
});
