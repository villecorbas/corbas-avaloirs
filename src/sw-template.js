/* Service worker « Chasse aux avaloirs » — généré au build (voir vite.config.ts). */
/* eslint-disable no-restricted-globals */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const SHELL_CACHE = `avaloirs-shell-${VERSION}`;
const TILE_CACHE = 'avaloirs-tiles-v1';
const MAX_TILES = 2500;

const TILE_HOSTS = ['tile.openstreetmap.fr', 'tile.openstreetmap.org', 'data.geopf.fr'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('avaloirs-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isTile(url) {
  if (!TILE_HOSTS.some((h) => url.hostname.endsWith(h))) return false;
  // Sur data.geopf.fr, seules les tuiles WMTS sont mises en cache (pas le géocodage).
  if (url.hostname === 'data.geopf.fr') return url.pathname.startsWith('/wmts');
  return true;
}

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  }
}

async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      cache.put(request, response.clone()).then(() => (Math.random() < 0.05 ? trimTiles() : undefined));
    }
    return response;
  } catch (e) {
    return cached || Response.error();
  }
}

async function navigationStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (e) {
    return (await cache.match('./', { ignoreVary: true })) || (await cache.match(request, { ignoreVary: true })) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(navigationStrategy(request));
    return;
  }
  if (isTile(url)) {
    event.respondWith(tileStrategy(request));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.endsWith('/config.js')) {
    // La configuration peut être modifiée sur le serveur : réseau d'abord.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('config.js', copy));
          return response;
        })
        .catch(() => caches.match('config.js', { ignoreSearch: true, ignoreVary: true }).then((r) => r || Response.error())),
    );
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true, ignoreVary: true }).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && url.pathname.includes('/assets/')) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Les appels aux API (OSM, Panoramax, Overpass, géocodage) passent directement par le réseau.
});
