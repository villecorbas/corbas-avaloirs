/**
 * Correspondance entre les types d'avaloirs présentés au public et le schéma
 * OpenStreetMap (vérifié en novembre 2026) :
 *  - https://wiki.openstreetmap.org/wiki/Tag:manhole=drain
 *  - https://wiki.openstreetmap.org/wiki/Key:inlet (statut « approved »)
 *  - https://wiki.openstreetmap.org/wiki/Key:panoramax
 *  - https://wiki.openstreetmap.org/wiki/Road_inlets_and_covers (caniveaux à grille)
 *
 * Règles du wiki appliquées :
 *  - inlet=grate et inlet=kerb_grate exigent man_made=manhole + manhole=drain ;
 *  - inlet=kerb_opening (bouche sans grille) ne doit PAS porter manhole=drain ;
 *    man_made=manhole est admis seulement si un tampon est accolé à la bouche ;
 *  - manhole=drain et inlet=kerb_grate ne doivent pas servir pour les longues
 *    rigoles couvertes. Pour celles-ci (caniveaux à grille), la page « Road inlets
 *    and covers » propose waterway=drainage_gutter + covered=yes sur une LIGNE,
 *    schéma issu de la discussion communautaire de 2023 (voir README) ;
 *  - shape : forme adjectivale recommandée (rectangular, square, circular).
 */
import { getConfig } from './config';

export type DrainType = 'grate' | 'kerb_grate' | 'kerb_opening' | 'channel' | 'generic';
export type DrainShape = 'rectangular' | 'square' | 'circular';
export type DrainMaterial = 'metal' | 'concrete';
export type TriState = 'yes' | 'no' | 'unknown';
/** Eau stagnante (question obligatoire) : visible, possible (fond qui retient l'eau) ou non. */
export type StandingWater = 'yes' | 'possible' | 'no';
export const STANDING_WATER: StandingWater[] = ['yes', 'possible', 'no'];

/**
 * Publication des caniveaux à grille dans OSM :
 *  - 'way'  : ligne waterway=drainage_gutter + covered=yes (par défaut) ;
 *  - 'node' : point inlet=grate + length=* (uniquement des tags documentés) ;
 *  - 'none' : pas de publication OSM (photo Panoramax et export seulement).
 */
export type ChannelMode = 'way' | 'node' | 'none';

export interface DrainDetails {
  type: DrainType;
  shape?: DrainShape;
  material?: DrainMaterial;
  /** Bouche d'égout : présence d'un tampon (plaque) accolé sur le trottoir. */
  hasCover?: boolean;
  /** Caniveau à grille : longueur mesurée sur le tracé (m). */
  length?: number;
}

export interface Observations {
  standingWater?: StandingWater;
  clogged?: TriState;
}

export const DRAIN_TYPES: DrainType[] = ['grate', 'kerb_grate', 'kerb_opening', 'channel', 'generic'];

export type Tags = Record<string, string>;

export function channelMode(): ChannelMode {
  return getConfig().openstreetmap.channelDrainTagging ?? 'way';
}

/** Géométrie OSM de l'objet à créer, ou null s'il n'est pas publié dans OSM. */
export function osmGeometry(type: DrainType, mode: ChannelMode = channelMode()): 'node' | 'way' | null {
  if (type !== 'channel') return 'node';
  return mode === 'none' ? null : mode;
}

/** Le type peut-il être publié sur OpenStreetMap ? */
export function isOsmMappable(type: DrainType, mode: ChannelMode = channelMode()): boolean {
  return osmGeometry(type, mode) !== null;
}

/** Le type nécessite-t-il de tracer l'objet (ligne) ? */
export function needsTrace(type: DrainType, mode: ChannelMode = channelMode()): boolean {
  return type === 'channel' && mode !== 'none';
}

function formatLength(m: number): string {
  return String(Math.round(m * 10) / 10);
}

