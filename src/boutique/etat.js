// Sokoyetu (boutique) — état de l'application : catalogue, panier, favoris, coordonnées, commandes suivies, compte (facultatif).
import { signal, computed, batch, effect } from '@preact/signals';
import R from '../commun/js/regles.js';
import { requete, lireCatalogue, TempsReel, versLigne, Auth, prolongerSession } from '../commun/js/api.js';
import { Local, Session } from '../commun/js/stockage.js';
import RS from '../commun/js/recherche.js';

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
export const catalogueErreur = signal('');              // premier chargement impossible et rien de gardé sur l'appareil

const parOrdre = (a, b) => (R.num(a.order) || 0) - (R.num(b.order) || 0);
export const cfg = computed(() => R.config(catalogue.value.config || {}));
export const produits = computed(() => catalogue.value.products.filter(R.estEnVente));
export const produitsParId = computed(() => new Map(produits.value.map((p) => [p.id, p])));
export const rayons = computed(() => catalogue.value.collections.filter((c) => c.visible !== false).sort(parOrdre));
export const rayonsParId = computed(() => new Map(catalogue.value.collections.map((c) => [c.id, c])));
export const bannieres = computed(() => catalogue.value.banners.filter((b) => b.active !== false).sort(parOrdre));
export const moyensPaiement = computed(() => R.moyensDePaiement(cfg.value));
/* La boutique accepte la carte Visa / Mastercard (en plus du Mobile Money). */
export const carteAcceptee = computed(() => moyensPaiement.value.some((m) => m.carte));
/* Comptes clients : proposés seulement quand le serveur peut envoyer les codes (WhatsApp d'abord, SMS en secours). */
export const comptesOuverts = computed(() => !!(catalogue.value.config && catalogue.value.config.accounts && catalogue.value.config.accounts.open));
export const canauxCodes = computed(() => (catalogue.value.config && catalogue.value.config.accounts && catalogue.value.config.accounts.channels) || ['sms']);

function memoriser() {
  const json = JSON.stringify(catalogue.value);
  if (json.length < 2500000) Local.ecrire('catalogue', catalogue.value); else Local.retirer('catalogue');
}

let etag = Local.lire('catalogueEtag', '');
let reprise = 0; let essai = 0;
/*
 * Catalogue : la copie gardée sur l'appareil s'affiche tout de suite, puis la version du serveur la remplace.
 * Si le serveur ne répond pas, la copie reste affichée (bandeau « hors connexion ») ; s'il n'y en a pas, un message
 * « Réessayer » remplace le chargement. Nouvel essai automatique après 5 s, 15 s, 45 s, puis chaque minute,
 * et dès que le téléphone retrouve sa connexion.
 */
