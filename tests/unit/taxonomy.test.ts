import { describe, expect, it } from 'vitest';
import { isDrainFeature, isOsmMappable, mergeIntoExisting, needsTrace, nextPanoramaxKey, osmGeometry, osmTags, panoramaxSemantics, typeFromTags } from '../../src/lib/taxonomy';

describe('Schéma OSM des avaloirs', () => {
  it('grille au sol → manhole=drain + inlet=grate', () => {
    expect(osmTags({ type: 'grate', shape: 'rectangular', material: 'metal' }, 'abc')).toEqual({
      man_made: 'manhole',
      manhole: 'drain',
      inlet: 'grate',
      shape: 'rectangular',
      material: 'metal',
      panoramax: 'abc',
    });
  });

  it('grille et bordure → inlet=kerb_grate (exige manhole=drain)', () => {
    expect(osmTags({ type: 'kerb_grate' })).toEqual({ man_made: 'manhole', manhole: 'drain', inlet: 'kerb_grate' });
  });

  it('bouche dans la bordure → jamais manhole=drain (règle du wiki)', () => {
    const tags = osmTags({ type: 'kerb_opening', shape: 'square' });
    expect(tags).toEqual({ inlet: 'kerb_opening' });
    expect(tags.manhole).toBeUndefined();
    expect(osmTags({ type: 'kerb_opening', hasCover: true })).toEqual({ inlet: 'kerb_opening', man_made: 'manhole' });
  });

  it('caniveau à grille, mode ligne (défaut) → waterway=drainage_gutter + covered=yes', () => {
    expect(osmGeometry('channel')).toBe('way');
    expect(osmTags({ type: 'channel', material: 'metal', shape: 'square', length: 3.24 }, 'p9')).toEqual({
      waterway: 'drainage_gutter',
      covered: 'yes',
      material: 'metal',
      panoramax: 'p9',
    });
  });

  it('caniveau à grille, mode point → inlet=grate + length, jamais manhole', () => {
    const tags = osmTags({ type: 'channel', length: 3.24 }, undefined, 'node');
    expect(tags).toEqual({ inlet: 'grate', length: '3.2' });
    expect(osmGeometry('channel', 'node')).toBe('node');
  });

  it('caniveau à grille, mode « none » → rien dans OSM', () => {
    expect(osmTags({ type: 'channel' }, undefined, 'none')).toEqual({});
    expect(isOsmMappable('channel', 'none')).toBe(false);
    expect(needsTrace('channel', 'none')).toBe(false);
    expect(needsTrace('channel', 'way')).toBe(true);
    expect(needsTrace('grate', 'way')).toBe(false);
  });

  it('compléter un caniveau existant : ni regard ni forme ajoutés', () => {
    const merged = mergeIntoExisting({ waterway: 'drainage_gutter' }, { type: 'channel', material: 'metal' }, 'p2', '2026-11-18');
    expect(merged).toEqual({ waterway: 'drainage_gutter', covered: 'yes', material: 'metal', panoramax: 'p2', check_date: '2026-11-18' });
    expect(typeFromTags({ waterway: 'drainage_gutter', covered: 'yes' })).toBe('channel');
    expect(isDrainFeature({ waterway: 'drainage_gutter' })).toBe(true);
  });

  it('type inconnu → avaloir générique', () => {
    expect(osmTags({ type: 'generic', shape: 'circular' })).toEqual({ man_made: 'manhole', manhole: 'drain', shape: 'circular' });
  });

  it('compléter un objet existant ne remplace aucune valeur', () => {
    const existing = { man_made: 'manhole', manhole: 'drain', inlet: 'grate', material: 'concrete' };
    const merged = mergeIntoExisting(existing, { type: 'kerb_grate', material: 'metal', shape: 'square' }, 'p1', '2026-11-18');
    expect(merged.inlet).toBe('grate');
    expect(merged.material).toBe('concrete');
    expect(merged.shape).toBe('square');
    expect(merged.panoramax).toBe('p1');
    expect(merged.check_date).toBe('2026-11-18');
  });

  it('ne pose pas manhole=drain sur une bouche existante', () => {
    const merged = mergeIntoExisting({ inlet: 'kerb_opening' }, { type: 'grate' }, 'p1');
    expect(merged.manhole).toBeUndefined();
    expect(merged.inlet).toBe('kerb_opening');
  });

  it('photos multiples : panoramax, panoramax:1, panoramax:2', () => {
    expect(nextPanoramaxKey({})).toBe('panoramax');
    expect(nextPanoramaxKey({ panoramax: 'a' })).toBe('panoramax:1');
    expect(nextPanoramaxKey({ panoramax: 'a', 'panoramax:1': 'b' })).toBe('panoramax:2');
    expect(mergeIntoExisting({ panoramax: 'a' }, null, 'a')).toEqual({ panoramax: 'a' });
  });

  it('reconnaît le type depuis les tags', () => {
    expect(typeFromTags({ inlet: 'kerb_opening' })).toBe('kerb_opening');
    expect(typeFromTags({ manhole: 'drain' })).toBe('generic');
    expect(isDrainFeature({ manhole: 'sewer' })).toBe(false);
    expect(isDrainFeature({ inlet: 'kerb_grate' })).toBe(true);
  });

  it('sémantique Panoramax : tags OSM préfixés, hashtags, observations', () => {
    const sem = panoramaxSemantics({ type: 'grate' }, { standingWater: 'yes', clogged: 'unknown' }, ['#avaloirs']);
    expect(sem).toContainEqual({ key: 'osm|manhole', value: 'drain' });
    expect(sem).toContainEqual({ key: 'hashtag', value: 'avaloirs' });
    expect(sem).toContainEqual({ key: 'avaloirs|standing_water', value: 'yes' });
    expect(sem.find((s) => s.key === 'avaloirs|clogged')).toBeUndefined();
    const ch = panoramaxSemantics({ type: 'channel' }, {}, []);
    expect(ch).toContainEqual({ key: 'osm|waterway', value: 'drainage_gutter' });
    expect(ch).toContainEqual({ key: 'osm|covered', value: 'yes' });
  });
});
