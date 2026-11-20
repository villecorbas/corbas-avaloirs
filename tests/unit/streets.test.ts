import { describe, expect, it } from 'vitest';
import { parseBanVoies } from '../../src/lib/ban';
import { formLink, parseCounts, progressCSV, streetKey, streetsProgress, streetState } from '../../src/lib/streets';

const osm = [{ name: 'Rue de la Gare', ways: [[{ lat: 45.6, lon: 4.9 }, { lat: 45.6, lon: 4.9022 }]] }]; // ≈ 170 m
const ban = [
  { name: 'Rue de la Gare', numbers: 12 },
  { name: 'Impasse des Lilas', numbers: 3 },
];

describe('Rues de la campagne', () => {
  it('normalise les noms (accents, casse, ponctuation)', () => {
    expect(streetKey('Rue de l’Égalité')).toBe(streetKey('rue de l egalite'));
    expect(streetKey("  Chemin  des   Vignes ")).toBe('chemin des vignes');
  });
  it('rapproche la liste officielle des tracés OSM ; sans tracé, l’avancement est inconnu', () => {
    const [gare, lilas] = streetsProgress(ban, osm, []);
    expect(gare.ratio).toBe(0);
    expect(streetState(gare)).toBe('todo');
    expect(lilas.ratio).toBeNull();
    expect(streetState(lilas)).toBe('unknown');
  });
  it('détecte une rue terminée', () => {
    const [gare] = streetsProgress(ban, osm, [{ lat: 45.6, lon: 4.9005 }, { lat: 45.6, lon: 4.9015 }, { lat: 45.6, lon: 4.9022 }]);
    expect(streetState(gare)).toBe('done');
    expect(gare.lengthM).toBeGreaterThan(100);
  });
  it('ne retient que des compteurs valides', () => {
    expect(parseCounts({ counts: { 'Rue de la Gare': 3, X: -1, Y: 'a', Z: 1.5 } })).toEqual({ 'rue de la gare': 3 });
    expect(parseCounts(null)).toEqual({});
    expect(parseCounts({ counts: 5 })).toEqual({});
  });
  it('pré-remplit plusieurs rues dans le formulaire', () => {
    const u = new URL(formLink('https://docs.google.com/forms/d/e/ABC/viewform', 'entry.123456', ['Rue de l’Église', 'Chemin des Vignes']));
    expect(u.searchParams.getAll('entry.123456')).toEqual(['Rue de l’Église', 'Chemin des Vignes']);
    expect(formLink('', 'entry.1', ['x'])).toBe('');
    expect(formLink('pas une url', 'entry.1', ['x'])).toBe('');
  });
  it('exporte un CSV protégé contre l’injection, sans les rues à avancement inconnu', () => {
    const csv = progressCSV([
      { name: '=HYPERLINK("x")', key: 'k', lengthM: 10, ratio: 0.5 },
      { name: 'Sans tracé', key: 's', lengthM: 0, ratio: null },
    ]);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv.split('\n')[1].startsWith('"\'=')).toBe(true);
    expect(csv).toContain(';50;10');
  });
});

describe('Base Adresse Nationale', () => {
  it('ne garde que les voies, sans lieux-dits ni doublons ni données mal formées', () => {
    const json = {
      voies: [
        { type: 'voie', nomVoie: 'Rue de la Vanoise', nbNumeros: 13 },
        { type: 'lieu-dit', nomVoie: 'Lieudit Montmartin' },
        { type: 'voie', nomVoie: 'Rue de la Vanoise', nbNumeros: 2 },
        { type: 'voie', nomVoie: 42 },
        { type: 'voie', nomVoie: '  Allée   des Bouleaux ' },
        null,
      ],
    };
    expect(parseBanVoies(json).map((s) => s.name)).toEqual(['Allée des Bouleaux', 'Rue de la Vanoise']);
    expect(parseBanVoies(null)).toEqual([]);
    expect(parseBanVoies({ voies: 'x' })).toEqual([]);
  });
});
