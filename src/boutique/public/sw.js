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
  // Vidéos et lectures par morceaux (Range) : laissées au navigateur (une réponse partielle ne se met pas en cache).
  if (r.headers.has('range') || /\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return;

  // Photos des articles : copie locale d'abord (rapide et disponible hors connexion), 300 au plus.
  if (u.pathname.startsWith('/api/files/') || u.pathname.startsWith('/photos/')) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const deja = await c.match(r);
      if (deja) return deja;
      const res = await fetch(r);
      if (res.status === 200) c.put(r, res.clone()).then(() => limiter(PHOTOS, 300)).catch(() => { }); // mémoire pleine : tant pis
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
        if (res.ok && u.pathname === '/') { const copie = res.clone(); caches.open(VERSION).then((c) => c.put('/', copie)).catch(() => { }); }
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
    if (res.status === 200 && (u.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(u.pathname))) { const copie = res.clone(); caches.open(VERSION).then((c) => c.put(r, copie)).catch(() => { }); }
    return res;
  })));
});

/* ---------- Notifications du téléphone (gratuites) ---------- */
// Le serveur envoie un signal sans contenu ; le texte est demandé ici, au serveur de la boutique.
const cle64 = (sub, k) => { try { return btoa(String.fromCharCode(...new Uint8Array(sub.getKey(k)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch (e) { return ''; } };
async function aMontrer() {
  const sub = await self.registration.pushManager.getSubscription();
  if (!sub) return [];
  const r = await fetch('/api/sokoyetu/push/attente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint, auth: cle64(sub, 'auth') }), cache: 'no-store' });
  return r.ok ? ((await r.json()).notifications || []) : [];
}
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let l = [];
    try { l = await aMontrer(); } catch (err) { }
    const deja = await self.registration.getNotifications();
    // Le navigateur exige une notification visible à chaque signal : à défaut de texte (réseau coupé), un rappel simple.
    if (!l.length && !deja.length) l = [{ titre: 'Du nouveau pour vous', texte: 'Touchez pour voir vos notifications.', url: '/notifications', tag: 'notifications' }];
    for (const n of l) await self.registration.showNotification(n.titre, { body: n.texte, icon: '/icone-192.png', badge: '/badge-96.png', tag: n.tag, renotify: true, data: { url: n.url || '/notifications' } });
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage('notifications');
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/notifications', location.origin).href;
  e.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (new URL(c.url).origin === location.origin && 'focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url).catch(() => { }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
// Abonnement renouvelé par le navigateur : le serveur remplace l'ancien par le nouveau.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const ancien = e.oldSubscription;
    const nouveau = e.newSubscription || (ancien && await self.registration.pushManager.subscribe(ancien.options).catch(() => null));
    if (!ancien || !nouveau) return;
    await fetch('/api/sokoyetu/push/renouveler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ancien: { endpoint: ancien.endpoint, auth: cle64(ancien, 'auth') }, nouveau: nouveau.toJSON() }) }).catch(() => { });
  })());
});
