import { useEffect, useState } from 'react';

/**
 * Rues choisies par la personne pour relever leurs avaloirs : un simple engagement personnel,
 * conservé uniquement sur le téléphone (rien n'est envoyé ni enregistré ailleurs).
 */
const KEY = 'avaloirs.myStreets';
const EVENT = 'avaloirs:streets';
export const MAX_STREETS = 30;

export function readStreets(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 120).slice(0, MAX_STREETS) : [];
  } catch {
    return [];
  }
}

export function setStreetChosen(name: string, chosen: boolean): string[] {
  const cur = readStreets().filter((s) => s !== name);
  const next = chosen ? [...cur, name].slice(-MAX_STREETS) : cur;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : le choix vaut pour la session seulement */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return next;
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
