import { describe, expect, it } from 'vitest';
import { getConfig, sanitizeConfig, type AppConfig } from '../../src/lib/config';
import { recordsToCSV } from '../../src/lib/export';
import { cleanPseudo } from '../../src/lib/invite';
import { firstPictureId, isPictureId } from '../../src/lib/panoramax';
import { OsmError } from '../../src/lib/osm';
import { PanoramaxError } from '../../src/lib/panoramax';
import { countsAsAttempt, outcomeUncertain } from '../../src/lib/sync';
import type { DrainRecord } from '../../src/lib/db';

const UUID = 'cafb0ec8-51dd-43ac-836c-8cd1f7cb8725';

describe('Revue de code : régressions', () => {
  it('config : serveurs non HTTPS et valeurs invalides rejetés', () => {
    const base = getConfig();
    const bad = {
      ...base,
      dailyGoal: -3,
      panoramax: { instance: 'http://evil.example' },
      overpass: ['http://a.example', 'javascript:alert(1)', 'https://ok.example/api'],
      openstreetmap: { ...base.openstreetmap, channelDrainTagging: 'x' as never },
    } as AppConfig;
    const c = sanitizeConfig(bad);
    expect(c.panoramax.instance).toBe('https://panoramax.openstreetmap.fr');
    expect(c.overpass).toEqual(['https://ok.example/api']);
    expect(c.dailyGoal).toBeGreaterThan(0);
    expect(c.openstreetmap.channelDrainTagging).toBe('way');
    expect(sanitizeConfig({ ...bad, overpass: ['http://a.example'] }).overpass.length).toBeGreaterThan(0);
  });

  it('identifiants de photo : seuls les UUID sont retenus (valeur OSM non fiable)', () => {
    expect(isPictureId(UUID)).toBe(true);
    expect(isPictureId('../../etc/passwd')).toBe(false);
    expect(isPictureId(`${UUID}/../x`)).toBe(false);
    expect(firstPictureId({ panoramax: `"><img src=x>;${UUID}` })).toBe(UUID);
    expect(firstPictureId({ 'panoramax:1': UUID })).toBe(UUID);
    expect(firstPictureId({ panoramax: 'javascript:alert(1)' })).toBeUndefined();
  });

  it('pseudonyme de parrainage : caractères de contrôle et de direction retirés, longueur bornée', () => {
    expect(cleanPseudo('Ca‮mille\u0007')).toBe('Camille');
    expect(cleanPseudo('x'.repeat(200)).length).toBe(40);
    expect(cleanPseudo(null)).toBe('');
  });

  it('export CSV : pas d’injection de formules, nombres négatifs préservés', () => {
    const r = {
      id: 'a', createdAt: 0, updatedAt: 0,
      position: { lat: 45.1, lon: -1.5, acc: 3, samples: 4, adjusted: false, adjustMeters: 0 },
      photoTakenAt: 0, photoSharpness: 1, details: { type: 'grate' }, observations: {},
      address: { label: '=HYPERLINK("http://evil")', citycode: '69273' },
      mode: 'new', quality: { score: 80, stars: 3 }, points: 10,
      sync: { panoramax: { status: 'pending', pictureId: 'p', attempts: 0 }, osm: { status: 'pending', attempts: 0 } },
    } as DrainRecord;
    const csv = recordsToCSV([r]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(';-1.5000000;');
  });

  it('réessais : le réseau, les 5xx, le 429 et l’authentification ne comptent pas comme tentatives', () => {
    expect(countsAsAttempt(new TypeError('Failed to fetch'))).toBe(false);
    expect(countsAsAttempt(new OsmError(503, ''))).toBe(false);
    expect(countsAsAttempt(new OsmError(429, ''))).toBe(false);
    expect(countsAsAttempt(new OsmError(401, ''))).toBe(false);
    expect(countsAsAttempt(new PanoramaxError(403, 'x'))).toBe(false);
    expect(countsAsAttempt(new OsmError(400, 'bad'))).toBe(true);
    expect(countsAsAttempt(new OsmError(412, 'precondition'))).toBe(true);
  });

  it('résultat incertain : seulement si le serveur a pu appliquer la requête', () => {
    expect(outcomeUncertain(new TypeError('Failed to fetch'))).toBe(true);
    expect(outcomeUncertain(new OsmError(502, ''))).toBe(true);
    expect(outcomeUncertain(new OsmError(400, ''))).toBe(false);
    expect(outcomeUncertain(new OsmError(409, ''))).toBe(false);
  });
});
