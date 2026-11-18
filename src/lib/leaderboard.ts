import type { OsmDrain } from './overpass';

/**
 * Classement public des participants, calculé à partir des données ouvertes
 * d'OpenStreetMap (identique pour tous les téléphones, sans serveur) :
 * 10 points par avaloir, +5 s'il a une photo Panoramax. Le contributeur retenu
 * est le dernier à avoir modifié l'objet (seule information fournie par Overpass).
 */
export const POINTS_PER_DRAIN = 10;
export const POINTS_PER_PHOTO = 5;

export interface LeaderboardEntry {
  user: string;
  drains: number;
  photos: number;
  score: number;
  rank: number;
}

export function hasPhoto(d: OsmDrain): boolean {
  return Object.keys(d.tags).some((k) => k === 'panoramax' || k.startsWith('panoramax:'));
}

export function buildLeaderboard(drains: OsmDrain[], opts: { since?: number } = {}): LeaderboardEntry[] {
  const byUser = new Map<string, { drains: number; photos: number }>();
  for (const d of drains) {
    if (!d.user) continue;
    if (opts.since && (!d.timestamp || Date.parse(d.timestamp) < opts.since)) continue;
    const e = byUser.get(d.user) || { drains: 0, photos: 0 };
    e.drains++;
    if (hasPhoto(d)) e.photos++;
    byUser.set(d.user, e);
  }
  const list = [...byUser.entries()]
    .map(([user, e]) => ({ user, ...e, score: e.drains * POINTS_PER_DRAIN + e.photos * POINTS_PER_PHOTO, rank: 0 }))
    .sort((a, b) => b.score - a.score || b.drains - a.drains || a.user.localeCompare(b.user));
  // Ex aequo : même rang.
  list.forEach((e, i) => (e.rank = i > 0 && list[i - 1].score === e.score ? list[i - 1].rank : i + 1));
  return list;
}
