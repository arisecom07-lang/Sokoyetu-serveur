/* Sokoyetu — application de gestion installée : démarrage rapide, photos en cache, clic sur les notifications. */
const VERSION = 'sokoyetu-admin-__VERSION__';
const PHOTOS = 'sokoyetu-admin-photos';
const PRECACHE = [/*PRECACHE*/];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sokoyetu-admin-') && k !== VERSION && k !== PHOTOS) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function limiter(nom, max) {
  const c = await caches.open(nom); const cles = await c.keys();
  for (let i = 0; i < cles.length - max; i++) await c.delete(cles[i]);
}
const delai = (ms) => new Promise((_, ko) => setTimeout(() => ko(new Error('délai')), ms));

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  if (/^\/(_|\.well-known)\//.test(u.pathname)) return;

  // Photos (les miniatures ne changent jamais d'adresse) : copie locale d'abord, 400 au plus.
  if (u.pathname.startsWith('/api/files/') || u.pathname.startsWith('/photos/')) {
    if (u.searchParams.has('token')) return;
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const deja = await c.match(r);
      if (deja) return deja;
      const res = await fetch(r);
      if (res.ok) { c.put(r, res.clone()); limiter(PHOTOS, 400); }
      return res;
    }));
    return;
  }
  // Données et temps réel : jamais en cache.
  if (u.pathname.startsWith('/api/')) return;

  // Page : le réseau d'abord (4 s au plus), sinon la dernière version gardée.
  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(r), delai(4000)]);
        if (res.ok) { const copie = res.clone(); caches.open(VERSION).then((c) => c.put('/', copie)); }
        return res;
      } catch (err) {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }
  // Fichiers de l'application (noms uniques par version).
  e.respondWith(caches.match(r, { ignoreSearch: u.pathname.startsWith('/assets/') }).then((deja) => deja || fetch(r).then((res) => {
    if (res.ok && (u.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(u.pathname))) { const copie = res.clone(); caches.open(VERSION).then((c) => c.put(r, copie)); }
    return res;
  })));
});

// Toucher une notification « Commande payée » ouvre (ou ramène) l'application sur cette commande.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenetres) {
      if (new URL(f.url).origin === location.origin) { await f.focus(); f.postMessage({ url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
