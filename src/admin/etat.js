// Sokoyetu (administration) — session, données de la boutique, temps réel et actions envoyées au serveur.
import { signal, computed, batch } from '@preact/signals';
import R from '../commun/js/regles.js';
import { Auth, connexion, prolongerSession, requete, tout, lire, ecrire, supprimer, TempsReel, versLigne, envoyerPhoto, DEMO } from '../commun/js/api.js';
import { toast } from '../commun/js/interface.jsx';
import { urlMedia } from '../commun/js/medias.jsx';
import { empreinteCarte, fabriquerCarte, LARGEUR, HAUTEUR } from './carte-partage.js';

export const compte = signal(Auth.charger() ? Auth.compte : null);
/* Rôle dans l'équipe (propriétaire, vendeur, livreur) : le serveur contrôle chaque action, l'administration masque le reste. */
export const role = computed(() => R.roleNettoye(compte.value && compte.value.role));
export const peut = (droit) => R.peut(role.value, droit);
export const pret = signal(false);          // données chargées
export const erreurChargement = signal(''); // premier chargement impossible : message affiché avec « Réessayer »
// Santé du serveur (sauvegardes, paiement, erreurs) : lue à l'ouverture et sur la page « Santé et journal ».
export const sante = signal(null);
export const lireSante = () => requete('sokoyetu/sante', { essais: 0 }).then((r) => { sante.value = r; return r; });
export const etatServeur = signal({ version: '', ia: false, paiement: { fournisseur: '', pret: false, test: false }, codes: { pret: false, canaux: [], test: false } });

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
/* Livreur : commandes payées à livrer, pas encore remises au client. */
export const aLivrer = computed(() => donnees.value.orders.filter((o) => R.pourLivreur(o) && o.fulfillment !== 'delivered').length);

/* Comptes clients (facultatifs) : panier, favoris et coordonnées gardés par le serveur. */
export const comptes = signal([]);
const versCompte = (r) => ({ id: r.id, phone: r.phone || '', name: r.name || '', created: Date.parse(String(r.created || '').replace(' ', 'T')) || 0, seen: R.num(r.seen), relance: R.num(r.relance), ...R.docCompte(r.doc) });

/* Clients : déduits des commandes (une fiche par numéro de téléphone), plus les comptes qui n'ont pas encore commandé. */
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
  for (const a of comptes.value) {
    const k = R.chiffres(a.phone); if (!k) continue;
    const c = m.get(k) || { tel: k, affiche: a.phone, nom: '', commandes: [], depense: 0, derniere: 0, zone: '' };
    c.compte = a; if (a.name) c.nom = c.nom || a.name;
    m.set(k, c);
  }
  // Tri : dernière activité (commande, ou passage sur la boutique avec son compte).
  const activite = (c) => Math.max(c.derniere, (c.compte && c.compte.seen) || 0);
  return [...m.values()].sort((a, b) => activite(b) - activite(a));
});

/* ---------- Chargement et temps réel ---------- */

const COLLECTIONS = ['config', 'collections', 'banners', 'products', 'discounts', 'orders'];
/* Collections lues selon le rôle : le livreur ne reçoit que les commandes à livrer, les codes promo restent au propriétaire. */
const DROIT_COLLECTION = { collections: 'catalogue', banners: 'catalogue', products: 'produits', discounts: 'remises', orders: 'commandes' };
const lisible = (c) => !DROIT_COLLECTION[c] || peut(DROIT_COLLECTION[c]) || (c === 'orders' && peut('livraisons'));
function poser(col, ligne, retirer) {
  const d = donnees.value;
  if (col === 'config') { if (ligne.id === 'store') donnees.value = { ...d, config: retirer ? null : ligne }; return; }
  const autres = d[col].filter((x) => x.id !== ligne.id);
  donnees.value = { ...d, [col]: retirer ? autres : [...autres, ligne] };
}

let surNouvelleCommande = () => { };
export function quandNouvelleCommande(fn) { surNouvelleCommande = fn; }

