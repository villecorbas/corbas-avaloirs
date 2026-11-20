import { computeCoverage } from './coverage';
import { distance, type LatLon } from './geo';
import type { BanStreet } from './ban';
import type { NamedStreet } from './overpass';

/** Clé de comparaison d'un nom de rue : sans accents, casse, ponctuation ni espaces multiples. */
export function streetKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface StreetProgress {
  name: string;
  key: string;
  lengthM: number;
  /** Part de la longueur de rue couverte par un avaloir connu (0..1) ; null si la rue n'est pas (encore) tracée dans OpenStreetMap. */
  ratio: number | null;
}

export type StreetState = 'todo' | 'partial' | 'done' | 'unknown';
/** À partir de 90 % de couverture, la rue est considérée comme faite. */
export const DONE_RATIO = 0.9;
export function streetState(p: Pick<StreetProgress, 'ratio'>): StreetState {
  if (p.ratio === null) return 'unknown';
  return p.ratio >= DONE_RATIO ? 'done' : p.ratio > 0.05 ? 'partial' : 'todo';
}

/**
 * Avancement de chaque rue de la liste officielle (BAN) : la géométrie OpenStreetMap est rapprochée par le nom ;
 * une rue sans tracé correspondant reste dans la liste, avec un avancement inconnu.
 */
export function streetsProgress(official: BanStreet[], osm: NamedStreet[], drains: LatLon[]): StreetProgress[] {
  const geometry = new Map<string, LatLon[][]>();
  for (const s of osm) {
    const k = streetKey(s.name);
    geometry.set(k, [...(geometry.get(k) || []), ...s.ways]);
  }
  return official.map((o) => {
    const key = streetKey(o.name);
    const ways = geometry.get(key);
    let lengthM = 0;
    let ratio: number | null = null;
    if (ways?.length) {
      ratio = computeCoverage(ways, drains).ratio;
      for (const w of ways) for (let i = 0; i < w.length - 1; i++) lengthM += distance(w[i], w[i + 1]);
    }
    return { name: o.name, key, lengthM: Math.round(lengthM), ratio };
  });
}
