import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Génère /sw.js à la fin du build : le service worker reçoit la liste exacte
 * des fichiers à mettre en cache (noms hachés par Vite) et un numéro de version.
 * Pas de dépendance à Workbox : le code du SW est dans src/sw-template.js.
 */
function serviceWorker(): Plugin {
  return {
    name: 'avaloirs-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = [
        'config.js',
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
        'icons/favicon.svg',
      ];
      const precache = ['./', ...files, ...publicFiles];
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      const template = readFileSync(fileURLToPath(new URL('./src/sw-template.js', import.meta.url)), 'utf8');
      const source = template
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', JSON.stringify(version));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Chemins relatifs : l'appli peut être hébergée dans un sous-dossier
  // (ex. https://ville.fr/avaloirs/ ou GitHub Pages).
  base: './',
  plugins: [react(), serviceWorker()],
  build: {
    target: ['es2020', 'safari15'],
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
