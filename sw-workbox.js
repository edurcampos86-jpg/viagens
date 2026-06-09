// Service Worker v2.0 com Workbox.
// Substitui o sw.js manual mantendo retrocompat (versão bumpada para
// invalidar caches antigos).
//
// Estratégias:
//   - assets do app shell (HTML/JS/CSS): CacheFirst com versionamento
//   - data/trips.json: NetworkFirst (sempre tenta versão atual)
//   - imagens: StaleWhileRevalidate
//   - tiles de mapa: CacheFirst com expiry de 30 dias
//
// Push notifications: handler on('push') decodifica o payload e exibe
// notification do browser.
//
// Sync offline: tag 'viagens-edit-queue' processa fila quando online.

importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

if (!self.workbox) {
  console.error('[sw] Workbox falhou ao carregar — caindo no SW antigo.');
} else {
  workbox.setConfig({ debug: false });

  const { routing, strategies, expiration, precaching } = workbox;
  // Bump VERSION em cada deploy que muda assets/* ou index.html — Workbox
  // entao expira a entrada precacheada antiga e baixa a nova. Faz o papel
  // do cache-busting via query string sem precisar de build.
  const VERSION = 'viagens-v3-pwa-13';

  // Precache do app shell completo (HTML + CSS + JS criticos com revision).
  // URLs relativas ao scope do SW (que é /viagens/ no GitHub Pages, ou / no
  // domínio vidacarreira.com.br). O script está na raiz; antes começavam com '/' e apontavam para fora
  // do GitHub Pages do projeto — PR #1.5B corrigiu scope e paths juntos.
  precaching.precacheAndRoute([
    { url: './', revision: VERSION },
    { url: 'index.html', revision: VERSION },
    { url: 'manifest.webmanifest', revision: VERSION },
    { url: 'icons/icon-192.svg', revision: VERSION },
    { url: 'icons/icon-512.svg', revision: VERSION },
    { url: 'assets/app.js', revision: VERSION },
    { url: 'assets/styles.css', revision: VERSION },
    { url: 'assets/cleanup-pat.js', revision: VERSION },
    { url: 'src/main.js', revision: VERSION },
  ]);

  // CSS/JS adicionais (chunks dinamicos, src/components/*) caem aqui.
  // O precache acima ja cuida do shell critico; aqui StaleWhileRevalidate
  // mantem o resto rapido.
  routing.registerRoute(
    ({ request, url }) =>
      (request.destination === 'script' || request.destination === 'style') &&
      url.origin === self.location.origin,
    new strategies.StaleWhileRevalidate({
      cacheName: 'viagens-app-shell-v2',
    })
  );

  // trips.json: NetworkFirst — quer a versão mais recente sempre
  routing.registerRoute(
    ({ url }) => url.pathname.endsWith('data/trips.json'),
    new strategies.NetworkFirst({
      cacheName: 'viagens-trips-v2',
      networkTimeoutSeconds: 3,
    })
  );

  // Outros JSONs em data/: StaleWhileRevalidate
  routing.registerRoute(
    ({ url }) => /data\/.*\.json$/.test(url.pathname),
    new strategies.StaleWhileRevalidate({
      cacheName: 'viagens-data-v2',
    })
  );

  // Imagens (previews/, icons/): StaleWhileRevalidate
  routing.registerRoute(
    ({ request }) => request.destination === 'image',
    new strategies.StaleWhileRevalidate({
      cacheName: 'viagens-images-v2',
      plugins: [
        new expiration.ExpirationPlugin({
          maxEntries: 200,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    })
  );

  // Tiles de mapa: CacheFirst (raramente mudam)
  routing.registerRoute(
    ({ url }) =>
      url.hostname.includes('basemaps.cartocdn.com') ||
      url.hostname.includes('tile.openstreetmap'),
    new strategies.CacheFirst({
      cacheName: 'viagens-tiles-v2',
      plugins: [
        new expiration.ExpirationPlugin({
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    })
  );

  // CDN externos (Leaflet, fonts): StaleWhileRevalidate
  routing.registerRoute(
    ({ url }) =>
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com'),
    new strategies.StaleWhileRevalidate({
      cacheName: 'viagens-cdn-v2',
      plugins: [
        new expiration.ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 30 * 24 * 60 * 60,
        }),
      ],
    })
  );

  // Activate: limpa caches antigos e avisa os clientes que houve update.
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('viagens-v') && !k.endsWith('-v2'))
          .map((k) => caches.delete(k))
      );
      // Notifica clientes que nova versão foi ativada (PR #1.5B).
      // O app principal escuta esse postMessage e exibe toast de reload.
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'sw-activated', version: VERSION }));
    })());
  });
}

// ── Push notifications ─────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Viagens', body: event.data.text() };
  }
  const title = payload.title || 'Portal de Viagens';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: payload.tag || 'viagens-default',
    data: payload.data || {},
    requireInteraction: payload.requireInteraction || false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});

// ── Sync offline (Background Sync) ─────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'viagens-edit-queue') {
    event.waitUntil(processQueue());
  }
});

async function processQueue() {
  // O processamento real fica no main thread (precisa do PAT desbloqueado).
  // Aqui só sinalizamos aos clients abertos para tentarem o flush.
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) {
    c.postMessage({ type: 'flush-edit-queue' });
  }
}

// SW pronto imediatamente
self.skipWaiting();
