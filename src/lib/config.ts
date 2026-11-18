export interface AppConfig {
  campaignName: string;
  commune: { insee: string; name: string; estimatedDrains: number };
  dailyGoal: number;
  openstreetmap: {
    environment: 'production' | 'dev';
    clientId: string;
    clientIdDev: string;
    redirectUri: string;
    hashtags: string[];
    /** Caniveaux à grille : 'way' (ligne waterway=drainage_gutter), 'node' (point inlet=grate) ou 'none'. */
    channelDrainTagging: 'way' | 'node' | 'none';
  };
  panoramax: { instance: string };
  overpass: string[];
}

const DEFAULTS: AppConfig = {
  campaignName: 'Chasse aux avaloirs',
  commune: { insee: '', name: '', estimatedDrains: 1500 },
  dailyGoal: 5,
  openstreetmap: {
    environment: 'production',
    clientId: '',
    clientIdDev: '',
    redirectUri: '',
    hashtags: ['#avaloirs', '#moustiquetigre'],
    channelDrainTagging: 'way',
  },
  panoramax: { instance: 'https://panoramax.openstreetmap.fr' },
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
};

declare global {
  interface Window {
    AVALOIRS_CONFIG?: Partial<AppConfig>;
  }
}

function merge<T>(base: T, extra: unknown): T {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return (extra as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

/** Les serveurs configurables doivent être en HTTPS (jamais de jeton envoyé en clair). */
export function sanitizeConfig(cfg: AppConfig): AppConfig {
  const https = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u);
  const overpass = (Array.isArray(cfg.overpass) ? cfg.overpass : []).filter(https);
  const channel = ['way', 'node', 'none'].includes(cfg.openstreetmap.channelDrainTagging) ? cfg.openstreetmap.channelDrainTagging : 'way';
  return {
    ...cfg,
    dailyGoal: Number.isFinite(cfg.dailyGoal) && cfg.dailyGoal > 0 ? Math.min(Math.round(cfg.dailyGoal), 100) : DEFAULTS.dailyGoal,
    openstreetmap: { ...cfg.openstreetmap, channelDrainTagging: channel as AppConfig['openstreetmap']['channelDrainTagging'] },
    panoramax: { instance: https(cfg.panoramax?.instance) ? cfg.panoramax.instance : DEFAULTS.panoramax.instance },
    overpass: overpass.length ? overpass : DEFAULTS.overpass,
  };
}

let cached: AppConfig | null = null;

/** Réglages « développeur » stockés localement (mode test OSM, etc.). */
const OVERRIDES_KEY = 'avaloirs.configOverrides';

export function getConfig(): AppConfig {
  if (cached) return cached;
  let overrides: Partial<AppConfig> = {};
  try {
    overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch {
    overrides = {};
  }
  const fromWindow = typeof window !== 'undefined' ? window.AVALOIRS_CONFIG : undefined;
  cached = sanitizeConfig(merge(merge(DEFAULTS, fromWindow), overrides));
  return cached;
}

export function setConfigOverride(patch: Partial<AppConfig>) {
  let current: Partial<AppConfig> = {};
  try {
    current = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch {
    current = {};
  }
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(merge(current, patch)));
  cached = null;
}

export function osmUrls(cfg = getConfig()) {
  const dev = cfg.openstreetmap.environment === 'dev';
  return dev
    ? {
        web: 'https://master.apis.dev.openstreetmap.org',
        api: 'https://master.apis.dev.openstreetmap.org',
        clientId: cfg.openstreetmap.clientIdDev,
        dev,
      }
    : {
        web: 'https://www.openstreetmap.org',
        api: 'https://api.openstreetmap.org',
        clientId: cfg.openstreetmap.clientId,
        dev,
      };
}

export function appBaseUrl(): string {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/[^/]*$/, '');
}

export const APP_VERSION = '1.0.0';
