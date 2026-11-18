import { describe, expect, it } from 'vitest';
import { buildOsmChange, escapeXml, parseDiffResult, pkceChallenge, refKey } from '../../src/lib/osm';

describe('API OSM', () => {
  it('construit un osmChange avec créations et modifications', () => {
    const { xml, refs } = buildOsmChange(
      [
        { kind: 'create', ref: 'a', lat: 45.123456789, lon: 4.9, tags: { man_made: 'manhole', manhole: 'drain', note: 'a & <b> "c"' } },
        { kind: 'create', ref: 'b', lat: 45.2, lon: 4.8, tags: { inlet: 'kerb_opening' } },
        { kind: 'modify', ref: 'c', element: { type: 'node', id: 987, lat: 45.3, lon: 4.7, version: 4, tags: { manhole: 'drain', panoramax: 'x' } } },
      ],
      555,
    );
    expect(xml).toContain('<create>');
    expect(xml).toContain('<node id="-1" lat="45.1234568" lon="4.9000000" changeset="555">');
    expect(xml).toContain('<node id="-2"');
    expect(xml).toContain('<modify>');
    expect(xml).toContain('<node id="987" lat="45.3000000" lon="4.7000000" version="4" changeset="555">');
    expect(xml).toContain('v="a &amp; &lt;b&gt; &quot;c&quot;"');
    expect(refs.get(refKey('node', -1))).toBe('a');
    expect(refs.get(refKey('node', -2))).toBe('b');
    expect(refs.get(refKey('node', 987))).toBe('c');
  });

  it('crée un caniveau : deux nœuds sans tags puis le chemin qui les relie', () => {
    const { xml, refs } = buildOsmChange(
      [
        { kind: 'create', ref: 'n', lat: 45, lon: 4.9, tags: { manhole: 'drain' } },
        { kind: 'createWay', ref: 'w', points: [{ lat: 45.1, lon: 4.8 }, { lat: 45.10002, lon: 4.80003 }], tags: { waterway: 'drainage_gutter', covered: 'yes' } },
      ],
      7,
    );
    expect(xml).toContain('<node id="-2" lat="45.1000000" lon="4.8000000" changeset="7"/>');
    expect(xml).toContain('<node id="-3" lat="45.1000200" lon="4.8000300" changeset="7"/>');
    expect(xml).toMatch(/<way id="-1" changeset="7">\s*<nd ref="-2"\/>\s*<nd ref="-3"\/>\s*<tag k="waterway" v="drainage_gutter"\/>\s*<tag k="covered" v="yes"\/>\s*<\/way>/);
    // Les nœuds sont déclarés avant le chemin qui les référence.
    expect(xml.indexOf('<node id="-3"')).toBeLessThan(xml.indexOf('<way id="-1"'));
    expect(refs.get(refKey('way', -1))).toBe('w');
    expect(refs.get(refKey('node', -1))).toBe('n');
    expect(refs.get(refKey('node', -2))).toBeUndefined();
  });

  it('modifie un caniveau existant en conservant ses nœuds', () => {
    const { xml } = buildOsmChange(
      [{ kind: 'modify', ref: 'm', element: { type: 'way', id: 55, version: 2, nodes: [10, 11], tags: { waterway: 'drainage_gutter', panoramax: 'p' } } }],
      8,
    );
    expect(xml).toMatch(/<modify>\s*<way id="55" version="2" changeset="8">\s*<nd ref="10"\/>\s*<nd ref="11"\/>/);
    expect(xml).toContain('<tag k="panoramax" v="p"/>');
  });

  it('lit le diffResult renvoyé par le serveur (nœuds et chemins)', () => {
    const xml = `<?xml version="1.0"?><diffResult version="0.6" generator="OpenStreetMap server">
      <node old_id="-1" new_id="12001" new_version="1"/>
      <node old_id="-2" new_id="12002" new_version="1"/>
      <way old_id="-1" new_id="900" new_version="1"/>
      <node old_id="987" new_id="987" new_version="5"/></diffResult>`;
    expect(parseDiffResult(xml)).toEqual([
      { type: 'node', oldId: -1, newId: 12001, newVersion: 1 },
      { type: 'node', oldId: -2, newId: 12002, newVersion: 1 },
      { type: 'way', oldId: -1, newId: 900, newVersion: 1 },
      { type: 'node', oldId: 987, newId: 987, newVersion: 5 },
    ]);
  });

  it('échappe le XML et retire les caractères de contrôle', () => {
    expect(escapeXml(`l'"<>&\u0001`)).toBe('l&apos;&quot;&lt;&gt;&amp;');
  });

  it('calcule le défi PKCE (vecteur de la RFC 7636)', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
