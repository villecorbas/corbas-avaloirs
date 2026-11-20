import { describe, expect, it } from 'vitest';
import { formLink, parseCounts, progressCSV, streetKey, streetsProgress, streetState } from '../../src/lib/streets';

const rue = { name: 'Rue de la Gare', ways: [[{ lat: 45.6, lon: 4.9 }, { lat: 45.6, lon: 4.9022 }]] }; // ≈ 170 m

describe('Rues de la campagne', () => {
  it('normalise les noms (accents, casse, ponctuation)', () => {
    expect(streetKey('Rue de l’Égalité')).toBe(streetKey('rue de l egalite'));
    expect(streetKey("  Chemin  des   Vignes ")).toBe('chemin des vignes');
  });
  it('calcule la couverture et l’état d’une rue', () => {
    const none = streetsProgress([rue], [])[0];
    expect(none.ratio).toBe(0);
    expect(streetState(none)).toBe('todo');
    const full = streetsProgress([rue], [{ lat: 45.6, lon: 4.9005 }, { lat: 45.6, lon: 4.9015 }, { lat: 45.6, lon: 4.9022 }])[0];
    expect(full.ratio).toBeGreaterThan(0.9);
    expect(streetState(full)).toBe('done');
    expect(full.lengthM).toBeGreaterThan(100);
  });
  it('ne retient que des compteurs valides', () => {
    expect(parseCounts({ counts: { 'Rue de la Gare': 3, X: -1, Y: 'a', Z: 1.5 } })).toEqual({ 'rue de la gare': 3 });
    expect(parseCounts(null)).toEqual({});
    expect(parseCounts({ counts: 5 })).toEqual({});
  });
  it('pré-remplit la rue dans le formulaire', () => {
    const u = formLink('https://docs.google.com/forms/d/e/ABC/viewform', 'entry.123456', 'Rue de l’Église');
    expect(new URL(u).searchParams.get('entry.123456')).toBe('Rue de l’Église');
    expect(formLink('', 'entry.1', 'x')).toBe('');
    expect(formLink('pas une url', 'entry.1', 'x')).toBe('');
  });
  it('exporte un CSV protégé contre l’injection de formules', () => {
    const csv = progressCSV([{ name: '=HYPERLINK("x")', key: 'k', lengthM: 10, ratio: 0.5 }]);
    expect(csv.split('\n')[1].startsWith('"\'=')).toBe(true);
    expect(csv).toContain(';50;10');
  });
});
