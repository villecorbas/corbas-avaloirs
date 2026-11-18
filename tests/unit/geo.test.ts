import { describe, expect, it } from 'vitest';
import { accuracyLevel, averageFixes, bearing, distance, distanceToLine, lineCenter, lineLength, offset } from '../../src/lib/geo';

describe('Géolocalisation', () => {
  it('distance haversine', () => {
    // 0,0001° de latitude ≈ 11,1 m
    expect(distance({ lat: 45, lon: 4.9 }, { lat: 45.0001, lon: 4.9 })).toBeCloseTo(11.12, 1);
  });

  it('moyenne pondérée et rejet des mesures aberrantes', () => {
    const base = { lat: 45.67, lon: 4.9 };
    const m = 1 / 111_320; // 1 m en degrés de latitude
    const samples = [
      { lat: base.lat + 1 * m, lon: base.lon, acc: 4, t: 1 },
      { lat: base.lat - 1 * m, lon: base.lon, acc: 4, t: 2 },
      { lat: base.lat + 0.5 * m, lon: base.lon, acc: 3, t: 3 },
      { lat: base.lat - 0.5 * m, lon: base.lon, acc: 3, t: 4 },
      { lat: base.lat + 60 * m, lon: base.lon, acc: 25, t: 5 }, // trop imprécis : écarté
      { lat: base.lat + 30 * m, lon: base.lon, acc: 5, t: 6 }, // aberrant : écarté
    ];
    const avg = averageFixes(samples)!;
    expect(distance(avg, base)).toBeLessThan(0.5);
    expect(avg.samples).toBe(4);
    expect(avg.acc).toBeGreaterThanOrEqual(1);
    expect(avg.acc).toBeLessThanOrEqual(3);
  });

  it('une seule mesure : précision conservée', () => {
    const avg = averageFixes([{ lat: 45, lon: 5, acc: 7, t: 1 }])!;
    expect(avg.lat).toBe(45);
    expect(avg.acc).toBe(7);
  });

  it('niveaux de précision', () => {
    expect(accuracyLevel(2.5)).toBe('excellent');
    expect(accuracyLevel(5)).toBe('good');
    expect(accuracyLevel(10)).toBe('fair');
    expect(accuracyLevel(30)).toBe('poor');
  });

  it('géométrie locale : décalage, cap, distance à un segment, centre', () => {
    const p = { lat: 45.75, lon: 4.84 };
    const east = offset(p, 90, 10);
    expect(distance(p, east)).toBeCloseTo(10, 1);
    expect(bearing(p, east)).toBeCloseTo(90, 0);
    expect(bearing(p, offset(p, 0, 5))).toBeCloseTo(0, 0);
    const a = offset(p, 270, 2);
    const b = offset(p, 90, 2);
    expect(distanceToLine(offset(p, 0, 3), [a, b])).toBeCloseTo(3, 1);
    expect(distanceToLine(offset(p, 90, 5), [a, b])).toBeCloseTo(3, 1); // au-delà de l'extrémité
    expect(lineLength([a, b])).toBeCloseTo(4, 1);
    expect(distance(lineCenter([a, b]), p)).toBeLessThan(0.01);
  });
});
