import type { DrainRecord } from './db';
import type { OsmDrain } from './overpass';
import { osmTags } from './taxonomy';
import { distance, midpoint } from './geo';

/** Point d'intervention : centre du tracé pour un caniveau, sinon la position relevée. */
export function recordCenter(r: DrainRecord) {
  return r.line ? midpoint(r.line.a, r.line.b) : r.position;
}

export function recordLength(r: DrainRecord): number | null {
  return r.line ? Math.round(distance(r.line.a, r.line.b) * 10) / 10 : null;
}

/** Couche SIG des relevés de l'appareil (GeoJSON, EPSG:4326). */
export function recordsToGeoJSON(records: DrainRecord[]) {
  return {
    type: 'FeatureCollection',
    name: 'avaloirs_releves',
    features: records.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [round(recordCenter(r).lon), round(recordCenter(r).lat)] },
      properties: {
        id: r.id,
        date: new Date(r.createdAt).toISOString(),
        type: r.details.type,
        forme: r.details.shape ?? null,
        materiau: r.details.material ?? null,
        eau_stagnante: r.observations.standingWater ?? null,
        obstrue: r.observations.clogged ?? null,
        precision_m: r.position.acc,
        position_ajustee: r.position.adjusted,
        adresse: r.address?.label ?? null,
        rue: r.address?.street ?? null,
        code_insee: r.address?.citycode ?? null,
        longueur_m: recordLength(r),
        osm_type: r.sync.osm.osmType ?? r.osmTarget?.type ?? (r.sync.osm.osmId || r.osmTarget ? 'node' : null),
        osm_id: r.sync.osm.osmId ?? r.osmTarget?.id ?? null,
        osm_tags: JSON.stringify(osmTags(r.details)),
        panoramax_id: r.sync.panoramax.status === 'done' ? r.sync.panoramax.pictureId : null,
        qualite: r.quality.score,
      },
    })),
  };
}

/** Couche SIG de tous les avaloirs OSM de la commune (via Overpass). */
export function osmDrainsToGeoJSON(drains: OsmDrain[]) {
  return {
    type: 'FeatureCollection',
    name: 'avaloirs_osm',
    features: drains.map((d) => {
      const photo = d.tags.panoramax;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [round(d.lon), round(d.lat)] },
        properties: {
          osm_type: d.type,
          osm_id: d.id,
          waterway: d.tags.waterway ?? null,
          longueur_m: d.length ?? null,
          inlet: d.tags.inlet ?? null,
          manhole: d.tags.manhole ?? null,
          shape: d.tags.shape ?? null,
          material: d.tags.material ?? null,
          panoramax: photo ?? null,
          photo_url: photo ? `https://api.panoramax.xyz/api/pictures/${photo}/sd.jpg` : null,
          last_edit: d.timestamp ?? null,
        },
      };
    }),
  };
}

function round(n: number) {
  return Math.round(n * 1e7) / 1e7;
}

const CSV_COLUMNS = [
  'id', 'date', 'latitude', 'longitude', 'precision_m', 'type', 'longueur_m', 'forme', 'materiau',
  'eau_stagnante', 'obstrue', 'adresse', 'code_insee', 'osm_type', 'osm_id', 'panoramax_id', 'qualite',
];

export function recordsToCSV(records: DrainRecord[]): string {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map((r) =>
    [
      r.id,
      new Date(r.createdAt).toISOString(),
      recordCenter(r).lat.toFixed(7),
      recordCenter(r).lon.toFixed(7),
      r.position.acc,
      r.details.type,
      recordLength(r),
      r.details.shape,
      r.details.material,
      r.observations.standingWater,
      r.observations.clogged,
      r.address?.label,
      r.address?.citycode,
      r.sync.osm.osmType ?? r.osmTarget?.type ?? (r.sync.osm.osmId || r.osmTarget ? 'node' : ''),
      r.sync.osm.osmId ?? r.osmTarget?.id,
      r.sync.panoramax.status === 'done' ? r.sync.panoramax.pictureId : '',
      r.quality.score,
    ]
      .map(esc)
      .join(';'),
  );
  // Séparateur « ; » et BOM UTF-8 : ouverture directe dans Excel / LibreOffice en français.
  return '﻿' + [CSV_COLUMNS.join(';'), ...rows].join('\n');
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