/*
 * Charge toutes les données. Une liste qui n'arrive pas (réseau, serveur) n'est jamais remplacée par une liste vide :
 * au premier chargement, l'écran affiche l'erreur et « Réessayer » ; ensuite, les données déjà affichées restent.
 */
export async function charger() {
  const echecs = [];
  const res = await Promise.all(COLLECTIONS.map((c) => (!lisible(c) ? Promise.resolve([]) : tout(c, c === 'orders' ? { sort: '-created' } : {}).catch((e) => {
    if (e.status === 401) throw e;
    if (e.status === 404 || e.status === 403) return []; // collection absente (ancienne version du serveur) ou réservée à un autre rôle
    echecs.push(e); return null;
  }))));
  if (echecs.length && !pret.value) throw echecs[0];
  if (peut('clients')) chargerComptes();
  if (peut('messages')) chargerDiscussions();
  if (peut('avis')) chargerAvis();
  batch(() => {
    const avant = donnees.value; const d = {};
    COLLECTIONS.forEach((c, i) => { d[c] = res[i] || (c === 'config' ? null : avant[c]); });
    donnees.value = { config: d.config ? d.config.find((x) => x.id === 'store') || null : avant.config, collections: d.collections, banners: d.banners, products: d.products, discounts: d.discounts, orders: d.orders };
    pret.value = true; erreurChargement.value = '';
  });
  requete('sokoyetu/etat').then((e) => { etatServeur.value = e || etatServeur.value; }).catch(() => { });
  lireSante().catch(() => { });
  if (echecs.length) throw echecs[0];
}

/* Ouverture de l'administration : les données, puis le temps réel. Sans connexion : message, et nouvel essai dès son retour. */
export async function demarrer() {
  try {
    await charger();
    erreurChargement.value = '';
    suivreEnDirect();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { seDeconnecter(); return; }
    erreurChargement.value = e.code === 'reseau' ? e.message : 'Le serveur n’a pas pu envoyer les données de la boutique. Réessayez dans un instant.';
    if (!attenteReseau) { attenteReseau = true; window.addEventListener('online', () => { attenteReseau = false; if (!pret.value) demarrer(); }, { once: true }); }
  }
}
let attenteReseau = false;

/* Après une coupure du temps réel : on recharge (nouvel essai plus tard si le réseau est encore instable). */
let relance = 0;
function recharger(essai = 0) {
  clearTimeout(relance);
  charger().catch((e) => {
    if (e.status === 401 || e.status === 403 || essai >= 3) return;
    relance = setTimeout(() => recharger(essai + 1), [10, 30, 90][essai] * 1000);
  });
}

async function chargerComptes() {
  const l = [];
  try {
    for (let page = 1; page < 100; page++) {
      const j = await requete(`collections/clients/records?page=${page}&perPage=500&skipTotal=1`);
      (j.items || []).forEach((r) => l.push(versCompte(r)));
      if ((j.items || []).length < 500) break;
    }
    comptes.value = l;
  } catch (e) { /* serveur sans comptes clients (ancienne version) */ }
}

