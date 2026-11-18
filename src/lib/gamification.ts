import type { DrainRecord } from './db';
import { INVITE_POINTS, readInvites, wasInvited, WELCOME_POINTS, type InviteEntry } from './inviteLog';
import type { DrainDetails, Observations } from './taxonomy';

/* ------------------------------------------------------------------------ */
/* Qualité d'un relevé (0-100) et étoiles                                    */
/* ------------------------------------------------------------------------ */

export interface QualityInput {
  acc: number;
  samples: number;
  sharpness: number;
  details: DrainDetails;
  observations: Observations;
}

export interface QualityPart {
  key: 'precision' | 'photo' | 'type' | 'details' | 'observations';
  score: number;
  max: number;
}

export function qualityParts(q: QualityInput): QualityPart[] {
  const precision = q.acc <= 3 ? 40 : q.acc <= 5 ? 33 : q.acc <= 8 ? 24 : q.acc <= 12 ? 14 : 5;
  const averagingBonus = q.samples >= 5 ? 0 : -3;
  const photo = q.sharpness >= 0.35 ? 25 : q.sharpness >= 0.12 ? 17 : 6;
  const type = q.details.type === 'generic' ? 6 : 15;
  let details = 0;
  // La forme n'est pas demandée pour une bouche ou un caniveau : pas de pénalité.
  if (q.details.shape || q.details.type === 'kerb_opening' || q.details.type === 'channel') details += 5;
  if (q.details.material) details += 5;
  const obs = (q.observations.standingWater ? 5 : 0) +
    (q.observations.clogged && q.observations.clogged !== 'unknown' ? 5 : 0);
  return [
    { key: 'precision', score: Math.max(0, precision + averagingBonus), max: 40 },
    { key: 'photo', score: photo, max: 25 },
    { key: 'type', score: type, max: 15 },
    { key: 'details', score: Math.min(details, 10), max: 10 },
    { key: 'observations', score: Math.min(obs, 10), max: 10 },
  ];
}

export function qualityScore(q: QualityInput): { score: number; stars: 1 | 2 | 3 } {
  const score = qualityParts(q).reduce((s, p) => s + p.score, 0);
  return { score, stars: score >= 80 ? 3 : score >= 55 ? 2 : 1 };
}

/* ------------------------------------------------------------------------ */
/* Points                                                                    */
/* ------------------------------------------------------------------------ */

export const PUBLISH_BONUS = 5;

export interface PointLine {
  key: 'base' | 'quality' | 'precise' | 'new' | 'enrich' | 'firstOfDay' | 'streak' | 'invited';
  points: number;
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function recordPoints(
  input: QualityInput & { mode: 'new' | 'enrich'; at: number },
  previous: DrainRecord[],
): { total: number; lines: PointLine[] } {
  const lines: PointLine[] = [{ key: 'base', points: 10 }];
  // Bonus de bienvenue : la personne est arrivée par un lien d'invitation.
  if (previous.length === 0 && wasInvited()) lines.push({ key: 'invited', points: WELCOME_POINTS });
  const { score } = qualityScore(input);
  lines.push({ key: 'quality', points: Math.round(score / 10) });
  if (input.acc <= 3) lines.push({ key: 'precise', points: 5 });
  lines.push(input.mode === 'new' ? { key: 'new', points: 5 } : { key: 'enrich', points: 5 });
  const today = dayKey(input.at);
  if (!previous.some((r) => dayKey(r.createdAt) === today)) lines.push({ key: 'firstOfDay', points: 5 });
  const streak = streakDays([...previous.map((r) => r.createdAt), input.at], input.at);
  if (streak >= 3) lines.push({ key: 'streak', points: 5 });
  return { total: lines.reduce((s, l) => s + l.points, 0), lines };
}

/** Nombre de jours consécutifs avec au moins un relevé, jusqu'à aujourd'hui (ou hier). */
export function streakDays(timestamps: number[], now = Date.now()): number {
  const days = new Set(timestamps.map(dayKey));
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ------------------------------------------------------------------------ */
/* Niveaux                                                                   */
/* ------------------------------------------------------------------------ */

export const LEVELS = [0, 50, 150, 300, 500, 800, 1200, 1800, 2600, 3600];

export function levelFor(points: number) {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i]) level = i + 1;
  const start = LEVELS[level - 1];
  const next = LEVELS[level] ?? null;
  const progress = next === null ? 1 : (points - start) / (next - start);
  return { level, start, next, progress, max: next === null };
}

