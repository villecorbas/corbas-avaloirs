import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_STREETS, readStreets, setStreetChosen } from '../../src/lib/commitments';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  } as Storage;
});

describe('Engagement sur des rues (local)', () => {
  it('ajoute et retire plusieurs rues sans doublon', () => {
    setStreetChosen('Rue de la Gare', true);
    setStreetChosen('Chemin des Vignes', true);
    setStreetChosen('Rue de la Gare', true);
    expect(readStreets()).toEqual(['Chemin des Vignes', 'Rue de la Gare']);
    setStreetChosen('Chemin des Vignes', false);
    expect(readStreets()).toEqual(['Rue de la Gare']);
  });
  it('ignore un stockage corrompu et plafonne la liste', () => {
    mem.set('avaloirs.myStreets', '{pas du json');
    expect(readStreets()).toEqual([]);
    mem.set('avaloirs.myStreets', JSON.stringify([1, null, 'ok', 'x'.repeat(500)]));
    expect(readStreets()).toEqual(['ok']);
    for (let i = 0; i < MAX_STREETS + 5; i++) setStreetChosen('R' + i, true);
    expect(readStreets()).toHaveLength(MAX_STREETS);
  });
});

import { computeProgress } from '../../src/lib/gamification';
describe('Points et badge d’engagement', () => {
  it('5 points par rue, plafonnés à 3 rues, et badge « Voisin engagé »', () => {
    const none = computeProgress([], 1_000, [], []);
    expect(none.commitPoints).toBe(0);
    expect(none.badges.find((b) => b.def.id === 'neighbor')?.unlockedAt).toBeUndefined();
    const two = computeProgress([], 1_000, [], [{ name: 'A', ts: 500 }, { name: 'B', ts: 700 }]);
    expect(two.commitPoints).toBe(10);
    expect(two.points).toBe(10);
    expect(two.badges.find((b) => b.def.id === 'neighbor')?.unlockedAt).toBe(500);
    const many = computeProgress([], 1_000, [], Array.from({ length: 9 }, (_, i) => ({ name: 'R' + i, ts: 1 })));
    expect(many.commitPoints).toBe(15);
  });
});
