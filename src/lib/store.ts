import { useEffect, useMemo, useState } from 'react';
import { allRecords, onRecordsChange, type DrainRecord } from './db';
import { computeProgress } from './gamification';
import { getOsmAuth, type OsmAuth } from './osm';
import { checkPanoramaxUser, getPanoramaxAuth, type PanoramaxAuth } from './panoramax';

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
  // Les invitations sont dans localStorage : on recalcule quand l'une est enregistrée.
  const [inviteVersion, setInviteVersion] = useState(0);
  useEffect(() => {
    const bump = () => setInviteVersion((v) => v + 1);
    window.addEventListener('avaloirs:invites', bump);
    return () => window.removeEventListener('avaloirs:invites', bump);
  }, []);
  return useMemo(() => computeProgress(records || []), [records, day, inviteVersion]);
}

export function useAuth(): { osm: OsmAuth | null; pnx: PanoramaxAuth | null } {
  const [state, setState] = useState(() => ({ osm: getOsmAuth(), pnx: getPanoramaxAuth() }));
  useEffect(() => {
    const update = () => setState({ osm: getOsmAuth(), pnx: getPanoramaxAuth() });
    const onVisible = () => document.visibilityState === 'visible' && update();
    window.addEventListener('avaloirs:auth', update);
    window.addEventListener('storage', update);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('avaloirs:auth', update);
      window.removeEventListener('storage', update);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', onVisible);
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

/** Sur iPhone/iPad : Safari (navigateur par défaut) ou un autre navigateur (Chrome, Firefox, Edge…). */
export function iosBrowser(): 'safari' | 'other' {
  return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent) ? 'other' : 'safari';
}

export function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** Tant qu'une connexion Panoramax est en attente, vérifie régulièrement si elle a abouti. */
export function usePanoramaxClaimPolling(active: boolean, onConnected?: () => void) {
  useEffect(() => {
    if (!active) return;
    const check = () => void checkPanoramaxUser().then((a) => a?.user && onConnected?.());
    const id = setInterval(check, 3000);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
