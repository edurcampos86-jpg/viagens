// Stub do Service Worker antigo — redireciona para o SW v2 (Workbox).
// Mantido para compatibilidade com manifest.webmanifest e instalações
// existentes. Ao detectar uma versão antiga, expira e desregistra.
//
// O SW novo está em src/pwa/sw-workbox.js e é registrado por src/main.js.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches antigos
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('viagens-v')).map((k) => caches.delete(k)));
      // Self-destroy: o cliente vai re-registrar o SW novo via src/main.js
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.navigate(c.url);
    })()
  );
});
