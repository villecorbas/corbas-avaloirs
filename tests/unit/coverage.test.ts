import { describe, expect, it } from 'vitest';
import { computeCoverage, splitLine } from '../../src/lib/coverage';
import { lineLength, offset } from '../../src/lib/geo';

describe('Couverture des rues', () => {
  const start = { lat: 45.67, lon: 4.9 };
  const street = [start, offset(start, 90, 200)]; // rue est-ouest de 200 m

  it('découpe une rue en tronçons de ~40 m', () => {
    const parts = splitLine(street);
    expect(parts.length).toBe(5);
    parts.forEach((p) => expect(lineLength(p)).toBeCloseTo(40, 0));
  });

  it('marque couverts les tronçons proches d’un avaloir, à explorer les autres', () => {
    const drain = offset(offset(start, 90, 20), 0, 5); // sur le trottoir, 20 m après le début
    const cov = computeCoverage([street], [drain], 35);
    expect(cov.covered.length).toBe(2); // tronçons 0–40 m et 40–80 m (bord à 20 m)
    expect(cov.todo.length).toBe(3);
    expect(cov.ratio).toBeCloseTo(0.4, 1);
  });

  it('aucune donnée : tout est à explorer', () => {
    const cov = computeCoverage([street], []);
    expect(cov.covered).toEqual([]);
    expect(cov.ratio).toBe(0);
  });
});
