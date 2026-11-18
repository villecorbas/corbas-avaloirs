/**
 * Journal des invitations envoyées et points associés.
 *
 * Sans serveur, l'application ne peut pas savoir si une personne invitée a réellement
 * rejoint la chasse : les points récompensent donc l'ENVOI d'invitations (vérifiable sur le
 * téléphone), plafonné pour ne pas encourager le tapotage. Le bonus de bienvenue, lui,
 * récompense la personne invitée (lien porteur de ?ref=).
 * Module volontairement sans dépendance : utilisé par la gamification et l'écran d'invitation.
 */
const KEY = 'avaloirs.invites';
const LAST_KEY = 'avaloirs.invites.last';
const REF_KEY = 'avaloirs.invitedBy';

export const INVITE_POINTS = 5;
export const INVITE_DAILY_CAP = 3; // invitations récompensées par jour
export const INVITE_TOTAL_CAP = 20; // au total (100 points)
export const WELCOME_POINTS = 10;
const BURST_MS = 10_000; // deux clics en moins de 10 s = une seule invitation

export interface InviteEntry {
  ts: number;
  channel: string;
}

/** Invitations RÉCOMPENSÉES (les envois au-delà des plafonds ne sont pas conservés). */
export function readInvites(): InviteEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && Number.isFinite(e.ts)).slice(0, INVITE_TOTAL_CAP) : [];
  } catch {
    return [];
  }
}

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function invitesToday(list: InviteEntry[] = readInvites(), now = Date.now()): number {
  return list.filter((e) => e.ts >= dayStart(now)).length;
}

export interface InviteResult {
  counted: boolean;
  points: number;
  today: number;
  reason?: 'burst' | 'daily' | 'total';
}

/** Enregistre un envoi d'invitation et dit s'il rapporte des points. */
export function logInvite(channel: string, now = Date.now()): InviteResult {
  const list = readInvites();
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_KEY) || 0);
  } catch {
    /* ignore */
  }
  const today = invitesToday(list, now);
  let reason: InviteResult['reason'];
  if (now - last < BURST_MS) reason = 'burst';
  else if (list.length >= INVITE_TOTAL_CAP) reason = 'total';
  else if (today >= INVITE_DAILY_CAP) reason = 'daily';
  try {
    localStorage.setItem(LAST_KEY, String(now));
    if (!reason) localStorage.setItem(KEY, JSON.stringify([...list, { ts: now, channel }]));
  } catch {
    reason = reason || 'total'; // stockage indisponible : rien n'est conservé
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('avaloirs:invites'));
  return reason ? { counted: false, points: 0, today, reason } : { counted: true, points: INVITE_POINTS, today: today + 1 };
}

/** La personne est arrivée par un lien d'invitation. */
export function wasInvited(): boolean {
  try {
    return !!localStorage.getItem(REF_KEY);
  } catch {
    return false;
  }
}

const PROMPT_KEY = 'avaloirs.invitePrompt';

export function invitePromptShown(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markInvitePromptShown() {
  try {
    localStorage.setItem(PROMPT_KEY, '1');
  } catch {
    /* ignore */
  }
}