let suivi = false;
export function suivreEnDirect() {
  if (suivi) return; suivi = true;
  // Un client met un article au panier ou en favori, crée son compte : l'administration le voit aussitôt.
  if (peut('clients')) TempsReel.abonner('clients/*', (m) => {
    if (!m || !m.record) return;
    const autres = comptes.value.filter((c) => c.id !== m.record.id);
    comptes.value = m.action === 'delete' ? autres : [...autres, versCompte(m.record)];
  });
  // Un client écrit à la boutique : la liste des messages suit, et l'équipe est prévenue (toast, carillon).
  if (peut('messages')) TempsReel.abonner('discussions/*', (m) => {
    if (!m || !m.record) return;
    const d = versDiscussion(m.record); const avant = discussions.value.find((x) => x.id === d.id);
    const autres = discussions.value.filter((x) => x.id !== d.id);
    discussions.value = m.action === 'delete' ? autres : [d, ...autres].sort((a, b) => b.maj - a.maj);
    if (m.action !== 'delete' && d.auteur === 'client' && d.maj > ((avant && avant.maj) || 0)) surNouveauMessage(d);
  });
  // Un client donne son avis : la liste suit, et l'équipe le voit passer (toast).
  if (peut('avis')) TempsReel.abonner('avis/*', (m) => {
    if (!m || !m.record) return;
    const a = versAvis(m.record);
    const autres = avis.value.filter((x) => x.id !== a.id);
    avis.value = m.action === 'delete' ? autres : [a, ...autres].sort((x, y) => y.cree - x.cree);
    if (m.action === 'create') surNouvelAvis(a);
  });
  COLLECTIONS.filter(lisible).forEach((col) => TempsReel.abonner(col + '/*', (m) => {
    if (!m || !m.record) return;
    const ligne = versLigne(m.record);
    // Alerte quand une commande vient d'être payée (confirmée par l'opérateur), pas quand le client commence à payer.
    const avant = col === 'orders' ? donnees.value.orders.find((o) => o.id === ligne.id) : null;
    const payee = col === 'orders' && m.action !== 'delete' && R.estPayee(ligne) && !(avant && R.estPayee(avant)) && !(ligne.payment && ligne.payment.manual);
    // Le client a payé deux fois la même commande : le vendeur doit le rembourser (Commandes → Points à vérifier).
    const double = col === 'orders' && m.action !== 'delete' && R.doublonARembourser(ligne) && ((ligne.payment.duplicates || []).length > ((avant && avant.payment && avant.payment.duplicates) || []).length);
    poser(col, ligne, m.action === 'delete');
    if (payee) surNouvelleCommande(ligne);
    if (double) toast(`Commande #${ligne.number} payée deux fois : remboursez le client`, { icone: 'alerte', ton: 'danger', duree: 9000 });
  }));
  TempsReel.apresReconnexion(() => recharger());
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
 * Image d'aperçu des liens partagés (logo de la boutique et photo principale de l'article), montrée par WhatsApp ou Facebook.
 * Refaite seulement quand la photo principale ou la boutique (nom, slogan, villes) a changé. Si elle ne peut pas être faite
 * (pas de connexion, photo illisible), l'article est enregistré quand même : le lien partagé montre alors la photo seule.
 */
async function carteProduit(d) {
  const m = R.imagePrincipale(d);
  if (DEMO || !m || (m.type !== 'pb' && m.type !== 'url')) return null;
  const sig = empreinteCarte(m, cfg.value);
  if (d.share && d.share.sig === sig) return d.share;
  try {
    const delai = new Promise((_, ko) => setTimeout(() => ko(new Error('Image d’aperçu trop longue à envoyer')), 20000));
    const r = await Promise.race([fabriquerCarte(urlMedia(m), cfg.value).then(envoyerPhoto), delai]);
    return { ...r, w: LARGEUR, h: HAUTEUR, sig };
  } catch (e) { console.warn('Image d’aperçu non créée', e); return null; }
}

/*
 * Enregistre un produit sans écraser ce qui a changé entre-temps sur le serveur (commandes passées pendant la modification) :
 * le stock d'une variante n'est remplacé que si vous l'avez modifié ; le nombre de ventes vient toujours du serveur.
 */
