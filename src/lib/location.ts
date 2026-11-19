import { useEffect, useState } from 'react';
import type { GpsSample } from './geo';

/**
 * Service de localisation partagé : un seul watchPosition haute précision,
 * démarré dès l'ouverture du parcours de saisie pour « chauffer » le GPS.
 */

export type GeoStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable';
export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

interface State {
  status: GeoStatus;
  fix: GpsSample | null;
  heading: number | null;
  /** Dernière erreur du capteur (1 refus, 2 position indisponible, 3 délai dépassé). */
  error: { code: number; message: string } | null;
  permission: GeoPermission;
}

let state: State = { status: 'idle', fix: null, heading: null, error: null, permission: 'unknown' };
let watchId: number | null = null;
let users = 0;
/** Haute précision d'abord ; si le téléphone n'y arrive pas (intérieur, GPS froid), repli sur le réseau. */
let highAccuracy = true;
let visibilityBound = false;
const listeners = new Set<(s: State) => void>();
const sampleListeners = new Set<(s: GpsSample) => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

function start() {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) {
    set({ status: 'unavailable', error: { code: 0, message: 'geolocation_unsupported' } });
    return;
  }
  bindVisibility();
  set({ status: state.fix ? 'ok' : 'locating' });
  const options: PositionOptions = highAccuracy
    ? { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    : { enableHighAccuracy: false, maximumAge: 30000, timeout: 25000 };
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const sample: GpsSample = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        acc: pos.coords.accuracy,
        t: pos.timestamp || Date.now(),
      };
      set({ status: 'ok', fix: sample, error: null, permission: 'granted' });
      sampleListeners.forEach((l) => l(sample));
    },
    (err) => {
      const error = { code: err.code, message: err.message };
      if (err.code === err.PERMISSION_DENIED) {
        stop();
        set({ status: 'denied', error, permission: 'denied' });
      } else if (!state.fix) {
        if (highAccuracy) {
          // Le GPS précis n'a rien donné : on retente tout de suite avec la position réseau (Wi-Fi, antennes).
          stop();
          highAccuracy = false;
          start();
        } else {
          stop();
          set({ status: 'unavailable', error });
        }
      }
    },
    options,
  );
}

/** Relance la recherche (bouton « Réessayer », retour dans l'application après un réglage). */
export function restartLocation() {
  stop();
  highAccuracy = true;
  set({ status: 'locating', error: null });
  if (users > 0) start();
}

/** Au retour dans l'appli (après les Réglages du téléphone), on relance si la position était bloquée. */
function bindVisibility() {
  if (visibilityBound) return;
  visibilityBound = true;
  const retry = () => {
    if (document.visibilityState !== 'visible' || users === 0) return;
    if (state.status === 'denied' || state.status === 'unavailable') restartLocation();
  };
  document.addEventListener('visibilitychange', retry);
  window.addEventListener('focus', retry);
}

/** État de l'autorisation, quand le navigateur sait le dire (sans déclencher de demande). */
export async function refreshPermission() {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (!p) return;
    set({ permission: p.state as GeoPermission });
    p.onchange = () => {
      set({ permission: p.state as GeoPermission });
      if (p.state === 'granted' && users > 0 && state.status !== 'ok') restartLocation();
    };
  } catch {
    /* Permissions API indisponible : on n'en déduit rien */
  }
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export function acquireLocation() {
  users++;
  // Après un refus ou un échec, on ne relance pas à chaque écran (cela ferait clignoter l'interface
  // et redemanderait l'autorisation) : « Réessayer » ou le retour dans l'appli s'en chargent.
  if (state.status !== 'denied' && state.status !== 'unavailable') start();
  return () => {
    users = Math.max(0, users - 1);
    if (users === 0) stop();
  };
}

export function onSample(l: (s: GpsSample) => void) {
  sampleListeners.add(l);
  return () => sampleListeners.delete(l);
}

export function getLocationState() {
  return state;
}

/** Hook : position courante (démarre le GPS tant que le composant est monté). */
export function useLocation(active = true): State {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    const release = active ? acquireLocation() : () => undefined;
    return () => {
      listeners.delete(setS);
      release();
    };
  }, [active]);
  return s;
}

/* ---------------------------- Boussole ---------------------------------- */

let compassOn = false;
let lastHeadingAt = 0;

function onOrientation(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
  let heading: number | null = null;
  if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iOS
  else if (e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360; // Android
  if (heading === null) return;
  const angle = (screen.orientation?.angle ?? 0) as number;
  const h = (heading + angle + 360) % 360;
  // Les capteurs émettent à ~60 Hz : on ne notifie les écrans qu'au-delà de 3° et 5 fois par seconde.
  const now = performance.now();
  const prev = state.heading;
  const delta = prev === null ? 360 : Math.min(Math.abs(h - prev), 360 - Math.abs(h - prev));
  if (delta < 3 || now - lastHeadingAt < 200) return;
  lastHeadingAt = now;
  set({ heading: h });
}

/** Doit être appelé lors d'un geste utilisateur (exigence iOS). */
export async function enableCompass(): Promise<boolean> {
  if (compassOn) return true;
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
    .DeviceOrientationEvent;
  try {
    if (DOE?.requestPermission) {
      const r = await DOE.requestPermission();
      if (r !== 'granted') return false;
    }
  } catch {
    return false;
  }
  window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, true);
  window.addEventListener('deviceorientation', onOrientation as EventListener, true);
  compassOn = true;
  return true;
}

/** Demande l'autorisation de localisation (une mesure unique). */
export function requestLocationPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(false);
    // Appelée depuis un geste de l'utilisateur : c'est ce qui fait apparaître la demande d'autorisation de façon fiable.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({
          status: 'ok',
          error: null,
          permission: 'granted',
          fix: { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp },
        });
        if (users > 0) restartLocation();
        resolve(true);
      },
      (err) => {
        const error = { code: err.code, message: err.message };
        if (err.code === err.PERMISSION_DENIED) set({ status: 'denied', error, permission: 'denied' });
        else set({ error });
        resolve(err.code !== err.PERMISSION_DENIED);
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
    );
  });
}
