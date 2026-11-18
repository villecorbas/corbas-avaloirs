import { APP_VERSION, appBaseUrl, getConfig, osmUrls } from './config';
import { osmCoord } from './geo';
import type { Tags } from './taxonomy';

/* ------------------------------------------------------------------------ */
/* Authentification OAuth 2 (code d'autorisation + PKCE, client public)       */
/* ------------------------------------------------------------------------ */

const TOKEN_KEY = 'avaloirs.osmAuth';
const PENDING_KEY = 'avaloirs.osmPending';
const SCOPES = 'read_prefs write_api';

export interface OsmAuth {
  token: string;
  env: 'production' | 'dev';
  user?: { id: number; name: string; img?: string; changesets?: number };
}

interface Pending {
  verifier: string;
  state: string;
  redirectUri: string;
  env: 'production' | 'dev';
  createdAt: number;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 48): string {
  return b64url(crypto.getRandomValues(new Uint8Array(len)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function redirectUri(): string {
  return getConfig().openstreetmap.redirectUri || appBaseUrl();
}

export function getOsmAuth(): OsmAuth | null {
  try {
    const a = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') as OsmAuth | null;
    if (a && a.env === getConfig().openstreetmap.environment) return a;
  } catch {
    /* ignore */
  }
  return null;
}

function setOsmAuth(a: OsmAuth | null) {
  try {
    if (a) localStorage.setItem(TOKEN_KEY, JSON.stringify(a));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Stockage refusé (navigation privée, quota) : la session ne pourra pas être conservée.
    if (a) throw new Error('storage_unavailable');
  }
  window.dispatchEvent(new Event('avaloirs:auth'));
}

export function osmConfigured(): boolean {
  return !!osmUrls().clientId;
}

/**
 * Redirige vers openstreetmap.org (même fenêtre : indispensable pour les PWA iOS).
 * Avec `signup`, ouvre la page d'inscription : le site OSM y conserve l'adresse
 * d'autorisation (paramètre `referer`) et, une fois le compte créé et l'e-mail
 * confirmé, sa page d'accueil propose « Continuer l'autorisation », qui ramène
 * directement dans l'application, connectée.
 */
export async function startOsmLogin(opts: { signup?: boolean } = {}) {
  const { web, clientId } = osmUrls();
  if (!clientId) throw new Error('osm_not_configured');
  const pending: Pending = {
    verifier: randomString(48),
    state: randomString(16),
    redirectUri: redirectUri(),
    env: getConfig().openstreetmap.environment,
    createdAt: Date.now(),
  };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new Error('storage_unavailable');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: pending.redirectUri,
    scope: SCOPES,
    state: pending.state,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: 'S256',
  });
  const authorizePath = `/oauth2/authorize?${params}`;
  window.location.assign(
    opts.signup ? `${web}/user/new?${new URLSearchParams({ referer: authorizePath })}` : `${web}${authorizePath}`,
  );
}

/** Page d'inscription simple (quand l'application n'est pas encore enregistrée auprès d'OSM). */
export function osmSignupUrl(): string {
  return `${osmUrls().web}/user/new`;
}

export function hasPendingLogin(): boolean {
  return !!localStorage.getItem(PENDING_KEY);
}

export type CallbackResult =
  | { kind: 'none' }
  | { kind: 'success'; auth: OsmAuth }
  | { kind: 'orphan'; code: string } // Retour dans un autre contexte (ex. navigateur in-app iOS)
  | { kind: 'error'; message: string };

/** À appeler au démarrage : termine la connexion si l'URL contient ?code=… */
export async function handleOsmCallback(): Promise<CallbackResult> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return { kind: 'none' };

  // Nettoie l'URL immédiatement.
  ['code', 'state', 'error', 'error_description'].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);

  if (error) {
    localStorage.removeItem(PENDING_KEY);
    return { kind: 'error', message: error };
  }
  const pending = readPending();
  if (!pending || pending.state !== state) return { kind: 'orphan', code: code! };
  try {
    const auth = await exchangeCode(code!, pending);
    return { kind: 'success', auth };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}

const PENDING_TTL = 30 * 60 * 1000;

function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null') as Pending | null;
    // Une demande d'autorisation abandonnée ne reste pas valable indéfiniment.
    if (p && Date.now() - p.createdAt > PENDING_TTL) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** Saisie manuelle du code (secours si le retour OAuth s'est ouvert hors de l'appli). */
export async function completeOsmLoginWithCode(code: string): Promise<OsmAuth> {
  const pending = readPending();
  if (!pending) throw new Error('no_pending_login');
  return exchangeCode(code.trim(), pending);
}

