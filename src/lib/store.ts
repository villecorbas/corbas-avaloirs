import { useEffect, useMemo, useState } from 'react';
import { allRecords, onRecordsChange, type DrainRecord } from './db';
import { computeProgress } from './gamification';
import { getOsmAuth, type OsmAuth } from './osm';
import { getPanoramaxAuth, type PanoramaxAuth } from './panoramax';

let recordsCache: DrainRecord[] | null = null;
const recordListeners = new Set<(r: DrainRecord[]) => void>();
let subscribed = false;

async function reload() {
  recordsCache = await allRecords();
  recordListeners.forEach((l) => l(recordsCache!));
}

export function useRecords(): DrainRecord[] | null {
  const [records, setRecords] = useState<DrainRecord[] | null>(recordsCache);
  useEffect(() => {
    recordListeners.add(setRecords);
    if (!subscribed) {
      subscribed = true;
      onRecordsChange(() => void reload());
    }
    if (!recordsCache) void reload();
    else setRecords(recordsCache);
    return () => {
      recordListeners.delete(setRecords);
    };
  }, []);
  return records;
}

export function useProgress() {
  const records = useRecords();
  // Recalcule à minuit (objectif du jour, série).
  const [day, setDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const id = setInterval(() => setDay(new Date().toDateString()), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => computeProgress(records || []), [records, day]);
}

export function useAuth(): { osm: OsmAuth | null; pnx: PanoramaxAuth | null } {
  const [state, setState] = useState(() => ({ osm: getOsmAuth(), pnx: getPanoramaxAuth() }));
  useEffect(() => {
    const update = () => setState({ osm: getOsmAuth(), pnx: getPanoramaxAuth() });
    window.addEventListener('avaloirs:auth', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('avaloirs:auth', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return state;
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Mode d'affichage : application installée (écran d'accueil) ou navigateur. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
