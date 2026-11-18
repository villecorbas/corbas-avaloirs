import { useSyncExternalStore } from 'react';
import { getConfig } from './config';
import { allRecords, getPhoto, kvGet, kvSet, updateRecord, type DrainRecord } from './db';
import { dayKey, needsSync } from './gamification';
import { getLang } from '../i18n';
import {
  buildOsmChange,
  changesetTags,
  closeChangeset,
  createChangeset,
  getElement,
  refKey,
  getOsmAuth,
  OsmError,
  uploadChange,
  type ChangeOp,
  type OsmType,
} from './osm';
import {
  completeUploadSet,
  createUploadSet,
  panoramaxReady,
  PanoramaxError,
  uploadPicture,
} from './panoramax';
import { isOsmMappable, mergeIntoExisting, osmGeometry, osmTags, panoramaxSemantics } from './taxonomy';
import { midpoint } from './geo';

export interface SyncState {
  running: boolean;
  phase: 'idle' | 'panoramax' | 'osm';
  done: number;
  total: number;
  lastRun?: number;
  lastError?: string;
  lastPublished?: number;
}

let state: SyncState = { running: false, phase: 'idle', done: 0, total: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

const MAX_AUTO_ATTEMPTS = 5;
const BATCH = 100;
/**
 * Délai pendant lequel la publication OSM attend la photo si Panoramax n'est pas
 * (encore) connecté : évite de créer le nœud puis de le modifier pour ajouter la photo.
 */
const PHOTO_GRACE_MS = 24 * 3600 * 1000;

function retryable(r: DrainRecord, step: 'panoramax' | 'osm', manual: boolean) {
  const s = r.sync[step];
  if (s.status === 'done' || s.status === 'skipped') return false;
  return manual || s.attempts < MAX_AUTO_ATTEMPTS;
}

function describe(e: unknown): string {
  if (e instanceof OsmError) {
    if (e.status === 429) return 'osm_rate_limited';
    if (e.status === 401) return 'osm_auth';
    return `osm_${e.status}`;
  }
  if (e instanceof PanoramaxError) {
    if (e.status === 401 || e.status === 403) return 'panoramax_auth';
    return e.message || `panoramax_${e.status}`;
  }
  if (e instanceof TypeError) return 'network';
  return (e as Error)?.message || 'unknown';
}

/* ------------------------------ Panoramax ------------------------------ */

async function syncPanoramax(records: DrainRecord[], manual: boolean) {
  const queue = records.filter((r) => retryable(r, 'panoramax', manual));
  if (!queue.length) return;
  set({ phase: 'panoramax', done: 0, total: queue.length });

  const cfg = getConfig();
  let uploadSetId = (await kvGet<{ id: string; at: number }>('pnxUploadSet'))?.id;
  const newSet = async () => {
    const place = cfg.commune.name || queue[0].address?.city || '';
    const title = `${cfg.campaignName}${place ? ` – ${place}` : ''} – ${new Date().toLocaleDateString(getLang())}`;
    uploadSetId = await createUploadSet(title, queue.length);
    await kvSet('pnxUploadSet', { id: uploadSetId, at: Date.now() });
  };
  if (!uploadSetId) await newSet();

  let done = 0;
  for (const r of queue) {
    const photo = await getPhoto(r.id);
    if (!photo) {
      await updateRecord(r.id, (x) => {
        x.sync.panoramax.status = 'skipped';
        x.sync.panoramax.error = 'no_photo';
      });
      continue;
    }
    const pos = r.photoPosition && r.photoPosition.acc <= 25 ? r.photoPosition : r.position;
    const meta = {
      pictureId: r.sync.panoramax.pictureId,
      capturedAt: r.photoTakenAt,
      lat: pos.lat,
      lon: pos.lon,
      acc: pos.acc,
      heading: r.photoPosition?.heading,
      semantics: panoramaxSemantics(r.details, r.observations, cfg.openstreetmap.hashtags),
    };
    try {
      let pictureId: string;
      try {
        pictureId = await uploadPicture(uploadSetId!, photo.blob, meta);
      } catch (e) {
        // Lot d'envoi expiré ou déjà clôturé : on en ouvre un nouveau et on réessaie.
        if (e instanceof PanoramaxError && (e.status === 404 || e.status === 410)) {
          await newSet();
          pictureId = await uploadPicture(uploadSetId!, photo.blob, meta);
        } else throw e;
      }
      await updateRecord(r.id, (x) => {
        x.sync.panoramax = { ...x.sync.panoramax, status: 'done', pictureId, uploadSetId, error: undefined };
      });
    } catch (e) {
      const permanent = e instanceof PanoramaxError && e.permanent;
      await updateRecord(r.id, (x) => {
        x.sync.panoramax.status = permanent ? 'skipped' : 'error';
        x.sync.panoramax.error = describe(e);
        x.sync.panoramax.attempts++;
      });
      if (e instanceof PanoramaxError && (e.status === 401 || e.status === 403)) {
        set({ lastError: 'panoramax_auth' });
        break;
      }
      if (e instanceof TypeError) {
        set({ lastError: 'network' });
        break;
      }
    }
    set({ done: ++done });
  }
  try {
    await completeUploadSet(uploadSetId!);
  } catch {
    /* sera clôturé automatiquement côté serveur */
  }
  await kvSet('pnxUploadSet', null);
}

/* -------------------------------- OSM ---------------------------------- */

interface PlannedOp {
  op: ChangeOp;
  records: { id: string; photoTagged: boolean }[];
}

/** Opération de création adaptée au type : nœud, ou chemin pour un caniveau tracé. */
export function createOpFor(r: DrainRecord, photoId?: string): ChangeOp | null {
  const geom = osmGeometry(r.details.type);
  if (!geom) return null;
  if (geom === 'way') {
    if (r.line) return { kind: 'createWay', ref: '', points: [r.line.a, r.line.b], tags: osmTags(r.details, photoId) };
    // Sans tracé (cas improbable), on se rabat sur un point aux tags documentés.
    return { kind: 'create', ref: '', lat: r.position.lat, lon: r.position.lon, tags: osmTags(r.details, photoId, 'node') };
  }
  const p = r.details.type === 'channel' && r.line ? midpoint(r.line.a, r.line.b) : r.position;
  return { kind: 'create', ref: '', lat: p.lat, lon: p.lon, tags: osmTags(r.details, photoId) };
}

async function planOsm(records: DrainRecord[], manual: boolean): Promise<PlannedOp[]> {
  const pnxConnected = panoramaxReady();
  const planned: PlannedOp[] = [];
  const modifies = new Map<string, PlannedOp>();
  const today = dayKey(Date.now());

  const addModify = async (type: OsmType, id: number, rec: DrainRecord, withDetails: boolean, photoId?: string) => {
    const key = refKey(type, id);
    let p = modifies.get(key);
    if (!p) {
      const element = await getElement(type, id);
      p = { op: { kind: 'modify', ref: '', element }, records: [] };
      modifies.set(key, p);
      planned.push(p);
    }
    const element = (p.op as { element: { tags: Record<string, string> } }).element;
    element.tags = mergeIntoExisting(element.tags, withDetails ? rec.details : null, photoId, withDetails ? today : undefined);
    p.records.push({ id: rec.id, photoTagged: !!photoId });
  };

  for (const r of records) {
    if (planned.length >= BATCH) break;
    if (!isOsmMappable(r.details.type)) {
      if (r.sync.osm.status !== 'skipped') {
        await updateRecord(r.id, (x) => {
          x.sync.osm.status = 'skipped';
          x.sync.osm.error = 'not_mappable';
        });
      }
      continue;
    }
    const pnx = r.sync.panoramax;
    const photoId = pnx.status === 'done' ? pnx.pictureId : undefined;
    const photoSettled = pnx.status === 'done' || pnx.status === 'skipped';
    const waitPhoto = !photoSettled && (pnxConnected || Date.now() - r.createdAt < PHOTO_GRACE_MS);

    try {
      if (r.sync.osm.status !== 'done') {
        if (!retryable(r, 'osm', manual) || waitPhoto) continue;
        const create = createOpFor(r, photoId);
        if (r.mode === 'enrich' && r.osmTarget) {
          try {
            await addModify(r.osmTarget.type ?? 'node', r.osmTarget.id, r, true, photoId);
          } catch (e) {
            // L'objet a été supprimé entre-temps : on le recrée.
            if (e instanceof OsmError && e.status === 410 && create) planned.push({ op: create, records: [{ id: r.id, photoTagged: !!photoId }] });
            else throw e;
          }
        } else if (create) {
          planned.push({ op: create, records: [{ id: r.id, photoTagged: !!photoId }] });
        }
      } else if (photoId && !r.sync.osm.photoTagged && r.sync.osm.osmId) {
        // Objet publié avant la photo : on ajoute le lien Panoramax.
        await addModify(r.sync.osm.osmType ?? 'node', r.sync.osm.osmId, r, false, photoId);
      }
    } catch (e) {
      await updateRecord(r.id, (x) => {
        x.sync.osm.status = 'error';
        x.sync.osm.error = describe(e);
        x.sync.osm.attempts++;
      });
    }
  }
  return planned;
}

async function syncOsm(manual: boolean) {
  const records = (await allRecords()).filter(needsSync).reverse();
  let planned = await planOsm(records, manual);
  if (!planned.length) return;
  set({ phase: 'osm', done: 0, total: planned.length });

  const byId = new Map(records.map((r) => [r.id, r]));
  const usedOrtho = planned.some((p) => p.records.some((x) => byId.get(x.id)?.position.adjusted || !!byId.get(x.id)?.line));
  const withPhotos = planned.some((p) => p.records.some((x) => x.photoTagged));
  const csId = await createChangeset(changesetTags({ count: planned.length, withPhotos, usedOrtho, lang: getLang() }));
  try {
    planned.forEach((p, i) => (p.op.ref = String(i)));
    let built = buildOsmChange(
      planned.map((p) => p.op),
      csId,
    );
    let diff;
    try {
      diff = await uploadChange(csId, built.xml);
    } catch (e) {
      // Conflit de version (quelqu'un a modifié le nœud) : on recharge et on réessaie une fois.
      if (e instanceof OsmError && e.status === 409) {
        planned = await planOsm((await allRecords()).filter(needsSync).reverse(), manual);
        planned.forEach((p, i) => (p.op.ref = String(i)));
        built = buildOsmChange(
          planned.map((p) => p.op),
          csId,
        );
        diff = await uploadChange(csId, built.xml);
      } else throw e;
    }
    for (const entry of diff) {
      if (entry.type === 'relation') continue;
      const ref = built.refs.get(refKey(entry.type, entry.oldId));
      if (ref === undefined) continue; // nœuds sans tags d'un chemin créé
      const p = planned[Number(ref)];
      for (const rec of p.records) {
        await updateRecord(rec.id, (x) => {
          x.sync.osm = {
            ...x.sync.osm,
            status: 'done',
            osmType: entry.type as OsmType,
            osmId: entry.newId,
            changesetId: csId,
            photoTagged: x.sync.osm.photoTagged || rec.photoTagged,
            error: undefined,
          };
          x.bonusAwarded = true;
        });
      }
    }
    set({ done: planned.length, lastPublished: Date.now() });
  } catch (e) {
    for (const p of planned) {
      for (const rec of p.records) {
        await updateRecord(rec.id, (x) => {
          if (x.sync.osm.status === 'done') return;
          x.sync.osm.status = 'error';
          x.sync.osm.error = describe(e);
          x.sync.osm.attempts++;
        });
      }
    }
    throw e;
  } finally {
    await closeChangeset(csId).catch(() => undefined);
  }
}

/* ----------------------------- Orchestration --------------------------- */

export async function syncNow(opts: { manual?: boolean } = {}) {
  if (state.running) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ lastError: 'offline' });
    return;
  }
  const manual = !!opts.manual;
  set({ running: true, lastError: undefined, done: 0, total: 0 });
  try {
    const records = (await allRecords()).filter(needsSync).reverse();
    if (!records.length) return;
    if (panoramaxReady()) await syncPanoramax(records, manual);
    if (getOsmAuth()) await syncOsm(manual);
  } catch (e) {
    set({ lastError: describe(e) });
  } finally {
    set({ running: false, phase: 'idle', lastRun: Date.now() });
  }
}

/** Remet à zéro les compteurs d'échec (bouton « Réessayer »). */
export async function resetErrors(id?: string) {
  const list = id ? [(await allRecords()).find((r) => r.id === id)!] : await allRecords();
  for (const r of list) {
    if (!r) continue;
    await updateRecord(r.id, (x) => {
      if (x.sync.panoramax.status === 'error') x.sync.panoramax.attempts = 0;
      if (x.sync.osm.status === 'error') x.sync.osm.attempts = 0;
    });
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Synchronisation automatique : au démarrage, au retour du réseau, au premier plan, toutes les 3 min. */
export function startAutoSync() {
  if (timer) return;
  const kick = () => void syncNow();
  window.addEventListener('online', kick);
  window.addEventListener('avaloirs:auth', kick);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick());
  timer = setInterval(kick, 3 * 60 * 1000);
  setTimeout(kick, 1500);
}
