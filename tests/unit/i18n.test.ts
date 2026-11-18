import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en, flattenKeys, fr, setLang, t } from '../../src/i18n';
import { BADGES, LEVELS } from '../../src/lib/gamification';
import { DRAIN_TYPES } from '../../src/lib/taxonomy';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('Traductions', () => {
  const frKeys = new Set(flattenKeys(fr));
  const enKeys = new Set(flattenKeys(en));

  it('l’anglais couvre toutes les clés du français (et inversement)', () => {
    expect([...frKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !frKeys.has(k))).toEqual([]);
  });

  it('toutes les clés statiques utilisées dans le code existent', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../../src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    used.add('tabs.map');
    const missing = [...used].filter((k) => !frKeys.has(k) && !frKeys.has(k.replace(/\.(one|other)$/, '')));
    expect(missing).toEqual([]);
  });

  it('les clés dynamiques existent', () => {
    const dynamic = [
      ...DRAIN_TYPES.flatMap((ty) => [`types.${ty}.name`, `types.${ty}.desc`]),
      ...BADGES.flatMap((b) => [`badges.${b.id}.name`, `badges.${b.id}.desc`]),
      ...LEVELS.map((_, i) => `levels.${i + 1}`),
      ...['excellent', 'good', 'fair', 'poor'].map((k) => `accuracy.${k}`),
      ...['base', 'quality', 'precise', 'new', 'enrich', 'firstOfDay', 'streak'].map((k) => `points.${k}`),
      ...['precision', 'photo', 'type', 'details', 'observations'].map((k) => `quality.${k}`),
      ...['pending', 'running', 'done', 'error', 'skipped', 'published'].map((k) => `status.${k}`),
      ...['osm_rate_limited', 'osm_auth', 'panoramax_auth', 'network', 'not_mappable', 'no_photo', 'offline', 'generic'].map((k) => `errors.${k}`),
      ...['ok', 'blurry', 'dark'].map((k) => `photo.verdict.${k}`),
      ...['step1', 'step2', 'step3', 'step4'].flatMap((k) => [`onboarding.${k}Title`, `onboarding.${k}Text`]),
      ...['map', 'records', 'profile', 'settings'].map((k) => `tabs.${k}`),
    ];
    expect(dynamic.filter((k) => !frKeys.has(k))).toEqual([]);
  });

  it('pluriels et paramètres', () => {
    setLang('fr');
    expect(t('records.pendingCount', { count: 1 })).toBe('1 relevé à envoyer');
    expect(t('records.pendingCount', { count: 3 })).toBe('3 relevés à envoyer');
    expect(t('level.label', { level: 4 })).toBe('Niveau 4');
  });
});