async function exchangeCode(code: string, pending: Pending): Promise<OsmAuth> {
  const { web, clientId } = osmUrls();
  const res = await fetch(`${web}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: clientId,
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) throw new Error(`token_${res.status}`);
  const json = await res.json();
  localStorage.removeItem(PENDING_KEY);
  const auth: OsmAuth = { token: json.access_token, env: pending.env };
  auth.user = await fetchUser(auth.token).catch(() => undefined);
  setOsmAuth(auth);
  return auth;
}

export async function fetchUser(token: string) {
  const { api } = osmUrls();
  const res = await fetch(`${api}/api/0.6/user/details.json`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new OsmError(res.status, await res.text());
  const { user } = await res.json();
  return { id: user.id, name: user.display_name, img: user.img?.href, changesets: user.changesets?.count };
}

export async function refreshOsmUser() {
  const auth = getOsmAuth();
  if (!auth) return null;
  try {
    auth.user = await fetchUser(auth.token);
    setOsmAuth(auth);
  } catch (e) {
    if (e instanceof OsmError && e.status === 401) setOsmAuth(null);
  }
  return getOsmAuth();
}

export function osmLogout() {
  const auth = getOsmAuth();
  setOsmAuth(null);
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  // Révoque le jeton côté serveur (au mieux : la déconnexion locale est déjà effective).
  if (auth) {
    const { web, clientId } = osmUrls();
    void fetch(`${web}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: auth.token, token_type_hint: 'access_token', client_id: clientId }),
    }).catch(() => undefined);
  }
}

/**
 * Recherche, dans OSM même, un objet déjà publié avec cette photo près d'un point.
 * Évite les doublons quand un envoi a abouti mais que sa réponse s'est perdue.
 */
export async function findPublishedByPicture(
  at: { lat: number; lon: number },
  pictureId: string,
): Promise<{ type: OsmType; id: number } | null> {
  const d = 0.0006; // ≈ 65 m
  const bbox = [at.lon - d, at.lat - d, at.lon + d, at.lat + d].map((n) => n.toFixed(6)).join(',');
  try {
    const res = await fetch(`${osmUrls().api}/api/0.6/map.json?bbox=${bbox}`);
    if (!res.ok) return null;
    const json = await res.json();
    for (const e of json.elements || []) {
      if ((e.type === 'node' || e.type === 'way') && e.tags && Object.entries(e.tags).some(([k, v]) => k.startsWith('panoramax') && String(v).split(';').includes(pictureId))) {
        return { type: e.type, id: e.id };
      }
    }
  } catch {
    /* indisponible : on laisse la création se poursuivre */
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* API 0.6                                                                    */
/* ------------------------------------------------------------------------ */

export class OsmError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`OSM ${status}: ${body.slice(0, 200)}`);
  }
}

