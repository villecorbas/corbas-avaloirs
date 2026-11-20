import { useEffect, useMemo, useState } from 'react';
import { cachedBanStreets, fetchBanStreets, type BanStreet } from './ban';
import { useCommuneDrains } from './communeDrains';
import { recordCenter } from './export';
import { cachedCommuneStreets, fetchCommuneStreets, type NamedStreet } from './overpass';
import { useRecords } from './store';
import { streetsProgress, type StreetProgress } from './streets';

const STALE_MS = 7 * 86_400_000;

/**
 * Avancement de chaque rue de la commune : liste officielle (BAN) + tracés OpenStreetMap + avaloirs connus
 * (OSM et relevés du téléphone). Cache d'abord, rafraîchi en arrière-plan. `enabled=false` : ne charge rien.
 */
export function useStreetProgress(insee: string | undefined, enabled = true): { progress: StreetProgress[] | null; failed: boolean } {
  const [official, setOfficial] = useState<BanStreet[] | null>(null);
  const [osm, setOsm] = useState<NamedStreet[]>([]);
  const [failed, setFailed] = useState(false);
  const records = useRecords();
  const drains = useCommuneDrains(enabled ? insee : undefined);

  useEffect(() => {
    if (!insee || !enabled) return;
    let alive = true;
    const load = async <T extends { at: number }, R>(cached: () => Promise<T | undefined>, fresh: () => Promise<R>, apply: (c: T) => void, applyFresh: (r: R) => void, required: boolean) => {
      const c = await cached();
      if (!alive) return;
      if (c) apply(c);
      if ((!c || Date.now() - c.at > STALE_MS) && navigator.onLine !== false) {
        try {
          const r = await fresh();
          if (alive) applyFresh(r);
        } catch {
          if (alive && !c && required) setFailed(true);
        }
      }
    };
    void load(() => cachedBanStreets(insee), () => fetchBanStreets(insee), (c) => setOfficial(c.streets), (r) => { setOfficial(r); setFailed(false); }, true);
    void load(() => cachedCommuneStreets(insee), () => fetchCommuneStreets(insee), (c) => setOsm(c.streets), (r) => setOsm(r), false);
    return () => {
      alive = false;
    };
  }, [insee, enabled]);

  const progress = useMemo(
    () => (official ? streetsProgress(official, osm, [...drains, ...(records || []).map(recordCenter)]) : null),
    [official, osm, drains, records],
  );
  return { progress, failed };
}
