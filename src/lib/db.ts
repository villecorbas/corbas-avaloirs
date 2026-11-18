import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DrainDetails, Observations } from './taxonomy';

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface DrainRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Position de l'avaloir (moyennée, éventuellement ajustée sur l'orthophoto). */
  position: { lat: number; lon: number; acc: number; samples: number; adjusted: boolean; adjustMeters: number };
  /** Position et cap du téléphone au moment de la photo (métadonnées Panoramax). */
  photoPosition?: { lat: number; lon: number; acc: number; heading?: number };
  /** Caniveau à grille : tracé de l'extrémité amont (a) vers l'aval (b) — sens d'écoulement. */
  line?: { a: { lat: number; lon: number }; b: { lat: number; lon: number } };
  photoTakenAt: number;
  photoSharpness: number;
  details: DrainDetails;
  observations: Observations;
  address?: { label: string; street?: string; housenumber?: string; city?: string; citycode?: string; postcode?: string; distance?: number };
  mode: 'new' | 'enrich';
  osmTarget?: { type?: 'node' | 'way'; id: number; tags: Record<string, string> };
  quality: { score: number; stars: 1 | 2 | 3 };
  points: number;
  bonusAwarded?: boolean;
  sync: {
    panoramax: { status: StepStatus; pictureId: string; uploadSetId?: string; error?: string; attempts: number };
    osm: {
      status: StepStatus;
      osmType?: 'node' | 'way';
      osmId?: number;
      changesetId?: number;
      photoTagged?: boolean;
      /** Envoi interrompu sans réponse du serveur : l'objet a peut-être été créé (vérifié avant de réessayer). */
      uncertain?: boolean;
      error?: string;
      attempts: number;
    };
  };
}

interface AvaloirsDB extends DBSchema {
  records: { key: string; value: DrainRecord; indexes: { byDate: number } };
  photos: { key: string; value: { id: string; blob: Blob; thumb: Blob } };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<AvaloirsDB>> | null = null;

export function db() {
  if (!dbPromise) {
    dbPromise = openDB<AvaloirsDB>('avaloirs', 1, {
      upgrade(database) {
        const store = database.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('byDate', 'createdAt');
        database.createObjectStore('photos', { keyPath: 'id' });
        database.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onRecordsChange(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit() {
  listeners.forEach((l) => l());
}

export async function allRecords(): Promise<DrainRecord[]> {
  const list = await (await db()).getAllFromIndex('records', 'byDate');
  return list.reverse();
}

export async function getRecord(id: string) {
  return (await db()).get('records', id);
}

export async function saveRecord(rec: DrainRecord, photo?: { blob: Blob; thumb: Blob }) {
  const d = await db();
  const tx = d.transaction(['records', 'photos'], 'readwrite');
  rec.updatedAt = Date.now();
  await tx.objectStore('records').put(rec);
  if (photo) await tx.objectStore('photos').put({ id: rec.id, ...photo });
  await tx.done;
  emit();
}

export async function updateRecord(id: string, mutate: (r: DrainRecord) => void) {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  const rec = await tx.store.get(id);
  if (!rec) return;
  mutate(rec);
  rec.updatedAt = Date.now();
  await tx.store.put(rec);
  await tx.done;
  emit();
}

export async function deleteRecord(id: string) {
  const d = await db();
  const tx = d.transaction(['records', 'photos'], 'readwrite');
  await tx.objectStore('records').delete(id);
  await tx.objectStore('photos').delete(id);
  await tx.done;
  emit();
}

export async function getPhoto(id: string) {
  return (await db()).get('photos', id);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Repli pour anciens navigateurs.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Demande au navigateur de ne pas purger les données (photos non synchronisées). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}
