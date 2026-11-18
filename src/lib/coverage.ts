import { distance, distanceToSegment, type LatLon } from './geo';

/**
 * Couverture des rues : chaque rue est découpée en tronçons d'environ 40 m ;
 * un tronçon est « couvert » si un avaloir connu (OSM ou relevé local) se trouve
 * à moins de `radius` mètres, sinon il est « à explorer ».
 */
export interface Coverage {
  covered: LatLon[][];
  todo: LatLon[][];
  ratio: number; // part de la longueur couverte (0..1)
}

const SEGMENT_M = 40;
const CELL_DEG = 0.0006; // ≈ 65 m : maille de l'index spatial

function cellKey(lat: number, lon: number) {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
}

/** Découpe une polyligne en tronçons d'environ `step` mètres. */
export function splitLine(line: LatLon[], step = SEGMENT_M): LatLon[][] {
  const out: LatLon[][] = [];
  let current: LatLon[] = [line[0]];
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    let a = line[i - 1];
    const b = line[i];
    let d = distance(a, b);
    while (run + d > step && d > 0) {
      const t = (step - run) / d;
      const cut = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
      current.push(cut);
      out.push(current);
      current = [cut];
      a = cut;
      d = distance(a, b);
      run = 0;
    }
    current.push(b);
    run += d;
  }
  if (current.length > 1) out.push(current);
  return out;
}

export function computeCoverage(streets: LatLon[][], drains: LatLon[], radius = 35): Coverage {
  const index = new Map<string, LatLon[]>();
  for (const p of drains) {
    const k = cellKey(p.lat, p.lon);
    if (!index.has(k)) index.set(k, []);
    index.get(k)!.push(p);
  }
  const reach = Math.ceil(radius / 65) + 1;
  const near = (seg: LatLon[]) => {
    const mid = seg[Math.floor(seg.length / 2)];
    const ci = Math.floor(mid.lat / CELL_DEG);
    const cj = Math.floor(mid.lon / CELL_DEG);
    for (let di = -reach; di <= reach; di++) {
      for (let dj = -reach; dj <= reach; dj++) {
        for (const p of index.get(`${ci + di}:${cj + dj}`) || []) {
          for (let i = 0; i < seg.length - 1; i++) if (distanceToSegment(p, seg[i], seg[i + 1]) <= radius) return true;
        }
      }
    }
    return false;
  };
  const covered: LatLon[][] = [];
  const todo: LatLon[][] = [];
  let lenCovered = 0;
  let lenTotal = 0;
  for (const street of streets) {
    if (street.length < 2) continue;
    for (const seg of splitLine(street)) {
      let len = 0;
      for (let i = 0; i < seg.length - 1; i++) len += distance(seg[i], seg[i + 1]);
      lenTotal += len;
      if (near(seg)) {
        covered.push(seg);
        lenCovered += len;
      } else todo.push(seg);
    }
  }
  return { covered, todo, ratio: lenTotal ? lenCovered / lenTotal : 0 };
}
