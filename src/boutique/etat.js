// Sokoyetu (boutique) — état de l'application : catalogue, panier, favoris, coordonnées, commandes suivies, compte (facultatif).
import { signal, computed, batch, effect } from '@preact/signals';
import R from '../commun/js/regles.js';
import { requete, lireCatalogue, TempsReel, versLigne, Auth, prolongerSession } from '../commun/js/api.js';
import { Local, Session } from '../commun/js/stockage.js';

/* Reprise des données de l'ancienne version de la boutique (même appareil). */
(function reprendre() {
  const anciens = { cart: 'panier', favs: 'favoris', profile: 'profil', myOrders: 'mesCommandes', recent: 'recherches' };
  for (const [a, n] of Object.entries(anciens)) {
    const v = Local.lire(a, undefined);
    if (v !== undefined && Local.lire(n, undefined) === undefined) Local.ecrire(n, v);
    if (v !== undefined) Local.retirer(a);
  }
  ['db:config', 'db:products', 'db:collections', 'db:banners', 'db:discounts', 'db:orders', 'cache:config', 'cache:products', 'cache:collections', 'cache:banners', 'backend', 'pbauth', 'orderTimes', 'lastOrderSig']
    .forEach((k) => Local.retirer(k));
})();

/* ---------- Catalogue ---------- */

const VIDE = { config: null, collections: [], banners: [], products: [] };
const enCache = Local.lire('catalogue', null);
export const catalogue = signal(enCache && Array.isArray(enCache.products) ? enCache : VIDE);
export const catalogueDisponible = signal(!!enCache);   // des articles peuvent être affichés
export const catalogueAJour = signal(false);            // reçu du serveur pendant cette visite
export const horsLigne = signal(typeof navigator !== 'undefined' && navigator.onLine === false);

const parOrdre = (a, b) => (R.num(a.order) || 0) - (R.num(b.order) || 0);
export const cfg = computed(() => R.config(catalogue.value.config || {}));
export const produits = computed(() => catalogue.value.products.filter(R.estEnVente));
export const produitsParId = computed(() => new Map(produits.value.map((p) => [p.id, p])));
export const rayons = computed(() => catalogue.value.collections.filter((c) => c.visible !== false).sort(parOrdre));
export const rayonsParId = computed(() => new Map(catalogue.value.collections.map((c) => [c.id, c])));
export const bannieres = computed(() => catalogue.value.banners.filter((b) => b.active !== false).sort(parOrdre));
export const moyensPaiement = computed(() => R.moyensDePaiement(cfg.value));
/* Comptes clients : proposés seulement quand le serveur peut envoyer les codes (WhatsApp d'abord, SMS en secours). */
export const comptesOuverts = computed(() => !!(catalogue.value.config && catalogue.value.config.accounts && catalogue.value.config.accounts.open));
export const canauxCodes = computed(() => (catalogue.value.config && catalogue.value.config.accounts && catalogue.value.config.accounts.channels) || ['sms']);

function memoriser() {
  const json = JSON.stringify(catalogue.value);
  if (json.length < 2500000) Local.ecrire('catalogue', catalogue.value); else Local.retirer('catalogue');
}

let etag = Local.lire('catalogueEtag', '');
export async function chargerCatalogue() {
  try {
    const r = await lireCatalogue(enCache ? etag : '');
    if (r) {
      const d = r.donnees || {};
      batch(() => {
        catalogue.value = { config: d.config || null, collections: d.collections || [], banners: d.banners || [], products: d.products || [] };
        catalogueDisponible.value = true;
      });
      etag = r.etag; Local.ecrire('catalogueEtag', etag); memoriser();
    }
    catalogueAJour.value = true; horsLigne.value = false;
  } catch (e) {
    if (e.code === 'reseau') horsLigne.value = true;
    catalogueDisponible.value = true; // on montre ce que l'appareil a gardé
  }
}

