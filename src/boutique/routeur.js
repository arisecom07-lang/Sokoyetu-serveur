// Sokoyetu (boutique) — navigation : vraies adresses (/p/…, /c/…, /panier), boutons Retour et Suivant, défilement restauré.
import { signal } from '@preact/signals';
import { feuilleOuverte, fermerTout } from '../commun/js/interface.jsx';

/* Démo hors serveur : adresses dans le fragment (#/p/…), car aucun serveur ne renvoie la page pour /p/…. */
const HASH = typeof __DEMO__ !== 'undefined' && __DEMO__;

const ROUTES = [
  ['/', 'accueil'], ['/categories', 'rayons'], ['/nouveautes', 'nouveautes'], ['/c/:id/:slug?', 'rayon'], ['/p/:id/:slug?', 'produit'],
  ['/recherche', 'recherche'], ['/favoris', 'favoris'], ['/panier', 'panier'], ['/commander', 'commander'], ['/paiement/:id', 'paiement'], ['/merci/:id', 'merci'],
  ['/compte', 'compte'], ['/compte/commandes', 'commandes'], ['/compte/retrouver', 'retrouver'], ['/suivi/:id', 'suivi'], ['/infos/:page', 'infos']
].map(([motif, nom]) => {
  const cles = [];
  const re = new RegExp('^' + motif.replace(/\/:(\w+)(\?)?/g, (_, k, opt) => { cles.push(k); return opt ? '(?:/([^/]+))?' : '/([^/]+)'; }) + '/?$');
  return { nom, re, cles };
});

export function analyser(adresse) {
  const u = new URL(adresse, 'https://x');
  const chemin = u.pathname.replace(/\/index\.html$/, '/') || '/';
  for (const r of ROUTES) {
    const m = chemin.match(r.re);
    if (m) { const params = {}; r.cles.forEach((k, i) => { if (m[i + 1] != null) params[k] = decodeURIComponent(m[i + 1]); }); return { nom: r.nom, params, query: u.searchParams, chemin, cle: chemin + u.search }; }
  }
  return { nom: 'introuvable', params: {}, query: u.searchParams, chemin, cle: chemin + u.search };
}

const adresseActuelle = () => (HASH ? (location.hash.replace(/^#/, '') || '/') : location.pathname + location.search);
/* Lien interne : « /p/abc/robe » (ou « #/p/abc/robe » dans la démo). */
export const lien = (chemin) => (HASH ? '#' + chemin : chemin);

export const route = signal(analyser(adresseActuelle()));
export const sens = signal('');  // 'avant' | 'arriere' | '' (animation des pages)

try { history.scrollRestoration = 'manual'; } catch (e) { }
let profondeur = (history.state && history.state.sky) || 0;

function noterDefilement() {
  try { history.replaceState({ ...(history.state || {}), sky: profondeur, y: window.scrollY }, ''); } catch (e) { }
}

/* Transition animée entre deux pages quand le navigateur la propose (sinon simple apparition). */
let transitionEnCours = null;
function changer(maj) {
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduit || document.hidden) { maj(); return; }
  try { transitionEnCours && transitionEnCours.skipTransition(); } catch (e) { }
  try {
    const t = document.startViewTransition(async () => { maj(); await new Promise((r) => setTimeout(r, 0)); });
    transitionEnCours = t;
    // Une transition interrompue (rotation de l'écran, clic rapide) n'est pas une erreur : la page s'affiche quand même.
    t.ready.catch(() => { }); if (t.updateCallbackDone) t.updateCallbackDone.catch(() => { });
    t.finished.catch(() => { }).finally(() => { transitionEnCours = null; document.querySelectorAll('[style*="view-transition-name"]').forEach((el) => { el.style.viewTransitionName = ''; }); });
  } catch (e) { maj(); }
}

export function naviguer(chemin, { remplacer = false, garderDefilement = false } = {}) {
  if (!chemin) return;
  const cible = analyser(chemin);
  if (cible.cle === route.value.cle && !remplacer) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  noterDefilement();
  const url = HASH ? '#' + chemin : chemin;
  try {
    if (remplacer) history.replaceState({ sky: profondeur, y: 0 }, '', url);
    else { profondeur++; history.pushState({ sky: profondeur, y: 0 }, '', url); }
  } catch (e) { location.href = url; return; }
  changer(() => { sens.value = remplacer ? '' : 'avant'; route.value = cible; });
  if (!garderDefilement) window.scrollTo(0, 0);
}

export function retour(repli = '/') {
  if (profondeur > 0 && history.length > 1) history.back(); else naviguer(repli, { remplacer: true });
}

window.addEventListener('popstate', (e) => {
  // Le bouton Retour du téléphone ferme d'abord la fenêtre ouverte, sans quitter la page.
  if (feuilleOuverte.value) {
    fermerTout();
    try { history.pushState({ sky: profondeur, y: window.scrollY }, '', HASH ? '#' + route.value.cle : route.value.cle); profondeur++; } catch (err) { }
    return;
  }
  const s = e.state || {};
  const nouvelle = typeof s.sky === 'number' ? s.sky : 0;
  const versArriere = nouvelle < profondeur;
  profondeur = nouvelle;
  changer(() => { sens.value = versArriere ? 'arriere' : 'avant'; route.value = analyser(adresseActuelle()); });
  const y = typeof s.y === 'number' ? s.y : 0;
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
});

if (HASH) window.addEventListener('hashchange', () => { const r = analyser(adresseActuelle()); if (r.cle !== route.value.cle) route.value = r; });

/* Clics sur les liens internes : navigation sans rechargement. */
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download') || a.dataset.externe !== undefined) return;
  const href = a.getAttribute('href');
  if (HASH) { if (!href.startsWith('#/')) return; e.preventDefault(); naviguer(href.slice(1)); return; }
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || /^\/(api|_)\//.test(u.pathname) || /\.[a-z0-9]{2,5}$/i.test(u.pathname)) return;
  e.preventDefault();
  naviguer(u.pathname + u.search + u.hash);
});

/* Anciens liens partagés (#p-…, #cmd-…~jeton, #panier…) : convertis vers les nouvelles adresses. */
export function convertirAncienLien() {
  if (HASH) return null;
  let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { return null; }
  if (!h) return null;
  const simples = { panier: '/panier', categories: '/categories', nouveautes: '/nouveautes', compte: '/compte', commandes: '/compte/commandes', favoris: '/favoris', recherche: '/recherche',
    'mentions-legales': '/infos/mentions-legales', conditions: '/infos/conditions', confidentialite: '/infos/confidentialite', cookies: '/infos/cookies', retours: '/infos/retours' };
  let cible = simples[h] || null; let suivi = null;
  if (/^p-[\w.~-]+$/.test(h)) cible = '/p/' + h.slice(2);
  else if (/^c-[\w.~-]+$/.test(h)) cible = '/c/' + h.slice(2);
  else if (/^cmd-[\w-]+(~[A-Za-z0-9]+)?$/.test(h)) { const [id, t] = h.slice(4).split('~'); cible = '/suivi/' + id; if (t) suivi = { id, t }; }
  if (!cible) return null;
  history.replaceState({ sky: profondeur, y: 0 }, '', cible);
  route.value = analyser(cible);
  return suivi;
}