async function osmFetch(path: string, init: RequestInit = {}): Promise<string> {
  const auth = getOsmAuth();
  if (!auth) throw new OsmError(401, 'not_logged_in');
  const { api } = osmUrls();
  const res = await fetch(`${api}/api/0.6${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth.token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (res.status === 401) setOsmAuth(null);
  if (!res.ok) throw new OsmError(res.status, text);
  return text;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function tagsXml(tags: Tags, indent = '    '): string {
  return Object.entries(tags)
    .filter(([k, v]) => k && v !== undefined && v !== '')
    .map(([k, v]) => `${indent}<tag k="${escapeXml(k)}" v="${escapeXml(String(v).slice(0, 255))}"/>`)
    .join('\n');
}

export function changesetTags(opts: { count: number; withPhotos: boolean; usedOrtho: boolean; lang: string }): Tags {
  const cfg = getConfig();
  const hashtags = cfg.openstreetmap.hashtags;
  const comment =
    opts.lang === 'en'
      ? `Participatory survey of storm drains (tiger mosquito control) ${hashtags.join(' ')}`
      : `Inventaire participatif des avaloirs de voirie (lutte contre le moustique tigre) ${hashtags.join(' ')}`;
  const tags: Tags = {
    created_by: `ChasseAuxAvaloirs/${APP_VERSION}`,
    comment: comment.trim(),
    hashtags: hashtags.join(';'),
    source: opts.withPhotos ? 'survey;Panoramax' : 'survey',
    locale: opts.lang,
  };
  if (opts.usedOrtho) tags.imagery_used = 'BD Ortho IGN';
  return tags;
}

export async function createChangeset(tags: Tags): Promise<number> {
  const body = `<osm>\n  <changeset>\n${tagsXml(tags)}\n  </changeset>\n</osm>`;
  const id = await osmFetch('/changeset/create', { method: 'PUT', headers: { 'Content-Type': 'text/xml' }, body });
  return Number(id.trim());
}

export async function closeChangeset(id: number) {
  await osmFetch(`/changeset/${id}/close`, { method: 'PUT' });
}

export type OsmType = 'node' | 'way';

/** Élément OSM existant (nœud ou chemin), avec les tags FINAUX souhaités après modification. */
export interface OsmElement {
  type: OsmType;
  id: number;
  version: number;
  tags: Tags;
  lat?: number; // nœud
  lon?: number; // nœud
  nodes?: number[]; // chemin
}

export async function getElement(type: OsmType, id: number): Promise<OsmElement> {
  const json = JSON.parse(await osmFetch(`/${type}/${id}.json`));
  const el = json.elements.find((e: { type: string; id: number }) => e.type === type && e.id === id) || json.elements[0];
  return { type, id: el.id, version: el.version, tags: el.tags || {}, lat: el.lat, lon: el.lon, nodes: el.nodes };
}

export interface CreateNodeOp {
  kind: 'create';
  ref: string; // identifiant local de l'enregistrement
  lat: number;
  lon: number;
  tags: Tags;
}
export interface CreateWayOp {
  kind: 'createWay';
  ref: string;
  points: { lat: number; lon: number }[];
  tags: Tags;
}
export interface ModifyOp {
  kind: 'modify';
  ref: string;
  element: OsmElement;
}
export type ChangeOp = CreateNodeOp | CreateWayOp | ModifyOp;

/** Clé de la table de correspondance : un même identifiant peut désigner un nœud et un chemin. */
export const refKey = (type: OsmType, id: number) => `${type}:${id}`;

/** Construit le document osmChange ; renvoie aussi la table « type:id » → ref. */
export function buildOsmChange(ops: ChangeOp[], changesetId: number) {
  const refs = new Map<string, string>();
  const creates: string[] = [];
  const modifies: string[] = [];
  let nextNode = -1;
  let nextWay = -1;
  const nodeXml = (id: number, lat: number, lon: number, tags: Tags, version?: number) => {
    const head = `  <node id="${id}" lat="${osmCoord(lat)}" lon="${osmCoord(lon)}"${version !== undefined ? ` version="${version}"` : ''} changeset="${changesetId}"`;
    const body = tagsXml(tags);
    return body ? `${head}>\n${body}\n  </node>` : `${head}/>`;
  };
  const wayXml = (id: number, nodes: number[], tags: Tags, version?: number) =>
    `  <way id="${id}"${version !== undefined ? ` version="${version}"` : ''} changeset="${changesetId}">\n` +
    nodes.map((n) => `    <nd ref="${n}"/>`).join('\n') +
    `\n${tagsXml(tags)}\n  </way>`;

  for (const op of ops) {
    if (op.kind === 'create') {
      const id = nextNode--;
      refs.set(refKey('node', id), op.ref);
      creates.push(nodeXml(id, op.lat, op.lon, op.tags));
    } else if (op.kind === 'createWay') {
      // Les nœuds du chemin, sans tags, sont créés avant le chemin qui les référence.
      const ids = op.points.map((p) => {
        const id = nextNode--;
        creates.push(nodeXml(id, p.lat, p.lon, {}));
        return id;
      });
      const wayId = nextWay--;
      refs.set(refKey('way', wayId), op.ref);
      creates.push(wayXml(wayId, ids, op.tags));
    } else {
      const el = op.element;
      refs.set(refKey(el.type, el.id), op.ref);
      modifies.push(el.type === 'node' ? nodeXml(el.id, el.lat!, el.lon!, el.tags, el.version) : wayXml(el.id, el.nodes || [], el.tags, el.version));
    }
  }
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', `<osmChange version="0.6" generator="ChasseAuxAvaloirs/${APP_VERSION}">`];
  if (creates.length) parts.push('<create>', ...creates, '</create>');
  if (modifies.length) parts.push('<modify>', ...modifies, '</modify>');
  parts.push('</osmChange>');
  return { xml: parts.join('\n'), refs };
}

export interface DiffEntry {
  type: OsmType | 'relation';
  oldId: number;
  newId: number;
  newVersion: number;
}

export function parseDiffResult(xml: string): DiffEntry[] {
  const out: DiffEntry[] = [];
  const re = /<(node|way|relation)\s+([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (attrs.old_id && attrs.new_id) {
      out.push({ type: m[1] as DiffEntry['type'], oldId: Number(attrs.old_id), newId: Number(attrs.new_id), newVersion: Number(attrs.new_version) });
    }
  }
  return out;
}

export async function uploadChange(changesetId: number, xml: string): Promise<DiffEntry[]> {
  const res = await osmFetch(`/changeset/${changesetId}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  });
  return parseDiffResult(res);
}

export function osmElementUrl(type: OsmType, id: number): string {
  return `${osmUrls().web}/${type}/${id}`;
}
