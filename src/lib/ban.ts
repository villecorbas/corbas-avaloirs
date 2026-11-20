import { kvGet, kvSet } from './db';

/**
 * Liste officielle des voies d'une commune : Base Adresse Nationale (BAN), référentiel de l'État
 * publié en open data sur adresse.data.gouv.fr (Licence Ouverte). Sert de liste de référence pour
 * la campagne ; la géométrie des rues, elle, vient d'OpenStreetMap (voir overpass.ts).
 */
export interface BanStreet {
  name: string;
  /** Nombre de numéros d'adresse de la voie (indication de taille). */
  numbers: number;
}

const BAN = 'https://plateforme.adresse.data.gouv.fr/lookup/';

/** Extrait les voies (hors lieux-dits) de la réponse de la BAN, en ignorant tout ce qui est mal formé. */
export function parseBanVoies(json: unknown): BanStreet[] {
  const voies = (json as { voies?: unknown } | null)?.voies;
  if (!Array.isArray(voies)) return [];
  const seen = new Set<string>();
  const out: BanStreet[] = [];
  for (const v of voies as Record<string, unknown>[]) {
    if (v?.type !== 'voie' || typeof v.nomVoie !== 'string') continue;
    const name = v.nomVoie.replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120 || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, numbers: typeof v.nbNumeros === 'number' && v.nbNumeros >= 0 ? v.nbNumeros : 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function fetchBanStreets(insee: string): Promise<BanStreet[]> {
  const res = await fetch(BAN + encodeURIComponent(insee.replace(/[^0-9AB]/gi, '')), { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`ban_${res.status}`);
  const streets = parseBanVoies(await res.json());
  if (!streets.length) throw new Error('ban_empty');
  await kvSet(`ban:${insee}`, { at: Date.now(), streets });
  return streets;
}

export async function cachedBanStreets(insee: string): Promise<{ at: number; streets: BanStreet[] } | undefined> {
  return kvGet(`ban:${insee}`);
}
