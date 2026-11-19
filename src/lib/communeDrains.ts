import { useEffect, useMemo, useState } from 'react';
import { cachedCommuneStats, fetchCommuneStats, type OsmDrain } from './overpass';

const STALE_MS = 6 * 3600_000;

/**
 * Tous les avaloirs déjà cartographiés sur la commune (OpenStreetMap), du cache d'abord puis
 * rafraîchis en arrière-plan. Sert à la carte principale (vue d'ensemble) et à l'alerte de doublon,
 * même quand la zone affichée n'est pas encore chargée ou que le réseau est faible.
 */
export function useCommuneDrains(insee?: string): OsmDrain[] {
  const [drains, setDrains] = useState<OsmDrain[]>([]);
  useEffect(() => {
    if (!insee) return;
    let alive = true;
    void cachedCommuneStats(insee).then(async (c) => {
      if (!alive) return;
      if (c) setDrains(c.drains);
      if ((!c || Date.now() - c.at > STALE_MS) && navigator.onLine !== false) {
        try {
          const s = await fetchCommuneStats(insee);
          if (alive) setDrains(s.drains);
        } catch {
          /* on garde le cache */
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [insee]);
  return drains;
}

/** Réunit plusieurs listes d'avaloirs sans doublons (même objet OSM). */
export function mergeDrains(...lists: OsmDrain[][]): OsmDrain[] {
  const seen = new Set<string>();
  const out: OsmDrain[] = [];
  for (const l of lists)
    for (const d of l) {
      const k = `${d.type ?? 'node'}:${d.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
  return out;
}

export function useMergedDrains(...lists: OsmDrain[][]): OsmDrain[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeDrains(...lists), lists);
}