/** Tags OSM de l'objet à créer. */
export function osmTags(d: DrainDetails, panoramaxId?: string, mode: ChannelMode = channelMode()): Tags {
  const tags: Tags = {};
  switch (d.type) {
    case 'grate':
      Object.assign(tags, { man_made: 'manhole', manhole: 'drain', inlet: 'grate' });
      break;
    case 'kerb_grate':
      Object.assign(tags, { man_made: 'manhole', manhole: 'drain', inlet: 'kerb_grate' });
      break;
    case 'kerb_opening':
      tags.inlet = 'kerb_opening';
      if (d.hasCover) tags.man_made = 'manhole';
      break;
    case 'generic':
      Object.assign(tags, { man_made: 'manhole', manhole: 'drain' });
      break;
    case 'channel':
      if (mode === 'none') return {};
      if (mode === 'way') Object.assign(tags, { waterway: 'drainage_gutter', covered: 'yes' });
      else {
        // Grille non accessible à une personne : pas de man_made=manhole (cf. Key:inlet).
        tags.inlet = 'grate';
        if (d.length) tags.length = formatLength(d.length);
      }
      break;
  }
  // La forme décrit une grille ponctuelle ; sans objet pour une bouche ou un caniveau.
  if (d.shape && d.type !== 'kerb_opening' && d.type !== 'channel') tags.shape = d.shape;
  if (d.material) tags.material = d.material;
  if (panoramaxId) tags.panoramax = panoramaxId;
  return tags;
}

/**
 * Fusion avec un objet OSM existant (« compléter » un avaloir déjà cartographié) :
 * on n'écrase jamais une valeur posée par un autre contributeur ; on ajoute la
 * photo (panoramax, puis panoramax:1, panoramax:2…) et les attributs manquants.
 */
export function mergeIntoExisting(
  existing: Tags,
  d: DrainDetails | null,
  panoramaxId?: string,
  checkDate?: string,
  mode: ChannelMode = channelMode(),
): Tags {
  const out: Tags = { ...existing };
  if (d && isOsmMappable(d.type, mode)) {
    const proposed = osmTags(d, undefined, mode);
    const isGutter = out.waterway === 'drainage_gutter';
    for (const [k, v] of Object.entries(proposed)) {
      if (k in out) continue;
      // Ne pas ajouter manhole=drain sur une bouche ouverte existante, et inversement.
      if (k === 'manhole' && out.inlet === 'kerb_opening') continue;
      if (k === 'inlet' && out.inlet) continue;
      // Une ligne de caniveau ne devient jamais un regard (et inversement).
      if (isGutter && (k === 'man_made' || k === 'manhole' || k === 'inlet' || k === 'shape')) continue;
      if (!isGutter && (k === 'waterway' || k === 'covered')) continue;
      out[k] = v;
    }
  }
  if (panoramaxId && !Object.values(out).includes(panoramaxId)) {
    out[nextPanoramaxKey(out)] = panoramaxId;
  }
  if (checkDate) out.check_date = checkDate;
  return out;
}

export function nextPanoramaxKey(tags: Tags): string {
  if (!tags.panoramax) return 'panoramax';
  for (let i = 1; i < 100; i++) {
    const k = `panoramax:${i}`;
    if (!tags[k]) return k;
  }
  return 'panoramax:99';
}

/** Retrouve le type « public » à partir des tags d'un objet OSM existant. */
export function typeFromTags(tags: Tags): DrainType {
  if (tags.waterway === 'drainage_gutter') return 'channel';
  if (tags.inlet === 'kerb_opening') return 'kerb_opening';
  if (tags.inlet === 'kerb_grate') return 'kerb_grate';
  if (tags.inlet === 'grate') return 'grate';
  return 'generic';
}

export function isDrainFeature(tags: Tags): boolean {
  return (
    tags.manhole === 'drain' ||
    tags.inlet === 'grate' ||
    tags.inlet === 'kerb_grate' ||
    tags.inlet === 'kerb_opening' ||
    tags.waterway === 'drainage_gutter'
  );
}

export interface SemanticTag {
  key: string;
  value: string;
}

/**
 * Tags sémantiques Panoramax de la photo : mêmes tags OSM préfixés « osm| »
 * (convention Panoramax), hashtags de campagne et observations utiles à la ville.
 */
export function panoramaxSemantics(d: DrainDetails, obs: Observations, hashtags: string[]): SemanticTag[] {
  const sem: SemanticTag[] = [];
  // La photo décrit l'objet tel qu'il est, quel que soit le mode de publication OSM.
  const tags = d.type === 'channel' ? { waterway: 'drainage_gutter', covered: 'yes', ...(d.material ? { material: d.material } : {}) } : osmTags(d);
  for (const [k, v] of Object.entries(tags)) sem.push({ key: `osm|${k}`, value: v });
  for (const h of hashtags) sem.push({ key: 'hashtag', value: h.replace(/^#/, '') });
  if (obs.standingWater) sem.push({ key: 'avaloirs|standing_water', value: obs.standingWater });
  if (obs.clogged && obs.clogged !== 'unknown') sem.push({ key: 'avaloirs|clogged', value: obs.clogged });
  return sem;
}
