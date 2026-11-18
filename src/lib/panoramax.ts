import { getConfig } from './config';
import type { SemanticTag } from './taxonomy';

/**
 * Connexion Panoramax par « jeton à réclamer » (méthode utilisée par l'outil
 * officiel en ligne de commande) : l'appli génère un jeton anonyme, l'utilisateur
 * ouvre le lien de réclamation et se connecte (avec son compte OpenStreetMap sur
 * l'instance OSM-FR). Fonctionne aussi dans une PWA iOS, car aucune donnée n'a
 * besoin de revenir dans l'appli : on interroge simplement /api/users/me.
 */

const KEY = 'avaloirs.panoramax';

export interface PanoramaxAuth {
  instance: string;
  tokenId: string;
  token: string;
  claimUrl: string;
  user?: { id: string; name: string; tosAccepted?: boolean };
}

export class PanoramaxError extends Error {
  constructor(
    public status: number,
    message: string,
    public permanent = false,
  ) {
    super(message);
  }
}

function instance(): string {
  return getConfig().panoramax.instance.replace(/\/+$/, '');
}

export function getPanoramaxAuth(): PanoramaxAuth | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || 'null') as PanoramaxAuth | null;
    if (a && a.instance === instance()) return a;
  } catch {
    /* ignore */
  }
  return null;
}

function setAuth(a: PanoramaxAuth | null) {
  if (a) localStorage.setItem(KEY, JSON.stringify(a));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('avaloirs:auth'));
}

export function panoramaxReady(): boolean {
  const a = getPanoramaxAuth();
  return !!a?.user && a.user.tosAccepted !== false;
}

export async function startPanoramaxLogin(): Promise<PanoramaxAuth> {
  const existing = getPanoramaxAuth();
  if (existing && !existing.user) return existing; // réutilise le jeton en attente
  const res = await fetch(
    `${instance()}/api/auth/tokens/generate?description=${encodeURIComponent('Chasse aux avaloirs')}`,
    { method: 'POST' },
  );
  if (!res.ok) throw new PanoramaxError(res.status, 'token_generate_failed');
  const json = await res.json();
  const claim = (json.links || []).find((l: { rel: string }) => l.rel === 'claim');
  const auth: PanoramaxAuth = {
    instance: instance(),
    tokenId: json.id,
    token: json.jwt_token,
    claimUrl: claim?.href || `${instance()}/api/auth/tokens/${json.id}/claim`,
  };
  setAuth(auth);
  return auth;
}

/** Vérifie si le jeton a été réclamé ; renvoie l'utilisateur, ou null s'il est en attente. */
export async function checkPanoramaxUser(): Promise<PanoramaxAuth | null> {
  const auth = getPanoramaxAuth();
  if (!auth) return null;
  const res = await fetch(`${auth.instance}/api/users/me`, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (res.status === 401 || res.status === 403) {
    if (auth.user) {
      // Jeton révoqué côté serveur.
      setAuth(null);
      return null;
    }
    return auth;
  }
  if (!res.ok) return auth;
  const me = await res.json();
  auth.user = { id: me.id, name: me.name, tosAccepted: me.tos_accepted ?? true };
  setAuth(auth);
  return auth;
}

export async function acceptPanoramaxTos() {
  const auth = getPanoramaxAuth();
  if (!auth) return;
  const res = await fetch(`${auth.instance}/api/users/me/accept_tos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!res.ok) throw new PanoramaxError(res.status, 'tos_failed');
  await checkPanoramaxUser();
}

export function panoramaxLogout() {
  setAuth(null);
}

async function pnxFetch(path: string, init: RequestInit = {}) {
  const auth = getPanoramaxAuth();
  if (!auth) throw new PanoramaxError(401, 'not_logged_in');
  const res = await fetch(`${auth.instance}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth.token}`, ...(init.headers || {}) },
  });
  return res;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.message || j.details?.[0]?.error || JSON.stringify(j).slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function createUploadSet(title: string, estimated: number): Promise<string> {
  const res = await pnxFetch('/upload_sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      estimated_nb_files: estimated,
      // Deux photos du même avaloir (prises par deux personnes) ne doivent pas être rejetées.
      no_deduplication: true,
      semantics: getConfig().openstreetmap.hashtags.map((h) => ({ key: 'hashtag', value: h.replace(/^#/, '') })),
    }),
  });
  if (!res.ok) throw new PanoramaxError(res.status, await errorMessage(res));
  return (await res.json()).id;
}

export interface PictureMeta {
  pictureId: string;
  capturedAt: number;
  lat: number;
  lon: number;
  acc?: number;
  heading?: number;
  semantics: SemanticTag[];
}

function rational(n: number, den = 100) {
  return `${Math.round(n * den)}/${den}`;
}

/** Envoie une photo. Idempotent : l'identifiant est pré-attribué, un 409 signifie « déjà envoyée ». */
export async function uploadPicture(uploadSetId: string, blob: Blob, meta: PictureMeta): Promise<string> {
  const form = new FormData();
  form.append('picture_id', meta.pictureId);
  form.append('override_capture_time', new Date(meta.capturedAt).toISOString());
  form.append('override_latitude', meta.lat.toFixed(8));
  form.append('override_longitude', meta.lon.toFixed(8));
  if (meta.heading !== undefined && Number.isFinite(meta.heading)) {
    form.append('override_Exif.GPSInfo.GPSImgDirectionRef', 'T');
    form.append('override_Exif.GPSInfo.GPSImgDirection', rational(((meta.heading % 360) + 360) % 360));
  }
  if (meta.acc !== undefined) form.append('override_Exif.GPSInfo.GPSHPositioningError', rational(meta.acc));
  form.append('semantics', new Blob([JSON.stringify(meta.semantics)], { type: 'application/json' }));
  form.append('file', blob, `avaloir-${meta.pictureId}.jpg`);

  const res = await pnxFetch(`/upload_sets/${uploadSetId}/files`, { method: 'POST', body: form });
  if (res.status === 409) return meta.pictureId;
  if (!res.ok) {
    const permanent = res.status === 400 || res.status === 413 || res.status === 415;
    throw new PanoramaxError(res.status, await errorMessage(res), permanent);
  }
  const json = await res.json();
  if (json.rejected && json.rejected.severity === 'error') {
    throw new PanoramaxError(400, json.rejected.message || json.rejected.reason, true);
  }
  return json.picture_id || meta.pictureId;
}

export async function completeUploadSet(id: string) {
  const res = await pnxFetch(`/upload_sets/${id}/complete`, { method: 'POST' });
  if (!res.ok && res.status !== 409) throw new PanoramaxError(res.status, await errorMessage(res));
}

/** Lien vers la photo sur l'instance d'envoi (disponible avant moissonnage par le méta-catalogue). */
export function pictureViewerUrl(pictureId: string): string {
  return `${instance()}/#focus=pic&pic=${pictureId}`;
}

export function pictureThumbUrl(pictureId: string): string {
  return `${instance()}/api/pictures/${pictureId}/thumb.jpg`;
}
