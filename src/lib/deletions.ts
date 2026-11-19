import { APP_VERSION, getConfig } from './config';
import { deleteRecord, kvGet, kvSet, type DrainRecord } from './db';
import {
  buildDeleteChange,
  buildOsmChange,
  closeChangeset,
  createChangeset,
  fetchUser,
  findPublishedByPicture,
  getElement,
  getHistory,
  getOsmAuth,
  OsmError,
  uploadChange,
  type HistoryEntry,
  type OsmType,
} from './osm';
import { deletePicture, isPictureId, panoramaxReady, PanoramaxError } from './panoramax';
import type { Tags } from './taxonomy';

/**
 * Suppression d'un relevé publié : retrait d'OpenStreetMap puis de Panoramax.
 *
 * Garde-fous (la carte OSM est publique et partagée) :
 *  - l'objet n'est supprimé que si TOUT son historique est de la personne connectée ;
 *  - si quelqu'un d'autre l'a modifié, ou si le relevé complétait un avaloir créé par un autre,
 *    on retire seulement la référence à SA photo (jamais les données des autres) ;
 *  - hors ligne ou non connecté : la demande est conservée et exécutée plus tard.
 */

const KEY = 'deletions';
const MAX_ATTEMPTS = 20;
const ABSENT_CHECKS = 3;

export interface Deletion {
  id: string;
  createdAt: number;
  /** Le relevé avait créé l'objet OSM, ou seulement complété un objet existant. */
  mode: 'new' | 'enrich';
  osm?: { type: OsmType; id: number };
  at: { lat: number; lon: number };
  pictureId: string;
  /** Étapes restant à faire. */
  osmPending: boolean;
  pnxPending: boolean;
  /** L'objet OSM a peut-être été créé sans que l'appli l'ait su (réponse perdue). */
  uncertain?: boolean;
  attempts: number;
  /** Nombre de fois où la photo a été déclarée « introuvable » (pas encore classée, ou déjà supprimée). */
  absentCount?: number;
  error?: string;
}

/* ------------------------------ fonctions pures ------------------------------ */

/** Retire du jeu de tags toutes les références (panoramax, panoramax:1…) à CETTE photo. */
export function removePictureTags(tags: Tags, pictureId: string): Tags {
  const out: Tags = {};
  for (const [k, v] of Object.entries(tags)) {
    if (k === 'panoramax' || k.startsWith('panoramax:')) {
      const rest = String(v).split(';').map((x) => x.trim()).filter((x) => x && x !== pictureId);
      if (rest.length) out[k] = rest.join(';');
    } else out[k] = v;
  }
  return out;
}

/** L'objet peut-il être supprimé sans effacer le travail d'un autre ? (tout l'historique est le nôtre) */
export function isOnlyMine(history: HistoryEntry[], uid: number | undefined): boolean {
  return !!uid && history.length > 0 && history.every((h) => h.uid === uid);
}

/* ---------------------------------- file ---------------------------------- */

async function readQueue(): Promise<Deletion[]> {
  return (await kvGet<Deletion[]>(KEY)) || [];
}

async function writeQueue(list: Deletion[]) {
  await kvSet(KEY, list);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('avaloirs:deletions'));
}

export async function pendingDeletions(): Promise<Deletion[]> {
  return readQueue();
}

/**
 * Supprime le relevé du téléphone et met en file son retrait des services distants.
 * Renvoie true s'il reste un retrait distant à effectuer.
 */
export async function deleteRecordEverywhere(rec: DrainRecord): Promise<boolean> {
  const osmRef = rec.sync.osm.osmId
    ? { type: (rec.sync.osm.osmType ?? 'node') as OsmType, id: rec.sync.osm.osmId }
    : rec.mode === 'enrich' && rec.osmTarget && rec.sync.osm.status === 'done'
      ? { type: (rec.osmTarget.type ?? 'node') as OsmType, id: rec.osmTarget.id }
      : undefined;
  const pnx = rec.sync.panoramax;
  const pnxTouched = pnx.status === 'done' || (pnx.status === 'error' && pnx.attempts > 0) || !!rec.sync.osm.uncertain;
  const center = rec.line ? { lat: (rec.line.a.lat + rec.line.b.lat) / 2, lon: (rec.line.a.lon + rec.line.b.lon) / 2 } : rec.position;

  const job: Deletion = {
    id: rec.id,
    createdAt: Date.now(),
    mode: rec.mode,
    osm: osmRef,
    at: { lat: center.lat, lon: center.lon },
    pictureId: pnx.pictureId,
    osmPending: !!osmRef || !!rec.sync.osm.uncertain,
    pnxPending: pnxTouched,
    uncertain: rec.sync.osm.uncertain,
    attempts: 0,
  };
  await deleteRecord(rec.id);
  if (!job.osmPending && !job.pnxPending) return false;
  await writeQueue([...(await readQueue()), job]);
  return true;
}

/* --------------------------------- exécution -------------------------------- */

let running = false;