/* Mises à jour en direct : une modification faite dans l'administration apparaît aussitôt. */
function appliquer(col, m) {
  if (!m || !m.record) return;
  const cle = col === 'config' ? 'config' : col;
  const ligne = versLigne(m.record);
  const c = catalogue.value;
  // Le paiement et les comptes ouverts viennent du serveur (catalogue), pas du document des réglages : ils sont gardés.
  if (cle === 'config') { if (m.record.id === 'store') catalogue.value = { ...c, config: m.action === 'delete' ? null : { ...ligne, payment: c.config && c.config.payment, accounts: c.config && c.config.accounts } }; }
  else {
    const autres = c[cle].filter((x) => x.id !== ligne.id);
    const garder = m.action !== 'delete' && !(col === 'products' && m.record.active === false);
    catalogue.value = { ...c, [cle]: garder ? [...autres, ligne] : autres };
  }
  memoriser();
}
export function suivreCatalogue() {
  ['config', 'collections', 'banners', 'products'].forEach((col) => TempsReel.abonner(col + '/*', (m) => appliquer(col, m)));
  TempsReel.apresReconnexion(() => { chargerCatalogue(); actualiserMesCommandes(); });
  // Un article passé en brouillon n'est pas annoncé aux visiteurs : on revérifie au retour sur la page.
  // Avec un compte, le panier et les favoris changés sur un autre appareil arrivent aussi à ce moment-là.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { chargerCatalogue(); chargerCompte(); } });
  window.addEventListener('online', () => { horsLigne.value = false; chargerCatalogue(); });
  window.addEventListener('offline', () => { horsLigne.value = true; });
}

/* ---------- Panier ---------- */

export const cleLigne = (productId, color, size) => `${productId}|${color || ''}|${size || ''}`;
function lirePanier() {
  return (Local.lire('panier', []) || []).filter((l) => l && l.productId && R.int(l.qty) > 0)
    .map((l) => ({ cle: cleLigne(l.productId, l.color, l.size), productId: l.productId, color: l.color || '', size: l.size || '', qty: Math.min(R.MAX_QTE, R.int(l.qty)) }));
}
export const panier = signal(lirePanier());
const sauverPanier = () => Local.ecrire('panier', panier.value);
export const nbArticles = computed(() => panier.value.reduce((a, l) => a + l.qty, 0));

/* Lignes du panier avec leur article ; les articles retirés de la vente sont écartés une fois le catalogue à jour. */
export const lignesPanier = computed(() => {
  const m = produitsParId.value;
  return panier.value.map((l) => ({ ...l, p: m.get(l.productId) || null })).filter((l) => l.p || !catalogueAJour.value);
});
export function nettoyerPanier() {
  if (!catalogueAJour.value) return;
  const m = produitsParId.value;
  const garde = panier.value.filter((l) => m.has(l.productId));
  if (garde.length !== panier.value.length) { panier.value = garde; sauverPanier(); }
}

export function quantiteDansPanier(productId, color, size) {
  const l = panier.value.find((x) => x.cle === cleLigne(productId, color, size));
  return l ? l.qty : 0;
}
export function ajouterAuPanier(p, color, size, qty) {
  const cle = cleLigne(p.id, color, size);
  const ex = panier.value.find((l) => l.cle === cle);
  panier.value = ex ? panier.value.map((l) => (l.cle === cle ? { ...l, qty: Math.min(R.MAX_QTE, l.qty + qty) } : l))
    : [...panier.value, { cle, productId: p.id, color: color || '', size: size || '', qty: Math.min(R.MAX_QTE, qty) }];
  sauverPanier();
}
export function changerQuantite(cle, qty) {
  panier.value = qty <= 0 ? panier.value.filter((l) => l.cle !== cle) : panier.value.map((l) => (l.cle === cle ? { ...l, qty: Math.min(R.MAX_QTE, qty) } : l));
  sauverPanier();
}
export function viderPanier() { panier.value = []; sauverPanier(); }

/* ---------- Favoris, coordonnées, recherches ---------- */