/* ------------------------------------------------------------------------ */
/* Badges                                                                    */
/* ------------------------------------------------------------------------ */

interface Stats {
  count: number;
  enrich: number;
  precise: number;
  sharp: number;
  types: Set<string>;
  streets: Set<string>;
  bestStreak: number;
  early: number;
  water: number;
  published: number;
  invites: number;
  maxPerDay: number;
  perDay: Map<string, number>;
  days: Set<string>;
}

export interface BadgeDef {
  id: string;
  icon: string;
  colors: [string, string];
  target: number;
  value: (s: Stats) => number;
}

export const BADGES: BadgeDef[] = [
  { id: 'first', icon: '🎯', colors: ['#34c759', '#0a9d58'], target: 1, value: (s) => s.count },
  { id: 'ten', icon: '🔟', colors: ['#5ac8fa', '#007aff'], target: 10, value: (s) => s.count },
  { id: 'fifty', icon: '🏅', colors: ['#ffcc00', '#ff9500'], target: 50, value: (s) => s.count },
  { id: 'hundred', icon: '💯', colors: ['#ff6b6b', '#ff2d55'], target: 100, value: (s) => s.count },
  { id: 'fiveHundred', icon: '🚀', colors: ['#af52de', '#5856d6'], target: 500, value: (s) => s.count },
  { id: 'precise', icon: '📍', colors: ['#64d2ff', '#0a84ff'], target: 10, value: (s) => s.precise },
  { id: 'photographer', icon: '📸', colors: ['#ff9f0a', '#ff375f'], target: 10, value: (s) => s.sharp },
  { id: 'streak3', icon: '🔥', colors: ['#ff9500', '#ff3b30'], target: 3, value: (s) => s.bestStreak },
  { id: 'streak7', icon: '⚡️', colors: ['#ffd60a', '#ff9f0a'], target: 7, value: (s) => s.bestStreak },
  { id: 'earlyBird', icon: '🌅', colors: ['#ffb340', '#ff6482'], target: 1, value: (s) => s.early },
  { id: 'collector', icon: '🧩', colors: ['#30d158', '#30b0c7'], target: 4, value: (s) => s.types.size },
  { id: 'explorer', icon: '🧭', colors: ['#40c8e0', '#5e5ce6'], target: 10, value: (s) => s.streets.size },
  { id: 'whistleblower', icon: '💧', colors: ['#64d2ff', '#30b0c7'], target: 1, value: (s) => s.water },
  { id: 'enricher', icon: '✨', colors: ['#bf5af2', '#ff375f'], target: 5, value: (s) => s.enrich },
  { id: 'published', icon: '🌍', colors: ['#32d74b', '#007aff'], target: 1, value: (s) => s.published },
  { id: 'recruiter', icon: '🤝', colors: ['#5ac8fa', '#34c759'], target: 3, value: (s) => s.invites },
  { id: 'ambassador', icon: '📣', colors: ['#ff9f0a', '#ff2d55'], target: 10, value: (s) => s.invites },
  { id: 'marathon', icon: '🏃', colors: ['#ff453a', '#ff9f0a'], target: 20, value: (s) => s.maxPerDay },
];

function emptyStats(): Stats {
  return {
    count: 0,
    enrich: 0,
    precise: 0,
    sharp: 0,
    types: new Set(),
    streets: new Set(),
    bestStreak: 0,
    early: 0,
    water: 0,
    published: 0,
    invites: 0,
    maxPerDay: 0,
    perDay: new Map(),
    days: new Set(),
  };
}

