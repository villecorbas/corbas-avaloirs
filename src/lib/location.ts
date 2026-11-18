import { useEffect, useState } from 'react';
import type { GpsSample } from './geo';

/**
 * Service de localisation partagé : un seul watchPosition haute précision,
 * démarré dès l'ouverture du parcours de saisie pour « chauffer » le GPS.
 */

export type GeoStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable';

interface State {
  status: GeoStatus;
  fix: GpsSample | null;
  heading: number | null;
}

let state: State = { status: 'idle', fix: null, heading: null };
let watchId: number | null = null;
let users = 0;
const listeners = new Set<(s: State) => void>();
const sampleListeners = new Set<(s: GpsSample) => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

function start() {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) {
    set({ status: 'unavailable' });
    return;
  }
  set({ status: state.fix ? 'ok' : 'locating' });
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const sample: GpsSample = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        acc: pos.coords.accuracy,
        t: pos.timestamp || Date.now(),
      };
      set({ status: 'ok', fix: sample });
      sampleListeners.forEach((l) => l(sample));
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) set({ status: 'denied' });
      else if (!state.fix) set({ status: 'unavailable' });
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  );
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export function acquireLocation() {
  users++;
  start();
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

function onOrientation(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
  let heading: number | null = null;
  if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iOS
  else if (e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360; // Android
  if (heading !== null) {
    const angle = (screen.orientation?.angle ?? 0) as number;
    set({ heading: (heading + angle + 360) % 360 });
  }
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({
          status: 'ok',
          fix: { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp },
        });
        resolve(true);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) set({ status: 'denied' });
        resolve(err.code !== err.PERMISSION_DENIED);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}
