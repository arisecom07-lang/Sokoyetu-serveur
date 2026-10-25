/* Sokoyetu — fonctionnement hors connexion et mises à jour de l'application installée (boutique). */
const VERSION = 'sokoyetu-__VERSION__';
const PHOTOS = 'sokoyetu-photos';
const PRECACHE = [/*PRECACHE*/];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sokoyetu-') && k !== VERSION && k !== PHOTOS) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

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

  // Photos des articles : copie locale d'abord (rapide et disponible hors connexion), 300 au plus.
  if (u.pathname.startsWith('/api/files/') || u.pathname.startsWith('/photos/')) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const deja = await c.match(r);
      if (deja) return deja;
      const res = await fetch(r);
      if (res.ok) { c.put(r, res.clone()); limiter(PHOTOS, 300); }
      return res;
    }));
    return;
  }
  // Données : toujours depuis le serveur (la boutique garde sa propre copie du catalogue).
  if (u.pathname.startsWith('/api/')) return;

  // Pages : le réseau d'abord (3,5 s au plus), puis la dernière version gardée, puis la page « hors connexion ».
  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(r), delai(3500)]);
        if (res.ok && u.pathname === '/') { const copie = res.clone(); caches.open(VERSION).then((c) => c.put('/', copie)); }
        return res;
      } catch (err) {
        const c = await caches.open(VERSION);
        return (await c.match('/')) || (await c.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }
  // Fichiers de l'application (noms uniques par version) : copie locale d'abord.
  e.respondWith(caches.match(r, { ignoreSearch: u.pathname.startsWith('/assets/') }).then((deja) => deja || fetch(r).then((res) => {
    if (res.ok && (u.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(u.pathname))) { const copie = res.clone(); caches.open(VERSION).then((c) => c.put(r, copie)); }
    return res;
  })));
});
