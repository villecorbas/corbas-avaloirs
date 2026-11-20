import { computeCoverage } from './coverage';
import { distance, type LatLon } from './geo';
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
  /** Part de la longueur de rue couverte par un avaloir connu (0..1). */
  ratio: number;
  /** Nombre d'inscrits (compteur public), si connu. */
  volunteers?: number;
}

export type StreetState = 'todo' | 'partial' | 'done';
/** À partir de 90 % de couverture, la rue est considérée comme faite. */
export const DONE_RATIO = 0.9;
export function streetState(p: Pick<StreetProgress, 'ratio'>): StreetState {
  return p.ratio >= DONE_RATIO ? 'done' : p.ratio > 0.05 ? 'partial' : 'todo';
}

/** Avancement de chaque rue : couverture par les avaloirs connus (OSM + relevés locaux). */
export function streetsProgress(streets: NamedStreet[], drains: LatLon[], counts: Record<string, number> = {}): StreetProgress[] {
  return streets.map((s) => {
    const cov = computeCoverage(s.ways, drains);
    let lengthM = 0;
    for (const w of s.ways) for (let i = 0; i < w.length - 1; i++) lengthM += distance(w[i], w[i + 1]);
    const key = streetKey(s.name);
    return { name: s.name, key, lengthM: Math.round(lengthM), ratio: cov.ratio, volunteers: counts[key] };
  });
}

/** Lit les compteurs publics (`{ counts: { "rue de la gare": 3 } }`), en ignorant tout ce qui n'est pas un petit entier. */
export function parseCounts(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const counts = (json as { counts?: unknown } | null)?.counts;
  if (!counts || typeof counts !== 'object') return out;
  for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10000) out[streetKey(k)] = v;
  }
  return out;
}

/** Adresse du formulaire avec la rue pré-remplie. */
export function formLink(formUrl: string, streetEntry: string, street: string): string {
  if (!formUrl) return '';
  try {
    const u = new URL(formUrl);
    if (streetEntry) {
      u.searchParams.set('usp', 'pp_url');
      u.searchParams.set(streetEntry, street);
    }
    return u.toString();
  } catch {
    return '';
  }
}

/** CSV d'avancement (rue;couverture_pct;longueur_m) à coller dans l'onglet « Avancement » du classeur de la campagne. */
export function progressCSV(rows: StreetProgress[]): string {
  const esc = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
  return ['rue;couverture_pct;longueur_m', ...rows.map((r) => `"${esc(r.name)}";${Math.round(r.ratio * 100)};${r.lengthM}`)].join('\n');
}
