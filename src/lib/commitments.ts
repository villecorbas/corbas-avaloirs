import { useEffect, useState } from 'react';

/**
 * Rues choisies par la personne pour relever leurs avaloirs : un simple engagement personnel,
 * conservé uniquement sur le téléphone (rien n'est envoyé ni enregistré ailleurs).
 */
const KEY = 'avaloirs.myStreets';
const EVENT = 'avaloirs:streets';
export const MAX_STREETS = 30;

export interface Commitment {
  name: string;
  /** Date de l'engagement (0 si inconnue). */
  ts: number;
}

/** Points d'engagement : par rue choisie, pour les {MAX_POINT_STREETS} premières rues (évite d'en cocher cent pour gagner des points). */
export const COMMIT_POINTS = 5;
export const MAX_POINT_STREETS = 3;

export function readCommitments(): Commitment[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const out: Commitment[] = [];
    for (const x of raw) {
      const name = typeof x === 'string' ? x : x && typeof x.n === 'string' ? x.n : '';
      if (!name || name.length > 120) continue;
      out.push({ name, ts: typeof x === 'object' && Number.isFinite(x.t) ? x.t : 0 });
    }
    return out.slice(0, MAX_STREETS);
  } catch {
    return [];
  }
}

export function readStreets(): string[] {
  return readCommitments().map((c) => c.name);
}

export function setStreetChosen(name: string, chosen: boolean, now = Date.now()): string[] {
  const cur = readCommitments().filter((c) => c.name !== name);
  const next = (chosen ? [...cur, { name, ts: now }] : cur).slice(-MAX_STREETS);
  try {
    localStorage.setItem(KEY, JSON.stringify(next.map((c) => ({ n: c.name, t: c.ts }))));
  } catch {
    /* stockage indisponible : le choix vaut pour la session seulement */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return next.map((c) => c.name);
}

export function useMyStreets(): string[] {
  const [list, setList] = useState(readStreets);
  useEffect(() => {
    const sync = () => setList(readStreets());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return list;
}
