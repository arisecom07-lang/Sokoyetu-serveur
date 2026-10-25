// Sokoyetu (administration) — session, données de la boutique, temps réel et actions envoyées au serveur.
import { signal, computed, batch } from '@preact/signals';
import R from '../commun/js/regles.js';
import { Auth, connexion, prolongerSession, requete, tout, lire, ecrire, supprimer, TempsReel, versLigne } from '../commun/js/api.js';
import { toast } from '../commun/js/interface.jsx';

export const compte = signal(Auth.charger() ? Auth.compte : null);
export const pret = signal(false);          // données chargées
export const etatServeur = signal({ version: '', ia: false, paiement: { fournisseur: '', pret: false, test: false } });

export const donnees = signal({ config: null, collections: [], banners: [], products: [], discounts: [], orders: [] });
// Le fournisseur de paiement se règle sur le serveur (paiement.sh) : l'administration le lit dans l'état du serveur.
export const paiementServeur = computed(() => etatServeur.value.paiement || { fournisseur: '', pret: false, test: false });
export const cfg = computed(() => {
  const c = donnees.value.config || {}; const p = paiementServeur.value;
  return R.config({ ...c, payment: { ...(c.payment || {}), provider: p.pret ? p.fournisseur : '' } });
});
const parOrdre = (a, b) => (R.num(a.order) || 0) - (R.num(b.order) || 0);
export const produits = computed(() => [...donnees.value.products].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));
export const rayons = computed(() => [...donnees.value.collections].sort(parOrdre));
export const bannieres = computed(() => [...donnees.value.banners].sort(parOrdre));
export const remises = computed(() => [...donnees.value.discounts].sort((a, b) => String(a.code).localeCompare(String(b.code))));
export const commandes = computed(() => [...donnees.value.orders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
export const produitsParId = computed(() => new Map(donnees.value.products.map((p) => [p.id, p])));
export const aTraiter = computed(() => donnees.value.orders.filter(R.aTraiter).length);

/* Clients : déduits des commandes (une fiche par numéro de téléphone). */
export const clients = computed(() => {
  const m = new Map();
  for (const o of donnees.value.orders) {
    const k = o.phone || R.chiffres(o.customer && o.customer.phone); if (!k) continue;
    const c = m.get(k) || { tel: k, affiche: (o.customer && o.customer.phone) || k, nom: '', commandes: [], depense: 0, derniere: 0, zone: '' };
    c.commandes.push(o);
    if (o.status !== 'cancelled' && R.estPayee(o)) c.depense += R.num(o.total);
    if ((o.createdAt || 0) >= c.derniere) { c.derniere = o.createdAt || 0; c.nom = (o.customer && o.customer.name) || c.nom; c.zone = (o.shipping && o.shipping.zoneName) || c.zone; c.affiche = (o.customer && o.customer.phone) || c.affiche; }
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => b.derniere - a.derniere);
});

/* ---------- Chargement et temps réel ---------- */

const COLLECTIONS = ['config', 'collections', 'banners', 'products', 'discounts', 'orders'];
function poser(col, ligne, retirer) {
  const d = donnees.value;
  if (col === 'config') { if (ligne.id === 'store') donnees.value = { ...d, config: retirer ? null : ligne }; return; }
  const autres = d[col].filter((x) => x.id !== ligne.id);
  donnees.value = { ...d, [col]: retirer ? autres : [...autres, ligne] };
}

let surNouvelleCommande = () => { };
export function quandNouvelleCommande(fn) { surNouvelleCommande = fn; }

export async function charger() {
  const res = await Promise.all(COLLECTIONS.map((c) => tout(c, c === 'orders' ? { sort: '-created' } : {}).catch((e) => { if (e.status === 401 || e.status === 403) throw e; return []; })));
  batch(() => {
    const d = {}; COLLECTIONS.forEach((c, i) => { d[c] = res[i]; });
    donnees.value = { config: d.config.find((x) => x.id === 'store') || null, collections: d.collections, banners: d.banners, products: d.products, discounts: d.discounts, orders: d.orders };
    pret.value = true;
  });
  requete('sokoyetu/etat').then((e) => { etatServeur.value = e || etatServeur.value; }).catch(() => { });
}

let suivi = false;
export function suivreEnDirect() {
  if (suivi) return; suivi = true;
  COLLECTIONS.forEach((col) => TempsReel.abonner(col + '/*', (m) => {
    if (!m || !m.record) return;
    const ligne = versLigne(m.record);
    // Alerte quand une commande vient d'être payée (confirmée par l'opérateur), pas quand le client commence à payer.
    const avant = col === 'orders' ? donnees.value.orders.find((o) => o.id === ligne.id) : null;
    const payee = col === 'orders' && m.action !== 'delete' && R.estPayee(ligne) && !(avant && R.estPayee(avant)) && !(ligne.payment && ligne.payment.manual);
    poser(col, ligne, m.action === 'delete');
    if (payee) surNouvelleCommande(ligne);
  }));
  TempsReel.apresReconnexion(() => charger().catch(() => { }));
}

export async function seConnecter(email, mdp) {
  const r = await connexion(email, mdp);
  if (!r || r.collectionName !== 'admins') { Auth.effacer(); throw Object.assign(new Error('Ce compte n’a pas accès à l’administration.'), { status: 403 }); }
  compte.value = Auth.compte;
}
export function seDeconnecter() { Auth.effacer(); compte.value = null; location.hash = ''; location.reload(); }
export function verifierSession() {
  if (Auth.compte && Auth.expireBientot) prolongerSession().then(() => { compte.value = Auth.compte; }).catch((e) => { if ([401, 403, 404].includes(e.status)) seDeconnecter(); });
}
/* Session expirée pendant l'utilisation : retour à la connexion. */
export function gererErreur(e, message = 'Enregistrement impossible') {
  if (e && e.status === 401) { toast('Session expirée : reconnectez-vous', { icone: 'cadenas', ton: 'danger' }); setTimeout(seDeconnecter, 1200); return; }
  toast(e && e.status && e.status !== 0 && e.message ? e.message : e && e.code === 'reseau' ? 'Pas de connexion internet' : message, { icone: 'alerte', ton: 'danger', duree: 4200 });
  console.warn(e);
}

/* ---------- Écritures ---------- */

export async function sauver(col, id, doc) {
  const r = await ecrire(col, id, doc);
  poser(col, r);
  return r;
}
export async function retirer(col, id) {
  await supprimer(col, id);
  const d = donnees.value; donnees.value = { ...d, [col]: d[col].filter((x) => x.id !== id) };
}

/*
 * Enregistre un produit sans écraser ce qui a changé entre-temps sur le serveur (commandes passées pendant la modification) :
 * le stock d'une variante n'est remplacé que si vous l'avez modifié ; le nombre de ventes vient toujours du serveur.
 */
export async function sauverProduit(id, doc, initial) {
  let frais = null;
  if (initial) { try { frais = await lire('products', id); } catch (e) { if (e.status !== 404) throw e; } }
  const d = { ...doc };
  if (frais && initial) {
    d.sold = R.int(frais.sold);
    if (!R.aDesOptions(d) && R.int(d.stock) === R.int(initial.stock)) d.stock = R.int(frais.stock);
    if (R.aDesOptions(d)) {
      const v = { ...(d.variants || {}) };
      for (const k of Object.keys(v)) if (R.int(v[k]) === R.int((initial.variants || {})[k]) && frais.variants && k in frais.variants) v[k] = R.int(frais.variants[k]);
      d.variants = v;
    }
  }
  return sauver('products', id, d);
}

export async function etapeCommande(id, action, note) {
  const r = await requete(`sokoyetu/commandes/${encodeURIComponent(id)}`, { method: 'POST', corps: { action, note } });
  poser('orders', versLigne(r));
  return r;
}
export async function effacerClient(tel) {
  const r = await requete('sokoyetu/clients/effacer', { method: 'POST', corps: { phone: tel } });
  await charger();
  return r;
}
export async function ficheIA(image, mediaType, hint) {
  const c = cfg.value;
  return requete('sokoyetu/ia/produit', { method: 'POST', delai: 100000, corps: { image, mediaType, hint, shop: c.name, city: c.city, collections: rayons.value.map((x) => ({ id: x.id, name: x.name })) } });
}

/* Catalogue d'exemple : pour découvrir la boutique avant d'ajouter ses propres articles. */
export async function chargerExemple() {
  const r = await fetch((typeof __DEMO__ !== 'undefined' && __DEMO__ ? '' : '/') + 'exemple-catalogue.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Catalogue d’exemple introuvable');
  const d = await r.json(); const now = Date.now();
  for (const k of ['collections', 'products', 'banners', 'discounts']) {
    for (const x of d[k] || []) { const { id, ageDays, ...doc } = x; if (k === 'products') doc.createdAt = now - (ageDays || 0) * 864e5; await sauver(k, id, doc); }
  }
}
export async function retirerExemples() {
  for (const k of ['products', 'collections', 'banners', 'discounts']) for (const x of donnees.value[k].filter((y) => y.demo)) await retirer(k, x.id);
}
export const nbExemples = computed(() => ['products', 'collections', 'banners', 'discounts'].reduce((a, k) => a + donnees.value[k].filter((x) => x.demo).length, 0));
