const VERSION = 'viagens-v3';
const CORE = [
  './',
  './index.html',
  './data/trips.json',
  './manifest.webmanifest',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,900&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Map tiles: cache-first, long-lived
  if (url.hostname.includes('basemaps.cartocdn.com') || url.hostname.includes('tile.openstreetmap')) {
    e.respondWith(
      caches.open(VERSION + '-tiles').then(cache =>
        cache.match(e.request).then(hit => hit || fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => hit))
      )
    );
    return;
  }

  // App shell + JSON: stale-while-revalidate
  e.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(e.request).then(hit => {
        const fetcher = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || fetcher;
      })
    )
  );
});
