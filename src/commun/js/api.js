// Sokoyetu — client de l'API du serveur (PocketBase, même adresse que la page) et temps réel.
import { Local } from './stockage.js';

export class ErreurApi extends Error {
  constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra || {}); }
}

/* ---------- Compte connecté (administration) ---------- */

function expiration(jeton) {
  try { return JSON.parse(atob(jeton.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
}
let auth = null;
let cleAuth = 'auth';
export const Auth = {
  /* La boutique garde la session de son client sous une autre clé que l'administration. */
  utiliserCle(cle) { cleAuth = cle; },
  charger() {
    const a = Local.lire(cleAuth, null);
    auth = a && a.token && expiration(a.token) > Date.now() + 60000 ? a : null;
    if (!auth) Local.retirer(cleAuth);
    return auth;
  },
  enregistrer(a) { auth = a; Local.ecrire(cleAuth, a); },
  effacer() { auth = null; Local.retirer(cleAuth); },
  get jeton() { return auth ? auth.token : ''; },
  get compte() { return auth && auth.record ? auth.record : null; },
  get expireBientot() { return !!auth && expiration(auth.token) - Date.now() < 7 * 864e5; }
};

/* ---------- Requêtes ---------- */

export async function requete(chemin, { method = 'GET', corps, entetes = {}, delai = 25000 } = {}) {
  const h = Object.assign({}, entetes);
  if (auth && auth.token) h.Authorization = auth.token;
  let body = corps;
  if (corps !== undefined && !(corps instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(corps); }
  const ctl = new AbortController(); const minuteur = setTimeout(() => ctl.abort(), delai);
  let res;
  try { res = await fetch('/api/' + chemin, { method, headers: h, body, cache: 'no-store', signal: ctl.signal, credentials: 'same-origin' }); }
  catch (e) {
    throw new ErreurApi(0, navigator.onLine === false ? 'Pas de connexion internet. Réessayez une fois reconnecté.' : 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.', { code: 'reseau' });
  } finally { clearTimeout(minuteur); }
  if (res.status === 204 || res.status === 304) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ErreurApi(res.status, res.status === 429 ? 'Trop de demandes en peu de temps. Patientez une minute, puis réessayez.' : (j.message || `Erreur ${res.status}`),
      { code: res.status === 429 ? 'limite' : (j.code || 'http'), champ: j.champ || '', data: j.data || {} });
  }
  return j;
}

const cheminRecords = (col, id, q) => `collections/${col}/records${id ? '/' + encodeURIComponent(id) : ''}${q ? '?' + new URLSearchParams(q) : ''}`;
/* Un enregistrement → son document, avec son identifiant. */
export const versLigne = (r) => Object.assign({}, r && r.doc && typeof r.doc === 'object' ? r.doc : {}, { id: r.id });

export async function tout(col, q = {}) {
  const lignes = [];
  for (let page = 1; page < 100; page++) {
    const j = await requete(cheminRecords(col, '', Object.assign({ page, perPage: 500, skipTotal: 1 }, q)));
    (j.items || []).forEach((r) => lignes.push(versLigne(r)));
    if ((j.items || []).length < 500) break;
  }
  return lignes;
}
export const lire = async (col, id, q) => versLigne(await requete(cheminRecords(col, id, q)));
/* Crée ou remplace le document « id » de la collection. */
export async function ecrire(col, id, doc) {
  const corps = Object.assign({}, doc); delete corps.id;
  try { return versLigne(await requete(cheminRecords(col, id), { method: 'PATCH', corps: { doc: corps } })); }
  catch (e) { if (e.status !== 404) throw e; return versLigne(await requete(cheminRecords(col), { method: 'POST', corps: { id, doc: corps } })); }
}
export const supprimer = (col, id) => requete(cheminRecords(col, id), { method: 'DELETE' });

export async function connexion(email, motDePasse) {
  const r = await requete('collections/admins/auth-with-password', { method: 'POST', corps: { identity: String(email).trim().toLowerCase(), password: motDePasse } });
  Auth.enregistrer({ token: r.token, record: r.record });
  return r.record;
}
export async function prolongerSession(col = 'admins') {
  const r = await requete(`collections/${col}/auth-refresh`, { method: 'POST' });
  Auth.enregistrer({ token: r.token, record: r.record });
}
export async function changerMotDePasse(ancien, nouveau) {
  const c = Auth.compte; if (!c) throw new ErreurApi(401, 'Session expirée.');
  await requete(cheminRecords('admins', c.id), { method: 'PATCH', corps: { oldPassword: ancien, password: nouveau, passwordConfirm: nouveau } });
  await connexion(c.email, nouveau);
}

/* Catalogue public en une requête ; null si inchangé depuis la dernière fois (même empreinte). */
export async function lireCatalogue(etag) {
  let res;
  try { res = await fetch('/api/sokoyetu/catalogue', { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store' }); }
  catch (e) { throw new ErreurApi(0, 'Pas de connexion.', { code: 'reseau' }); }
  if (res.status === 304) return null;
  if (!res.ok) throw new ErreurApi(res.status, 'Catalogue indisponible.');
  return { donnees: await res.json(), etag: res.headers.get('ETag') || '' };
}

/* Photo envoyée au serveur → référence média { type: 'pb', id, f }. */
export async function envoyerPhoto(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'photo.' + (blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg'));
  const r = await requete(cheminRecords('media'), { method: 'POST', corps: fd, delai: 90000 });
  return { type: 'pb', id: r.id, f: r.file };
}
/* Courte vidéo d'un article (MP4 ou WebM, envoyée telle quelle) → { type: 'pb', id, f, video: true }. */
export async function envoyerVideo(fichier) {
  const fd = new FormData();
  fd.append('file', fichier, 'video.' + (fichier.type === 'video/webm' ? 'webm' : fichier.type === 'video/quicktime' ? 'mov' : 'mp4'));
  const r = await requete(cheminRecords('media'), { method: 'POST', corps: fd, delai: 300000 });
  return { type: 'pb', id: r.id, f: r.file, video: true };
}
export const urlFichierServeur = (m, miniature) => `/api/files/media/${encodeURIComponent(m.id)}/${encodeURIComponent(m.f)}${miniature ? '?thumb=' + miniature : ''}`;

/* ---------- Temps réel (une seule connexion pour tous les abonnements) ---------- */

export const TempsReel = (() => {
  let es = null, clientId = '', connexions = 0, minuteur = 0;
  const abonnes = new Map();          // sujet → Set(fonction)
  const lies = new Set();             // sujets déjà écoutés sur la connexion actuelle
  const apresReconnexion = new Set(); // fonctions appelées pour rattraper les changements manqués

  function lier() {
    if (!es) return;
    for (const sujet of abonnes.keys()) {
      if (lies.has(sujet)) continue;
      lies.add(sujet);
      es.addEventListener(sujet, (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        (abonnes.get(sujet) || []).forEach((fn) => { try { fn(m); } catch (e) { console.warn(e); } });
      });
    }
  }
  function synchroniser() {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      if (!clientId) return;
      requete('realtime', { method: 'POST', corps: { clientId, subscriptions: [...abonnes.keys()] } }).then(lier).catch((e) => console.warn('temps réel', e));
    }, 60);
  }
  function connecter() {
    if (typeof EventSource === 'undefined') return;
    try { es && es.close(); } catch (e) { }
    lies.clear(); clientId = '';
    es = new EventSource('/api/realtime');
    es.addEventListener('PB_CONNECT', (ev) => {
      try { clientId = JSON.parse(ev.data).clientId; } catch (e) { return; }
      // Reconnexion automatique du navigateur : même objet EventSource, écouteurs déjà en place ; seul l'abonnement est à refaire.
      synchroniser();
      if (connexions++) apresReconnexion.forEach((fn) => fn());
    });
  }
  const relancer = () => { if (abonnes.size && (!es || es.readyState === 2)) connecter(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') relancer(); });
  window.addEventListener('online', relancer);

  return {
    abonner(sujet, fn) {
      if (!abonnes.has(sujet)) abonnes.set(sujet, new Set());
      abonnes.get(sujet).add(fn);
      if (!es || es.readyState === 2) connecter(); else synchroniser();
      return () => {
        const s = abonnes.get(sujet); if (!s) return;
        s.delete(fn); if (!s.size) { abonnes.delete(sujet); synchroniser(); }
      };
    },
    apresReconnexion(fn) { apresReconnexion.add(fn); return () => apresReconnexion.delete(fn); },
    redemarrer() { if (abonnes.size) connecter(); }
  };
})();

export const DEMO = false;
