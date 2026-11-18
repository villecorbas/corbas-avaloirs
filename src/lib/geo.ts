export interface LatLon {
  lat: number;
  lon: number;
}

export interface GpsSample extends LatLon {
  /** Rayon de précision horizontale (m, 68 %). */
  acc: number;
  t: number;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance (m) entre deux points — formule de haversine. */
export function distance(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface AveragedFix extends LatLon {
  acc: number;
  samples: number;
}

/**
 * Moyenne pondérée de plusieurs mesures GPS prises immobile au-dessus de l'avaloir.
 *  1. on écarte les mesures trop imprécises (> 2× la meilleure, et > 30 m) ;
 *  2. on écarte les mesures aberrantes (> 2,5× la précision de la médiane) ;
 *  3. moyenne pondérée par 1/acc² ; précision résultante = max(meilleure, σ pondéré).
 */
export function averageFixes(samples: GpsSample[]): AveragedFix | null {
  if (!samples.length) return null;
  const best = Math.min(...samples.map((s) => s.acc));
  let kept = samples.filter((s) => s.acc <= Math.max(best * 2, best + 3) && s.acc <= Math.max(30, best));
  if (!kept.length) kept = samples;

  const med = {
    lat: median(kept.map((s) => s.lat)),
    lon: median(kept.map((s) => s.lon)),
  };
  const filtered = kept.filter((s) => distance(s, med) <= Math.max(2.5 * s.acc, 3));
  if (filtered.length) kept = filtered;

  let wSum = 0;
  let lat = 0;
  let lon = 0;
  for (const s of kept) {
    const w = 1 / Math.max(s.acc, 0.5) ** 2;
    wSum += w;
    lat += s.lat * w;
    lon += s.lon * w;
  }
  lat /= wSum;
  lon /= wSum;
  const center = { lat, lon };

  // Dispersion des mesures autour de la moyenne.
  let spread = 0;
  for (const s of kept) spread += (1 / Math.max(s.acc, 0.5) ** 2) * distance(s, center) ** 2;
  spread = Math.sqrt(spread / wSum);

  // La moyenne de n mesures (partiellement corrélées) améliore un peu la précision.
  const statAcc = Math.min(...kept.map((s) => s.acc)) / Math.sqrt(Math.min(kept.length, 4)) * 1.4;
  const acc = Math.max(Math.min(best, statAcc), spread, 1);
  return { lat, lon, acc: round(acc, 1), samples: kept.length };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function round(n: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export type AccuracyLevel = 'excellent' | 'good' | 'fair' | 'poor';

export function accuracyLevel(acc: number): AccuracyLevel {
  if (acc <= 3) return 'excellent';
  if (acc <= 6) return 'good';
  if (acc <= 12) return 'fair';
  return 'poor';
}

/** Arrondi des coordonnées à 7 décimales (~1 cm), précision native d'OSM. */
export function osmCoord(n: number): string {
  return n.toFixed(7);
}

export function bboxAround(p: LatLon, meters: number): [number, number, number, number] {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos(rad(p.lat)));
  return [p.lat - dLat, p.lon - dLon, p.lat + dLat, p.lon + dLon];
}

/* ---------------- Géométrie locale (petites distances) ----------------- */

/** Point situé à `meters` de `p` dans la direction `bearingDeg` (0 = nord, 90 = est). */
export function offset(p: LatLon, bearingDeg: number, meters: number): LatLon {
  const b = rad(bearingDeg);
  const dLat = (meters * Math.cos(b)) / 111_320;
  const dLon = (meters * Math.sin(b)) / (111_320 * Math.cos(rad(p.lat)));
  return { lat: p.lat + dLat, lon: p.lon + dLon };
}

/** Cap (degrés, 0 = nord) de a vers b. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = (b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
  const x = b.lat - a.lat;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function midpoint(a: LatLon, b: LatLon): LatLon {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/** Distance (m) d'un point à un segment [a, b]. */
export function distanceToSegment(p: LatLon, a: LatLon, b: LatLon): number {
  const k = 111_320;
  const kx = k * Math.cos(rad(p.lat));
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * k;
  const bx = (b.lon - p.lon) * kx;
  const by = (b.lat - p.lat) * k;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Distance (m) d'un point à une polyligne. */
export function distanceToLine(p: LatLon, line: LatLon[]): number {
  if (line.length === 1) return distance(p, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, distanceToSegment(p, line[i], line[i + 1]));
  return best;
}

export function lineLength(line: LatLon[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += distance(line[i], line[i + 1]);
  return total;
}

/** Point situé à mi-longueur d'une polyligne. */
export function lineCenter(line: LatLon[]): LatLon {
  if (line.length === 1) return line[0];
  const half = lineLength(line) / 2;
  let run = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const d = distance(line[i], line[i + 1]);
    if (run + d >= half && d > 0) {
      const t = (half - run) / d;
      return { lat: line[i].lat + t * (line[i + 1].lat - line[i].lat), lon: line[i].lon + t * (line[i + 1].lon - line[i].lon) };
    }
    run += d;
  }
  return line[line.length - 1];
}
