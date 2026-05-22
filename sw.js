// Stub do Service Worker antigo — redireciona para o SW v2 (Workbox).
// Mantido para compatibilidade com manifest.webmanifest e instalações
// existentes. Ao detectar uma versão antiga, expira e desregistra.
//
// O SW novo está em src/pwa/sw-workbox.js e é registrado por src/main.js.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith('viagens-v')).map((k) => caches.delete(k)));
        await self.registration.unregister();
      } catch (err) {
        // Se algo falhar (Safari antigo, sem permissao de cache, etc.) preferimos
        // deixar o SW antigo ativo e tentar de novo na proxima visita do que
        // navegar com SW indefinido. Loga e sai cedo.
        console.warn('[sw stub] migration failed; keeping legacy SW for now:', err);
        return;
      }
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const c of clients) c.navigate(c.url);
      } catch (err) {
        console.warn('[sw stub] post-unregister navigate failed:', err);
      }
    })()
  );
});
