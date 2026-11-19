import { describe, expect, it } from 'vitest';
import { isOnlyMine, removePictureTags } from '../../src/lib/deletions';
import { buildDeleteChange } from '../../src/lib/osm';

const A = 'cafb0ec8-51dd-43ac-836c-8cd1f7cb8725';
const B = '45e05bef-f4db-4862-8ac5-4c634e7a692e';

describe('Suppression d’un relevé publié', () => {
  it('retire uniquement la référence à NOTRE photo, jamais le reste', () => {
    const tags = { man_made: 'manhole', manhole: 'drain', panoramax: A, 'panoramax:1': B, material: 'metal' };
    expect(removePictureTags(tags, A)).toEqual({ man_made: 'manhole', manhole: 'drain', 'panoramax:1': B, material: 'metal' });
    expect(removePictureTags({ panoramax: `${A};${B}` }, A)).toEqual({ panoramax: B });
    expect(removePictureTags({ panoramax: A }, A)).toEqual({});
    expect(removePictureTags({ inlet: 'grate' }, A)).toEqual({ inlet: 'grate' });
  });

  it('un objet n’est supprimable que si tout son historique est de la personne connectée', () => {
    expect(isOnlyMine([{ version: 1, uid: 42 }, { version: 2, uid: 42 }], 42)).toBe(true);
    expect(isOnlyMine([{ version: 1, uid: 42 }, { version: 2, uid: 7 }], 42)).toBe(false);
    expect(isOnlyMine([{ version: 1, uid: 7 }], 42)).toBe(false);
    expect(isOnlyMine([{ version: 1, uid: 42 }], undefined)).toBe(false);
    expect(isOnlyMine([], 42)).toBe(false);
  });

  it('osmChange de suppression : chemin strict, nœuds « if-unused »', () => {
    const xml = buildDeleteChange(
      [
        { type: 'way', id: 900, version: 1, nodes: [11, 12] },
        { type: 'node', id: 11, version: 1, lat: 45.1, lon: 4.8 },
        { type: 'node', id: 12, version: 1, lat: 45.10002, lon: 4.80003 },
      ],
      77,
    );
    expect(xml).toMatch(/<delete>\s*<way id="900" version="1" changeset="77">\s*<nd ref="11"\/>\s*<nd ref="12"\/>\s*<\/way>\s*<\/delete>/);
    expect(xml).toMatch(/<delete if-unused="true">\s*<node id="11" version="1" changeset="77" lat="45.1000000" lon="4.8000000"\/>/);
    expect(xml.indexOf('<way')).toBeLessThan(xml.indexOf('<node'));
    expect(buildDeleteChange([{ type: 'node', id: 5, version: 3, lat: 1, lon: 2 }], 8)).not.toContain('<way');
  });
});
