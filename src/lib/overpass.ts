import { getConfig } from './config';
import { kvGet, kvSet } from './db';
import { distance, distanceToLine, lineCenter, lineLength, type LatLon } from './geo';
import { isDrainFeature, type Tags } from './taxonomy';

/** Avaloir présent dans OSM : nœud, ou chemin (caniveau à grille) représenté par son centre. */
export interface OsmDrain {
  type: 'node' | 'way';
  id: number;
  lat: number;
  lon: number;
  tags: Tags;
  geometry?: LatLon[];
  length?: number;
  user?: string;
  timestamp?: string;
}

interface RawElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Tags;
  geometry?: { lat: number; lon: number }[];
  user?: string;
  timestamp?: string;
}

const DRAIN_FILTER = (scope: string) => `
  node["manhole"="drain"]${scope};
  node["inlet"~"^(grate|kerb_grate|kerb_opening)$"]${scope};
  way["waterway"="drainage_gutter"]${scope};`;

/** Distance (m) entre un point et un avaloir OSM (au tracé pour un caniveau). */
export function distanceToDrain(p: LatLon, d: OsmDrain): number {
  return d.geometry && d.geometry.length > 1 ? distanceToLine(p, d.geometry) : distance(p, d);
}

async function runOverpass(query: string, timeoutMs = 25000): Promise<{ elements: RawElement[] }> {
  const endpoints = getConfig().overpass;
  let lastError: unknown = null;
  for (const url of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = await res.json();
        // Overpass répond 200 avec un résultat tronqué quand la requête dépasse son temps ou sa mémoire.
        if (typeof json.remark === 'string' && /runtime error|timed out|out of memory/i.test(json.remark)) {
          lastError = new Error('overpass_partial');
          continue;
        }
        return json;
      }
      lastError = new Error(`overpass_${res.status}`);
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
    }
  }
  throw lastError ?? new Error('overpass_unavailable');
}

export function normalize(elements: RawElement[]): OsmDrain[] {
  const out: OsmDrain[] = [];
  for (const e of elements) {
    if (!e.tags || !isDrainFeature(e.tags)) continue;
    const base = { id: e.id, tags: e.tags, user: e.user, timestamp: e.timestamp };
    if (e.type === 'way' && e.geometry?.length) {
      const geometry = e.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
      const c = lineCenter(geometry);
      out.push({ ...base, type: 'way', lat: c.lat, lon: c.lon, geometry, length: Math.round(lineLength(geometry) * 10) / 10 });
    } else if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      out.push({ ...base, type: 'node', lat: e.lat, lon: e.lon });
    }
  }
  return out;
}

/** Avaloirs déjà présents dans OSM autour d'un point (mis en cache pour le hors-ligne). */
export async function fetchNearbyDrains(center: LatLon, radius = 500): Promise<OsmDrain[]> {
  const scope = `(around:${Math.round(radius)},${center.lat.toFixed(6)},${center.lon.toFixed(6)})`;
  const q = `[out:json][timeout:20];(${DRAIN_FILTER(scope)});out body geom;`;
  const json = await runOverpass(q);
  const drains = normalize(json.elements);
  await kvSet('nearbyDrains', { center, radius, at: Date.now(), drains });
  return drains;
}

export async function cachedNearbyDrains(): Promise<{ center: LatLon; at: number; drains: OsmDrain[] } | undefined> {
  return kvGet('nearbyDrains');
}

export interface CommuneStats {
  insee: string;
  name?: string;
  total: number;
  byType: Record<string, number>;
  withPhoto: number;
  leaderboard: { user: string; count: number }[];
  at: number;
  drains: OsmDrain[];
}

