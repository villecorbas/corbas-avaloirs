import { useSyncExternalStore } from 'react';
import fr from './fr';
import en from './en';

export type Dict = { [key: string]: string | Dict };
export type Lang = 'fr' | 'en';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
];

const DICTS: Record<Lang, Dict> = { fr, en };
const STORAGE_KEY = 'avaloirs.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && saved in DICTS) return saved;
  } catch {
    /* stockage indisponible */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'fr';
  // Français par défaut : l'anglais seulement si le téléphone est explicitement en anglais.
  return nav.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

function lookup(dict: Dict, key: string): string | Dict | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

export type Params = Record<string, string | number>;

/**
 * Traduit une clé. Les pluriels utilisent des sous-clés `one` / `other` (et `zero`
 * optionnel) choisies avec Intl.PluralRules selon le paramètre `count`.
 */
export function t(key: string, params: Params = {}): string {
  let node = lookup(DICTS[current], key) ?? lookup(DICTS.fr, key);
  if (node && typeof node === 'object') {
    const count = Number(params.count ?? 0);
    const rule = count === 0 && 'zero' in node ? 'zero' : new Intl.PluralRules(current).select(count);
    node = (node[rule] as string) ?? (node.other as string);
  }
  if (typeof node !== 'string') return key;
  const out = node.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] === undefined ? `{${name}}` : formatParam(params[name]),
  );
  return current === 'fr' ? frenchTypography(out) : out;
}

/**
 * Espaces insécables de la typographie française : jamais de « ? » ou de « : »
 * rejeté seul en début de ligne, ni d'unité séparée de son nombre.
 */
export function frenchTypography(s: string): string {
  return s
    .replace(/ ([?!;:»])/g, '\u202F$1')
    .replace(/« /g, '«\u202F')
    .replace(/± /g, '±\u00A0')
    .replace(/(\d) (m|pts|%|h|jours?)(?=$|[\s.,·)!?])/g, '$1\u00A0$2');
}

function formatParam(v: string | number): string {
  return typeof v === 'number' ? new Intl.NumberFormat(current).format(v) : v;
}

export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(current, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function formatDate(ts: number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  return new Intl.DateTimeFormat(current, opts).format(new Date(ts));
}

export function formatRelative(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(current, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(ts, { dateStyle: 'medium' });
}

/** Hook React : re-rend le composant quand la langue change. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

/** Pour les tests : liste de toutes les clés feuilles d'un dictionnaire. */
export function flattenKeys(dict: Dict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') return [key];
    if (['one', 'other', 'zero'].some((p) => p in v)) return [key];
    return flattenKeys(v, key);
  });
}

export { fr, en };
