import type { DrainRecord } from './db';
import type { LatLon } from './geo';

export type Address = NonNullable<DrainRecord['address']>;

/**
 * Géocodage inverse : service de la Géoplateforme IGN (Base Adresse Nationale),
 * puis Nominatim (OSM) en secours hors de France.
 */
export async function reverseGeocode(p: LatLon, signal?: AbortSignal): Promise<Address | undefined> {
  try {
    const url = `https://data.geopf.fr/geocodage/reverse?lon=${p.lon.toFixed(6)}&lat=${p.lat.toFixed(6)}&index=address&limit=1`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      const f = json.features?.[0]?.properties;
      if (f && (f.distance ?? 0) < 250) {
        return {
          label: f.label,
          street: f.street || f.name,
          housenumber: f.housenumber,
          city: f.city,
          citycode: f.citycode,
          postcode: f.postcode,
          distance: f.distance,
        };
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${p.lat}&lon=${p.lon}`;
    const res = await fetch(url, { signal, headers: { 'Accept-Language': document.documentElement.lang || 'fr' } });
    if (res.ok) {
      const j = await res.json();
      const a = j.address || {};
      const street = a.road || a.pedestrian || a.footway;
      const city = a.city || a.town || a.village || a.municipality;
      return {
        label: [a.house_number, street, a.postcode, city].filter(Boolean).join(' ') || j.display_name,
        street,
        housenumber: a.house_number,
        city,
        postcode: a.postcode,
      };
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  return undefined;
}

/** Libellé court « 12 rue Victor Hugo » / « Rue Victor Hugo ». */
export function shortAddress(a?: Address): string {
  if (!a) return '';
  if (a.street) return [a.housenumber, a.street].filter(Boolean).join(' ');
  return a.label;
}