function describeError(e: unknown): string {
  if (e instanceof OsmError) return `osm_${e.status}`;
  if (e instanceof PanoramaxError) return e.message || `panoramax_${e.status}`;
  return e instanceof TypeError ? 'network' : (e as Error)?.message || 'unknown';
}

/** Une erreur qui ne vient pas de la donnée : on réessaiera sans compter de tentative. */
function transient(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const s = e instanceof OsmError || e instanceof PanoramaxError ? e.status : 0;
  return s === 0 || s === 401 || s === 403 || s === 408 || s === 429 || s >= 500;
}

async function removeFromOsm(job: Deletion): Promise<void> {
  const auth = getOsmAuth()!;
  let target = job.osm;
  if (!target) {
    // Envoi interrompu sans réponse : l'objet existe peut-être. On le cherche par l'identifiant de sa photo.
    const found = isPictureId(job.pictureId) ? await findPublishedByPicture(job.at, job.pictureId) : null;
    if (!found) return;
    target = found;
  }
  let el;
  try {
    el = await getElement(target.type, target.id);
  } catch (e) {
    if (e instanceof OsmError && (e.status === 404 || e.status === 410)) return; // déjà supprimé
    throw e;
  }
  const history = await getHistory(target.type, target.id);
  // Identité de la personne connectée : sans elle, on ne supprime rien (on retire seulement la photo).
  const uid = auth.user?.id ?? (await fetchUser(auth.token).catch(() => undefined))?.id;
  const mine = job.mode === 'new' && isOnlyMine(history, uid);
  const tags = removePictureTags(el.tags, job.pictureId);
  // Rien à retirer (la référence à notre photo n'y est plus) : inutile d'ouvrir un jeu de modifications vide.
  if (!mine && JSON.stringify(tags) === JSON.stringify(el.tags)) return;
  const csId = await createChangeset({
    created_by: `ChasseAuxAvaloirs/${APP_VERSION}`,
    comment: mine
      ? "Suppression par son auteur d'un relevé d'avaloir (erreur ou doublon) " + getConfig().openstreetmap.hashtags.join(' ')
      : "Retrait de ma photo d'un avaloir " + getConfig().openstreetmap.hashtags.join(' '),
    hashtags: getConfig().openstreetmap.hashtags.join(';'),
    source: 'survey',
  });
  try {
    if (mine) {
      const items = [{ type: target.type, id: target.id, version: el.version, lat: el.lat, lon: el.lon, nodes: el.nodes }];
      // Les nœuds d'un chemin créé par nous : supprimés avec lui s'ils ne servent à rien d'autre.
      if (target.type === 'way') {
        for (const nid of el.nodes || []) {
          try {
            const n = await getElement('node', nid);
            if (!Object.keys(n.tags).length) items.push({ type: 'node', id: nid, version: n.version, lat: n.lat, lon: n.lon, nodes: undefined });
          } catch (e) {
            if (!(e instanceof OsmError && (e.status === 404 || e.status === 410))) throw e;
          }
        }
      }
      await uploadChange(csId, buildDeleteChange(items, csId));
    } else if (JSON.stringify(tags) !== JSON.stringify(el.tags)) {
      const { xml } = buildOsmChange([{ kind: 'modify', ref: 'x', element: { ...el, tags } }], csId);
      await uploadChange(csId, xml);
    }
  } finally {
    await closeChangeset(csId).catch(() => undefined);
  }
}

/** Traite la file : OpenStreetMap d'abord (pour ne pas laisser un lien vers une photo supprimée), puis Panoramax. */
export async function processDeletions(): Promise<{ remaining: number }> {
  if (running) return { remaining: (await readQueue()).length };
  running = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { remaining: (await readQueue()).length };
    const queue = await readQueue();
    const next: Deletion[] = [];
    for (const job of queue) {
      let j = { ...job };
      try {
        if (j.osmPending) {
          if (getOsmAuth()) {
            await removeFromOsm(j);
            j.osmPending = false;
            j.error = undefined;
          }
        }
        // La photo n'est retirée qu'une fois l'objet OSM réglé.
        if (!j.osmPending && j.pnxPending && panoramaxReady()) {
          const r = await deletePicture(j.pictureId);
          if (r === 'deleted') j.pnxPending = false;
          else {
            // « Introuvable » : la photo n'est peut-être pas encore classée par Panoramax. On vérifie
            // trois fois (environ 6 minutes) avant de conclure qu'elle n'existe plus ou n'a jamais existé.
            j.absentCount = (j.absentCount || 0) + 1;
            if (j.absentCount >= ABSENT_CHECKS) j.pnxPending = false;
          }
          j.error = undefined;
        }
      } catch (e) {
        j.error = describeError(e);
        if (!transient(e)) j.attempts++;
      }
      if ((j.osmPending || j.pnxPending) && j.attempts < MAX_ATTEMPTS) next.push(j);
    }
    await writeQueue(next);
    return { remaining: next.length };
  } finally {
    running = false;
  }
}