export async function chargerCatalogue() {
  clearTimeout(reprise);
  try {
    const r = await lireCatalogue(catalogueDisponible.value ? etag : '');
    if (r) {
      const d = r.donnees || {};
      batch(() => {
        catalogue.value = { config: d.config || null, collections: d.collections || [], banners: d.banners || [], products: d.products || [] };
        catalogueDisponible.value = true;
      });
      etag = r.etag; Local.ecrire('catalogueEtag', etag); memoriser();
    }
    batch(() => { catalogueAJour.value = true; horsLigne.value = false; catalogueErreur.value = ''; });
    essai = 0;
    return true;
  } catch (e) {
    horsLigne.value = e.code === 'reseau' && !!enCache;
    if (!catalogueDisponible.value) catalogueErreur.value = e.code === 'reseau' ? (navigator.onLine === false ? 'Pas de connexion internet.' : 'Le serveur ne répond pas.') : 'La boutique est momentanément indisponible.';
    reprise = setTimeout(chargerCatalogue, [5000, 15000, 45000][essai++] || 60000);
    return false;
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
    // La note des avis vient du catalogue (le serveur la calcule), pas de l'article : elle est gardée.
    const ancien = col === 'products' ? c.products.find((x) => x.id === ligne.id) : null;
    if (ancien && ancien.avis && !ligne.avis) ligne.avis = ancien.avis;
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
export const nbArticles = computed(() => panier.value.reduce((a, l) => a + l.qty, 0));

/* Choix des articles à commander maintenant (cases à cocher du panier). On garde les lignes décochées :
   un article qui arrive dans le panier est donc coché d'office, et les autres attendent la prochaine commande.
   Ce choix reste sur l'appareil (le compte ne garde que le contenu du panier). */
export const decoches = signal(new Set(Local.lire('panierDecoches', []) || []));
function sauverDecoches() { Local.ecrire('panierDecoches', [...decoches.value]); }
function sauverPanier() {
  Local.ecrire('panier', panier.value);
  const cles = new Set(panier.value.map((l) => l.cle));
  if ([...decoches.value].some((k) => !cles.has(k))) { decoches.value = new Set([...decoches.value].filter((k) => cles.has(k))); sauverDecoches(); }
}
export const aCommander = computed(() => panier.value.filter((l) => !decoches.value.has(l.cle)));
export const nbACommander = computed(() => aCommander.value.reduce((a, l) => a + l.qty, 0));
export function cocherLigne(cle, coche) {
  const s = new Set(decoches.value);
  if (coche) s.delete(cle); else s.add(cle);
  decoches.value = s; sauverDecoches();
}
/* Coche exactement les lignes retenues par « garder » (toutes, seulement Bukavu, seulement l'import…). */
export function cocherSeulement(garder) {
  decoches.value = new Set(panier.value.filter((l) => !garder(l)).map((l) => l.cle)); sauverDecoches();
}

/* Lignes du panier avec leur article ; les articles retirés de la vente sont écartés une fois le catalogue à jour. */
export const lignesPanier = computed(() => {
  const m = produitsParId.value; const d = decoches.value;
  return panier.value.map((l) => ({ ...l, p: m.get(l.productId) || null, coche: !d.has(l.cle) })).filter((l) => l.p || !catalogueAJour.value);
});
export const lignesACommander = computed(() => lignesPanier.value.filter((l) => l.coche));
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
  if (decoches.value.has(cle)) cocherLigne(cle, true); // remis ou ajouté de nouveau : on le veut
}
export function changerQuantite(cle, qty) {
  panier.value = qty <= 0 ? panier.value.filter((l) => l.cle !== cle) : panier.value.map((l) => (l.cle === cle ? { ...l, qty: Math.min(R.MAX_QTE, qty) } : l));
  sauverPanier();
}
/*
 * Panier partagé : ses articles rejoignent le panier, cochés. Un article déjà présent garde la plus grande des deux quantités
 * (ouvrir deux fois le même lien ne double rien) ; un article en stock à Bukavu est borné à ce qui reste.
 * Renvoie le nombre de pièces de ces articles maintenant dans le panier.
 */
export function mettreDansLePanier(lignes) {
  const m = produitsParId.value; let liste = panier.value; let n = 0; const cles = new Set();
  for (const l of lignes) {
    const p = m.get(l.productId); if (!p) continue;
    const max = R.estImport(p) ? R.MAX_QTE : Math.min(R.MAX_QTE, R.stockDe(p, l.color, l.size));
    const q = Math.min(max, R.int(l.qty)); if (q <= 0) continue;
    const cle = cleLigne(p.id, l.color, l.size); cles.add(cle);
    const ex = liste.find((x) => x.cle === cle);
    if (ex) { if (q > ex.qty) liste = liste.map((x) => (x.cle === cle ? { ...x, qty: q } : x)); n += Math.max(q, ex.qty); }
    else { liste = [...liste, { cle, productId: p.id, color: l.color || '', size: l.size || '', qty: q }]; n += q; }
  }
  panier.value = liste; sauverPanier();
  if ([...decoches.value].some((k) => cles.has(k))) { decoches.value = new Set([...decoches.value].filter((k) => !cles.has(k))); sauverDecoches(); }
  return n;
}
/* Commande passée : seuls les articles cochés quittent le panier, les autres y restent, cochés pour la prochaine commande. */
export function retirerCommandes(items) {
  const parties = new Set(items.map((l) => cleLigne(l.productId, l.color, l.size)));
  batch(() => { panier.value = panier.value.filter((l) => !parties.has(l.cle)); decoches.value = new Set(); });
  sauverPanier(); sauverDecoches();
}

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

/* ---------- Recherche : index du catalogue (refait quand il change) et recherches populaires des clients ---------- */

export const indexRecherche = computed(() => {
  const m = rayonsParId.value;
  return RS.indexer(produits.value, (p) => (p.collectionIds || []).map((id) => (m.get(id) || {}).name));
});
export const recherchesPopulaires = signal([]);
let populairesLues = false;
/* Lues une fois par visite, à l'ouverture de la recherche (le navigateur les garde une heure). */
export async function chargerPopulaires() {
  if (populairesLues) return; populairesLues = true;
  try { const r = await requete('sokoyetu/recherches', { essais: 0 }); recherchesPopulaires.value = Array.isArray(r && r.termes) ? r.termes.map(String) : []; }
  catch (e) { populairesLues = false; }
}

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
  ['panier', 'panierDecoches', 'favoris', 'profil', 'recherches', 'mesCommandes', 'consentement', 'installMasque', 'commandeEnCours', 'visiteur'].forEach((k) => Local.retirer(k));
  desabonnements.forEach((f) => f()); desabonnements.clear();
  batch(() => { client.value = null; panier.value = []; decoches.value = new Set(); favoris.value = new Set(); profil.value = {}; recherches.value = []; suivis.value = []; commandes.value = new Map(); });
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
  ['panier', 'panierDecoches', 'favoris', 'profil', 'mesCommandes', 'commandeEnCours'].forEach((k) => Local.retirer(k));
  desabonnements.forEach((f) => f()); desabonnements.clear();
  batch(() => { decoches.value = new Set(); panier.value = []; favoris.value = new Set(); profil.value = {}; suivis.value = []; commandes.value = new Map(); });
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