function addRecord(s: Stats, r: DrainRecord) {
  s.count++;
  if (r.mode === 'enrich') s.enrich++;
  if (r.position.acc <= 3) s.precise++;
  if (r.photoSharpness >= 0.35) s.sharp++;
  if (r.details.type !== 'generic') s.types.add(r.details.type);
  if (r.address?.street) s.streets.add(`${r.address.citycode || ''}|${r.address.street.toLowerCase()}`);
  if (new Date(r.createdAt).getHours() < 8) s.early++;
  if (r.observations.standingWater === 'yes') s.water++;
  if (r.sync.osm.status === 'done') s.published++;
  const day = dayKey(r.createdAt);
  s.perDay.set(day, (s.perDay.get(day) || 0) + 1);
  s.maxPerDay = Math.max(s.maxPerDay, s.perDay.get(day)!);
  s.days.add(day);
  // Série la plus longue jusqu'à ce jour.
  let run = 0;
  const cursor = new Date(r.createdAt);
  while (s.days.has(dayKey(cursor.getTime()))) {
    run++;
    cursor.setDate(cursor.getDate() - 1);
  }
  s.bestStreak = Math.max(s.bestStreak, run);
}

export interface BadgeState {
  def: BadgeDef;
  value: number;
  unlockedAt?: number;
}

export interface Progress {
  points: number;
  level: ReturnType<typeof levelFor>;
  badges: BadgeState[];
  today: number;
  streak: number;
  count: number;
  published: number;
  pending: number;
  /** Invitations récompensées et points associés. */
  invites: number;
  invitePoints: number;
  /** Relevés pas encore publiés sur OSM, et points de publication correspondants « verrouillés ». */
  unsent: number;
  lockedPoints: number;
}

export function computeProgress(records: DrainRecord[], now = Date.now(), invites: InviteEntry[] = readInvites()): Progress {
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const stats = emptyStats();
  const unlocked = new Map<string, number>();
  let points = 0;
  for (const r of sorted) {
    addRecord(stats, r);
    points += r.points + (r.bonusAwarded ? PUBLISH_BONUS : 0);
    for (const b of BADGES) {
      if (!unlocked.has(b.id) && b.value(stats) >= b.target) unlocked.set(b.id, r.createdAt);
    }
  }
  // Invitations : points et badges (déblocage à la date de la N-ième invitation).
  stats.invites = invites.length;
  const invitePoints = invites.length * INVITE_POINTS;
  points += invitePoints;
  for (const b of BADGES) {
    if ((b.id === 'recruiter' || b.id === 'ambassador') && !unlocked.has(b.id) && b.value(stats) >= b.target) {
      unlocked.set(b.id, [...invites].sort((x, y) => x.ts - y.ts)[b.target - 1]?.ts ?? now);
    }
  }
  const today = dayKey(now);
  return {
    points,
    level: levelFor(points),
    badges: BADGES.map((def) => ({ def, value: Math.min(def.value(stats), def.target), unlockedAt: unlocked.get(def.id) })),
    today: stats.perDay.get(today) || 0,
    streak: streakDays(sorted.map((r) => r.createdAt), now),
    count: stats.count,
    published: stats.published,
    pending: sorted.filter((r) => needsSync(r)).length,
    invites: invites.length,
    invitePoints,
    unsent: sorted.filter((r) => r.sync.osm.status !== 'done' && r.sync.osm.status !== 'skipped').length,
    lockedPoints: sorted.filter((r) => r.sync.osm.status !== 'done' && r.sync.osm.status !== 'skipped').length * PUBLISH_BONUS,
  };
}

export function needsSync(r: DrainRecord): boolean {
  const p = r.sync.panoramax.status;
  const o = r.sync.osm.status;
  return !(p === 'done' || p === 'skipped') || !(o === 'done' || o === 'skipped') || (o === 'done' && p === 'done' && !r.sync.osm.photoTagged);
}

/** Badges débloqués entre deux états (pour la célébration après un relevé). */
export function newlyUnlocked(before: Progress, after: Progress): BadgeState[] {
  const had = new Set(before.badges.filter((b) => b.unlockedAt).map((b) => b.def.id));
  return after.badges.filter((b) => b.unlockedAt && !had.has(b.def.id));
}