export async function sauverProduit(id, doc, initial) {
  const d = { ...doc };
  const carte = await carteProduit(d);
  if (carte) d.share = carte; else delete d.share;
  let frais = null;
  if (initial) { try { frais = await lire('products', id); } catch (e) { if (e.status !== 404) throw e; } }
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
/* ---------- Équipe (propriétaire) : comptes de l'administration et leurs rôles ---------- */

export const lireEquipe = () => requete('sokoyetu/equipe').then((r) => r.membres || []);
export const ajouterMembre = (d) => requete('sokoyetu/equipe', { method: 'POST', corps: d });
export const modifierMembre = (id, d) => requete('sokoyetu/equipe/' + encodeURIComponent(id), { method: 'POST', corps: d });
export const retirerMembre = (id) => requete('sokoyetu/equipe/' + encodeURIComponent(id), { method: 'DELETE' });

/* ---------- Messages des clients : une discussion par client (propriétaire et vendeurs, droit « messages ») ---------- */

export const discussions = signal([]);
/* Discussions où le client attend une réponse (pastille du menu, tableau de bord). */
export const aRepondre = computed(() => discussions.value.filter((d) => d.a_repondre).length);
const versDiscussion = (r) => ({
  id: r.id, client: r.client || '', nom: r.nom || '', telephone: r.telephone || '', dernier: r.dernier || '', auteur: r.auteur || '',
  maj: R.num(r.maj), non_lus: R.num(r.non_lus), a_repondre: !!r.a_repondre, lu_client: R.num(r.lu_client), lu_boutique: R.num(r.lu_boutique)
});
async function chargerDiscussions() {
  try {
    const j = await requete('collections/discussions/records?sort=-maj&perPage=500&skipTotal=1');
    discussions.value = (j.items || []).map(versDiscussion);
  } catch (e) { /* serveur sans discussions (ancienne version) */ }
}
let surNouveauMessage = () => { };
export function quandNouveauMessage(fn) { surNouveauMessage = fn; }
/* Résumé renvoyé par le serveur (réponse, lecture) : la liste suit sans attendre le temps réel. */
function poserDiscussion(d) {
  if (!d || !d.id) return;
  discussions.value = [versDiscussion(d), ...discussions.value.filter((x) => x.id !== d.id)].sort((a, b) => b.maj - a.maj);
}
/* { discussion, messages, commandes } : messages après « apres » (identifiant du dernier message déjà affiché). */
export const lireDiscussion = (id, apres) => requete(`sokoyetu/discussions/${encodeURIComponent(id)}${apres ? '?apres=' + apres : ''}`, )
  .then((r) => { poserDiscussion(r.discussion); return r; });
export const repondreDiscussion = (id, m) => requete(`sokoyetu/discussions/${encodeURIComponent(id)}`, { method: 'POST', corps: m })
  .then((r) => { poserDiscussion(r.discussion); return r; });
export const marquerDiscussion = (id, action) => requete(`sokoyetu/discussions/${encodeURIComponent(id)}`, { method: 'POST', corps: { action } })
  .then((r) => { poserDiscussion(r.discussion); return r; });
export async function supprimerDiscussion(id) {
  await requete(`sokoyetu/discussions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  discussions.value = discussions.value.filter((x) => x.id !== id);
}

/* ---------- Avis des clients sur les articles (propriétaire et vendeurs, droit « avis ») ---------- */

export const avis = signal([]);
/* Avis qui attendent la vérification de la boutique (pastille du menu, tableau de bord). */
export const avisAVerifier = computed(() => avis.value.filter((a) => a.etat === 'attente').length);
const versAvis = (r) => ({
  id: r.id, produit: r.produit || '', commande: r.commande || '', numero: r.numero || '', telephone: r.telephone || '', client: r.client || '', nom: r.nom || '',
  note: R.num(r.note), texte: r.texte || '', variante: r.variante || '', etat: r.etat || 'publie', motif: r.motif || '',
  reponse: r.reponse || '', reponse_par: r.reponse_par || '', reponse_le: R.num(r.reponse_le || r.reponseLe), cree: R.num(r.cree), maj: R.num(r.maj)
});
async function chargerAvis() {
  try {
    const j = await requete('collections/avis/records?sort=-cree&perPage=500&skipTotal=1');
    avis.value = (j.items || []).map(versAvis);
  } catch (e) { /* serveur sans avis (ancienne version) */ }
}
let surNouvelAvis = () => { };
export function quandNouvelAvis(fn) { surNouvelAvis = fn; }
/* { action: 'publier' } ; { action: 'masquer', motif } ; { reponse } ('' la retire). La liste suit sans attendre le temps réel. */
export async function modererAvis(id, corps) {
  const r = await requete(`sokoyetu/avis/${encodeURIComponent(id)}`, { method: 'POST', corps });
  if (r && r.avis) avis.value = [versAvis(r.avis), ...avis.value.filter((x) => x.id !== id)].sort((x, y) => y.cree - x.cree);
  return r && r.avis;
}

/* ---------- Clients qui attendent un article épuisé (« Prévenez-moi »), annonces aux clients (propriétaire) ---------- */

/* { produit: { total, variantes: { 'Rouge|M': 2 } } } : relu à chaque ouverture des produits. */
export const attentes = signal({});
export const chargerAttentes = () => requete('sokoyetu/alertes/attente', { essais: 0 }).then((r) => { attentes.value = (r && r.produits) || {}; }).catch(() => { });
export const lireAnnonces = () => requete('sokoyetu/annonces');
export const envoyerAnnonce = (a) => requete('sokoyetu/annonces', { method: 'POST', corps: a });

/* Cagnotte d'un client (téléphone) : solde, gains, filleuls ; offrir : geste de la boutique (propriétaire), une fois par jeton. */
export const cagnotteClient = (tel) => requete(`sokoyetu/clients/${encodeURIComponent(tel)}/cagnotte`);
export const offrirCagnotte = (tel, { montant, motif, jeton }) => requete(`sokoyetu/clients/${encodeURIComponent(tel)}/cagnotte`, { method: 'POST', corps: { montant, motif, jeton } });

export async function effacerClient(tel) {
  const r = await requete('sokoyetu/clients/effacer', { method: 'POST', corps: { phone: tel } });
  await charger().catch(() => { }); // l'effacement est fait ; les fiches se mettent à jour en direct si la relecture échoue
  return r;
}
export async function ficheIA(image, mediaType, hint) {
  const c = cfg.value;
  return requete('sokoyetu/ia/produit', { method: 'POST', delai: 100000, corps: { image, mediaType, hint, shop: c.name, city: c.city, collections: rayons.value.map((x) => ({ id: x.id, name: x.name })) } });
}

/* Import depuis un fournisseur : lecture de la page (et fiche rédigée par l'assistant si ia), copie d'une photo par son adresse. */
/* Import en masse : le serveur limite le nombre de demandes par minute ; on patiente puis on reprend au lieu d'abandonner. */
async function patienter(fn) {
  for (let essai = 0; ; essai++) {
    try { return await fn(); } catch (e) { if (e.code !== 'limite' || essai >= 6) throw e; await new Promise((r) => setTimeout(r, 10000)); }
  }
}
export async function lireFournisseur(url, ia, hint) {
  const c = cfg.value;
  return patienter(() => requete('sokoyetu/import/lien', { method: 'POST', delai: 120000, corps: { url, ia: !!ia, hint, shop: c.name, city: c.city, collections: rayons.value.map((x) => ({ id: x.id, name: x.name })) } }));
}
export const copierPhoto = (url) => patienter(() => requete('sokoyetu/import/photo', { method: 'POST', delai: 60000, corps: { url } }));
/* Photo ajoutée à une fiche : l'assistant renvoie le cadre de l'article ({ cadre } en millièmes, ou { cadre: null }).
   Plusieurs photos d'un coup peuvent dépasser la limite de demandes à l'assistant : on patiente, comme pour l'import. */
export const cadreIA = (image, mediaType, hint) => patienter(() => requete('sokoyetu/ia/cadre', { method: 'POST', delai: 60000, corps: { image, mediaType, hint } }));

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

/* ---------- Fréquentation de la boutique (compteurs anonymes tenus par le serveur) ---------- */

export const lireAudience = (jours, graphe = 7) => requete(`sokoyetu/audience?jours=${jours}&graphe=${graphe}`);
export const lireAudienceArticle = (id, jours, graphe = 7) => requete(`sokoyetu/audience/${encodeURIComponent(id)}?jours=${jours}&graphe=${graphe}`);