export const favoris = signal(new Set(Local.lire('favoris', [])));
export function basculerFavori(id) {
  const s = new Set(favoris.value); const ajoute = !s.has(id);
  if (ajoute) s.add(id); else s.delete(id);
  favoris.value = s; Local.ecrire('favoris', [...s]);
  return ajoute;
}
export const profil = signal(Local.lire('profil', {}) || {});
export function enregistrerProfil(p) { profil.value = { ...profil.value, ...p }; Local.ecrire('profil', profil.value); }
export const recherches = signal(Local.lire('recherches', []) || []);
export function memoriserRecherche(q) {
  q = String(q || '').trim(); if (q.length < 2) return;
  recherches.value = [q, ...recherches.value.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  Local.ecrire('recherches', recherches.value);
}
export function effacerRecherches() { recherches.value = []; Local.ecrire('recherches', []); }

/* ---------- Commandes passées depuis cet appareil ---------- */

const jetonsValides = (l) => (Array.isArray(l) ? l : []).filter((x) => x && R.valider.identifiant(x.id) && R.valider.jeton(x.t));
export const suivis = signal(jetonsValides(Local.lire('mesCommandes', [])));
export const commandes = signal(new Map());   // id → document de commande
export const commandesChargees = signal(false);
const desabonnements = new Map();

export function suivreCommande(id, t) {
  if (!R.valider.identifiant(id) || !R.valider.jeton(t)) return false;
  suivis.value = [{ id, t }, ...suivis.value.filter((x) => x.id !== id)].slice(0, 60);
  Local.ecrire('mesCommandes', suivis.value);
  chargerCommande(id, t);
  return true;
}
export const jetonDe = (id) => (suivis.value.find((x) => x.id === id) || {}).t || '';

function poserCommande(id, doc) {
  const m = new Map(commandes.value);
  if (doc) m.set(id, { ...doc, id }); else m.delete(id);
  commandes.value = m;
}
async function chargerCommande(id, t) {
  try {
    const r = await requete(`collections/orders/records/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`);
    poserCommande(id, versLigne(r));
  } catch (e) {
    if (e.status === 404) { suivis.value = suivis.value.filter((x) => x.id !== id); Local.ecrire('mesCommandes', suivis.value); poserCommande(id, null); }
  }
  if (!desabonnements.has(id)) {
    const sujet = `orders/${id}?options=${encodeURIComponent(JSON.stringify({ query: { t } }))}`;
    desabonnements.set(id, TempsReel.abonner(sujet, (m) => { if (m.record) poserCommande(id, versLigne(m.record)); }));
  }
}
export async function actualiserMesCommandes() {
  await Promise.all(suivis.value.map((x) => chargerCommande(x.id, x.t)));
  commandesChargees.value = true;
}
export function recevoirCommande(id, doc) { poserCommande(id, doc); }

/* Commande passée sur un autre téléphone (ou historique effacé) : retrouvée avec son numéro et le téléphone du client. */
export async function retrouverCommande(numero, tel) {
  const r = await requete('sokoyetu/retrouver', { method: 'POST', corps: { numero, telephone: tel } });
  suivreCommande(r.id, r.token);
  return r.id;
}

/* Paiement non abouti : les articles de la commande reviennent dans le panier (ceux encore en vente). */
export function remettreAuPanier(o) {
  const m = produitsParId.value; let n = 0;
  (o.items || []).forEach((i) => { const p = m.get(i.productId); if (p) { ajouterAuPanier(p, i.color, i.size, R.int(i.qty) || 1); n++; } });
  return n;
}

export function effacerAppareil() {
  Auth.effacer(); Local.retirer('compteModifie');
  ['panier', 'favoris', 'profil', 'recherches', 'mesCommandes', 'consentement', 'installMasque', 'commandeEnCours', 'visiteur'].forEach((k) => Local.retirer(k));
  desabonnements.forEach((f) => f()); desabonnements.clear();
  batch(() => { client.value = null; panier.value = []; favoris.value = new Set(); profil.value = {}; recherches.value = []; suivis.value = []; commandes.value = new Map(); });
}

/* ---------- Compte client (facultatif) : connexion par code (WhatsApp ou SMS), panier, favoris et commandes sur tous les appareils ---------- */

Auth.utiliserCle('compte');
const session = Auth.charger();
export const client = signal(session && session.record && session.record.collectionName === 'clients' ? { id: session.record.id, phone: session.record.phone, name: session.record.name } : null);
export const connecte = computed(() => !!client.value);
/* « Continuer sans compte » : choisi une fois par visite, la question n'est pas reposée. */
export const sansCompte = signal(!!Session.lire('sansCompte', false));
export function continuerSansCompte() { sansCompte.value = true; Session.ecrire('sansCompte', true); }

let appliquant = false;
/* Le compte reçu du serveur devient l'état de l'appareil (panier, favoris, coordonnées). */
function appliquerCompte(c) {
  if (!c) return;
  const d = R.docCompte(c.doc);
  appliquant = true;
  batch(() => {
    client.value = { id: c.id, phone: c.phone, name: c.name };
    panier.value = d.panier.map((l) => ({ cle: cleLigne(l.productId, l.color, l.size), ...l }));
    favoris.value = new Set(d.favoris);
    const p = { ...profil.value };
    Object.keys(d.profil).forEach((k) => { if (d.profil[k]) p[k] = d.profil[k]; });
    if (c.name) p.name = c.name;
    if (!p.phone) p.phone = c.phone;
    profil.value = p;
  });
  Local.ecrire('panier', panier.value); Local.ecrire('favoris', [...favoris.value]); Local.ecrire('profil', profil.value);
  appliquant = false;
}
const suivreCommandesDuCompte = (l) => (l || []).forEach((x) => { if (!suivis.value.some((y) => y.id === x.id)) suivreCommande(x.id, x.t); });
const etatAppareil = () => ({
  panier: panier.value.map(({ productId, color, size, qty }) => ({ productId, color, size, qty })),
  favoris: [...favoris.value],
  profil: R.profilCompte(profil.value)
});

// Le temps réel est lié à la session : il repart avec la nouvelle (sinon le serveur refuse les abonnements).
function deconnecteLocalement() { Auth.effacer(); client.value = null; Local.retirer('compteModifie'); TempsReel.redemarrer(); }
async function appelCompte(chemin, opts) {
  try { return await requete(chemin, opts); }
  catch (e) { if (e.status === 401) deconnecteLocalement(); throw e; }
}

/* Ouverture de la boutique, retour sur la page : le compte est relu (ce qui a changé ici hors connexion part d'abord). */
let chargement = null;
export function chargerCompte() {
  if (!Auth.compte || chargement) return chargement;
  chargement = (async () => {
    try {
      if (Auth.expireBientot) await prolongerSession('clients').catch(() => { });
      if (Local.lire('compteModifie', false)) await envoyerCompte();
      const r = await appelCompte('sokoyetu/compte');
      if (!Local.lire('compteModifie', false)) appliquerCompte(r.compte);
      suivreCommandesDuCompte(r.commandes);
    } catch (e) { /* hors connexion : l'appareil garde sa copie */ }
    finally { chargement = null; }
  })();
  return chargement;
}

export const demanderCode = (telephone, canal) => requete('sokoyetu/compte/code', { method: 'POST', corps: { telephone, canal } });
/* Code validé : connecté pour 90 jours ; ce qui avait été mis de côté sur cet appareil rejoint le compte. */
export async function validerCode(telephone, code, nom) {
  const r = await requete('sokoyetu/compte/connexion', { method: 'POST', corps: { telephone, code, name: nom || profil.value.name || '', ...etatAppareil() } });
  Auth.enregistrer({ token: r.token, record: { id: r.record.id, collectionName: 'clients', phone: r.record.phone, name: r.record.name } });
  Local.retirer('compteModifie'); TempsReel.redemarrer();
  appliquerCompte(r.meta.compte);
  suivreCommandesDuCompte(r.meta.commandes);
  return r.meta.compte;
}
export async function nommerCompte(nom) {
  const r = await appelCompte('sokoyetu/compte', { method: 'POST', corps: { name: nom } });
  appliquerCompte(r.compte);
}
export function seDeconnecterCompte() {
  // Appareil prêté ou partagé : le panier, les favoris et les commandes du compte n'y restent pas (ils sont dans le compte).
  deconnecteLocalement();
  ['panier', 'favoris', 'profil', 'mesCommandes', 'commandeEnCours'].forEach((k) => Local.retirer(k));
  desabonnements.forEach((f) => f()); desabonnements.clear();
  batch(() => { panier.value = []; favoris.value = new Set(); profil.value = {}; suivis.value = []; commandes.value = new Map(); });
}
export async function supprimerCompte() {
  await appelCompte('sokoyetu/compte/supprimer', { method: 'POST', corps: {} });
  deconnecteLocalement();
}

/* Panier, favoris ou coordonnées changés sur cet appareil : envoyés au compte (regroupés, une seconde après le dernier changement). */
let minuteurEnvoi = 0;
async function envoyerCompte() {
  if (!Auth.compte) return;
  const r = await appelCompte('sokoyetu/compte', { method: 'POST', corps: { ...etatAppareil(), name: profil.value.name || undefined } });
  Local.retirer('compteModifie');
  if (r && r.compte) client.value = { id: r.compte.id, phone: r.compte.phone, name: r.compte.name };
}
export function synchroniserCompte() {
  if (synchroniserCompte.fait) return; synchroniserCompte.fait = true;
  let premier = true;
  effect(() => {
    panier.value; favoris.value; profil.value;
    if (premier) { premier = false; return; }
    if (appliquant || !client.peek()) return;
    Local.ecrire('compteModifie', true);
    clearTimeout(minuteurEnvoi);
    minuteurEnvoi = setTimeout(() => envoyerCompte().catch(() => { }), 1000);
  });
  window.addEventListener('online', () => { if (Local.lire('compteModifie', false)) envoyerCompte().catch(() => { }); });
  chargerCompte();
}