/** Statistiques de la commune (code INSEE) : total, répartition, classement des contributeurs. */
export async function fetchCommuneStats(insee: string): Promise<CommuneStats> {
  const q = `[out:json][timeout:60];
area["ref:INSEE"="${insee.replace(/[^0-9AB]/gi, '')}"]["boundary"="administrative"]->.a;
(${DRAIN_FILTER('(area.a)')});
out meta geom;`;
  const json = await runOverpass(q, 40000);
  const drains = normalize(json.elements);
  const byType: Record<string, number> = {};
  const users = new Map<string, number>();
  let withPhoto = 0;
  for (const d of drains) {
    const t = d.tags.waterway === 'drainage_gutter' ? 'channel' : d.tags.inlet || 'drain';
    byType[t] = (byType[t] || 0) + 1;
    if (Object.keys(d.tags).some((k) => k.startsWith('panoramax'))) withPhoto++;
    if (d.user) users.set(d.user, (users.get(d.user) || 0) + 1);
  }
  const leaderboard = [...users.entries()]
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  const stats: CommuneStats = { insee, total: drains.length, byType, withPhoto, leaderboard, at: Date.now(), drains };
  await kvSet(`commune:${insee}`, stats);
  return stats;
}

export async function cachedCommuneStats(insee: string): Promise<CommuneStats | undefined> {
  return kvGet(`commune:${insee}`);
}

/* ------------------------- Zone affichée sur la carte ------------------------ */

export interface AreaData {
  bbox: [number, number, number, number]; // sud, ouest, nord, est
  drains: OsmDrain[];
  streets: LatLon[][];
  at: number;
}

/** Rues où l'on trouve des avaloirs (hors chemins, pistes et voies de service). */
const STREET_TYPES = 'primary|secondary|tertiary|unclassified|residential|living_street|pedestrian';

/** Avaloirs et rues d'une emprise (une seule requête Overpass). */
export async function fetchArea(bbox: [number, number, number, number]): Promise<AreaData> {
  const b = bbox.map((n) => n.toFixed(5)).join(',');
  const q = `[out:json][timeout:25][bbox:${b}];
(${DRAIN_FILTER('')});
out body geom;
way["highway"~"^(${STREET_TYPES})$"];
out geom;`;
  const json = await runOverpass(q);
  const streets: LatLon[][] = [];
  const drainElements: RawElement[] = [];
  for (const e of json.elements as (RawElement & { tags?: Tags })[]) {
    if (e.type === 'way' && e.tags?.highway && e.geometry) streets.push(e.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
    else drainElements.push(e);
  }
  const data: AreaData = { bbox, drains: normalize(drainElements), streets, at: Date.now() };
  await kvSet('areaData', data);
  return data;
}

export async function cachedArea(): Promise<AreaData | undefined> {
  return kvGet('areaData');
}


/* --------------------------- Rues nommées de la commune --------------------------- */

export interface NamedStreet {
  name: string;
  /** Tronçons OSM de la rue (une rue peut en compter plusieurs). */
  ways: LatLon[][];
}

/** Toutes les rues nommées de la commune (avancement des rues de la campagne « Mes rues à relever »). */
export async function fetchCommuneStreets(insee: string): Promise<NamedStreet[]> {
  const q = `[out:json][timeout:60];
area["ref:INSEE"="${insee.replace(/[^0-9AB]/gi, '')}"]["boundary"="administrative"]->.a;
way["highway"~"^(${STREET_TYPES})$"]["name"](area.a);
out tags geom;`;
  const json = await runOverpass(q, 40000);
  const byName = new Map<string, LatLon[][]>();
  for (const e of json.elements as (RawElement & { tags?: Tags })[]) {
    const name = e.tags?.name?.trim();
    if (e.type !== 'way' || !name || !e.geometry || e.geometry.length < 2) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(e.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
  }
  const streets = [...byName.entries()].map(([name, ways]) => ({ name, ways })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  await kvSet(`streets:${insee}`, { at: Date.now(), streets });
  return streets;
}

export async function cachedCommuneStreets(insee: string): Promise<{ at: number; streets: NamedStreet[] } | undefined> {
  return kvGet(`streets:${insee}`);
}
