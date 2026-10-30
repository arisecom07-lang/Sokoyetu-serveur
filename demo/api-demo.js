// Sokoyetu — démonstration sans serveur : remplace src/commun/js/api.js à la construction (npm run demo).
// Le « serveur » vit dans le navigateur (localStorage), applique les mêmes règles métier que le vrai
// (regles.js : devis, commandes, paiement, stock, étapes, réductions) et prévient en direct les autres onglets
// ouverts sur la démo : une commande payée dans la boutique apparaît aussitôt dans l'administration.
// Paiement en mode test, comme SOKOYETU_PAIEMENT=simulation : confirmé après quelques secondes, refusé si le numéro finit par 0000.
// Comptes clients en mode test, comme SOKOYETU_WHATSAPP=simulation : le code de connexion s'affiche à l'écran.
import R from '../src/commun/js/regles.js';
import { Local } from '../src/commun/js/stockage.js';
import EXEMPLE from '../src/admin/public/exemple-catalogue.json';

export const DEMO = true;
const VERSION_BASE = 8;
const DELAI_PAIEMENT = 5000;
const CLE = 'sokoyetu-demo:base';
const CLE_MEDIA = 'sokoyetu-demo:media:';
const COMPTE = { id: 'demo-gerant', email: 'demo@sokoyetu.com', collectionName: 'admins', collectionId: 'admins' };
const JOUR = 864e5;
const pause = (ms = 160) => new Promise((ok) => setTimeout(ok, ms));
const uid = () => Array.from({ length: 15 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const jeton = () => Array.from({ length: 40 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

export class ErreurApi extends Error {
  constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra || {}); }
}

/* ---------- Base de données de la démo ---------- */

const CONFIG_DEMO = {
  name: 'Sokoyetu', city: 'Bukavu', whatsapp: '0991234567', ownerName: 'Messir', setup: { livraison: true },
  payments: { mpesa: { enabled: true }, airtel: { enabled: true }, orange: { enabled: true }, afrimoney: { enabled: false }, illico: { enabled: false } },
  serviceFeePct: 2, payment: { holdMinutes: 30 },
  // Identité d'exemple : aucune société ni numéro d'immatriculation inventés (la boutique se présente sous son nom).
  legal: { company: '', address: 'av. Patrice Lumumba n° 12, Ibanda, Bukavu (adresse d’exemple)', email: 'contact@sokoyakwetu.com' }
};
// [nom, téléphone, zone, adresse, articles, opérateur, paiement (payé, refusé, jamais reçu), étapes, âge en jours]
const CLIENTS = [
  ['Grâce Mapendo', '0991234501', 'bukavu', 'Nyawera, av. Lumumba 12', [{ productId: 'ex-p08', size: 'L', qty: 2 }, { productId: 'ex-p17', qty: 1 }], 'mpesa', 'paye', ['preparing', 'shipped', 'delivered'], 9],
  ['Patient Bisimwa', '0971234502', 'goma', 'Himbi, av. du Lac 4', [{ productId: 'ex-p10', qty: 1 }], 'airtel', 'paye', [], 6],
  ['Esther Furaha', '0891234503', 'bukavu', 'Ibanda, Q. Ndendere 33', [{ productId: 'ex-p05', qty: 1 }, { productId: 'ex-p13', qty: 1 }], 'orange', 'refuse', [], 0],
  ['Josué Mugisho', '0991234504', 'retrait', '', [{ productId: 'ex-p15', qty: 1 }], 'mpesa', 'paye', ['preparing', 'shipped'], 2],
  ['Chantal Neema', '0971234505', 'bukavu', 'Kadutu, av. Industrielle 8', [{ productId: 'ex-p01', size: 'M', qty: 1 }, { productId: 'ex-p04', qty: 1 }], 'airtel', 'paye', ['preparing'], 1],
  ['Didier Kambale', '0821234506', 'goma', 'Katindo, av. Mapendo 21', [{ productId: 'ex-p18', qty: 2 }], 'mpesa', 'echu', [], 3]
];
// [nom, téléphone, panier, favoris, dernière visite (heures)]
const COMPTES = [
  ['Grâce Mapendo', '0991234501', [{ productId: 'ex-p04', qty: 1 }], ['ex-p05', 'ex-p13'], 3],
  ['Aline Zawadi', '0971234507', [{ productId: 'ex-p05', qty: 1 }, { productId: 'ex-p13', qty: 2 }], ['ex-p10'], 30],
  ['Patient Bisimwa', '0971234502', [], ['ex-p18'], 50]
];
/* Configuration telle que le serveur la voit : paiement en mode test. */
const configPaiement = (doc) => R.config({ ...(doc || {}), payment: { ...((doc && doc.payment) || {}), provider: 'simulation' } });

function creerBase() {
  const now = Date.now();
  const b = { v: VERSION_BASE, cols: { config: {}, collections: {}, products: {}, banners: {}, discounts: {}, orders: {}, media: {}, clients: {} }, codes: {} };
  const poser = (col, id, doc, extra) => { b.cols[col][id] = { id, doc, created: now, updated: now, ...extra }; };
  poser('config', 'store', R.copie(CONFIG_DEMO));
  for (const k of ['collections', 'products', 'banners', 'discounts']) {
    for (const x of EXEMPLE[k] || []) {
      const { id, ageDays, ...doc } = R.copie(x);
      if (k === 'products') { doc.createdAt = now - (ageDays || 0) * JOUR; doc.updatedAt = now; }
      poser(k, id, doc, k === 'products' ? { active: doc.status !== 'draft' } : k === 'discounts' ? { code: R.valider.codePromo(doc.code) } : {});
    }
  }
  // Quelques commandes déjà passées, pour que le tableau de bord ait de quoi montrer.
  const cfg = configPaiement(b.cols.config.store.doc);
  const produit = (id) => (b.cols.products[id] ? b.cols.products[id].doc : null);
  CLIENTS.forEach(([name, phone, zoneId, address, items, method, mode, suites, age], i) => {
    const t = mode === 'refuse' ? now - 6 * 60000 : now - age * JOUR - (5 - i) * 3600e3;
    const dv = R.devis({ cfg, produit, lignes: items, zoneId, maintenant: t });
    const payeur = mode === 'paye' ? phone : phone.slice(0, 6) + '0000';
    const { commande, reserve } = R.preparerCommande({ cfg, produit, saisie: { termsAccepted: true, customer: { name, phone }, shipping: { zoneId, address }, items, payment: { method, phone: payeur }, total: dv.total, note: i === 1 ? 'Appelez avant de passer, merci.' : '' }, maintenant: t, numero: R.numeroCommande() });
    stock(b, reserve, -1);
    let o = R.paiementEnvoye(commande, { maintenant: t + 2000, providerId: `SIM-${commande.number}-1` });
    if (mode === 'paye') o = R.paiementConfirme(o, { maintenant: t + 45000, reference: 'TEST' + String(t).slice(-8) }).commande;
    else o = R.paiementEchoue(o, { maintenant: t + 45000, raison: 'Solde insuffisant (simulation).' });
    if (mode === 'echu') { const x = R.paiementExpire(o, { maintenant: t + 31 * 60000 }); stock(b, x.entrees, 1); o = x.commande; }
    suites.forEach((a, j) => { const r = R.etapeCommande(o, a, { maintenant: t + (j + 1) * 5400e3, produit }); o = r.commande; });
    poser('orders', 'cmd' + uid().slice(0, 12), o, { token: jeton(), phone: o.phone, status: o.status, created: t });
  });
  // Quelques clients ont créé leur compte : panier en attente, favoris (page Clients, Audience → Paniers à relancer).
  COMPTES.forEach(([name, phone, panier, favoris, heures]) => {
    const t = now - heures * 3600e3; const dates = {};
    panier.forEach((l) => { dates['panier:' + l.productId] = t; }); favoris.forEach((id) => { dates['favori:' + id] = t - 3600e3; });
    poser('clients', 'cli' + uid().slice(0, 12), R.docCompte({ panier, favoris, dates }), { phone, name, seen: t, created: t - 9 * JOUR });
  });
  return b;
}
function stock(b, entrees, sens) {
  const parProduit = {};
  for (const x of entrees || []) if (x && x.productId) (parProduit[x.productId] = parProduit[x.productId] || []).push(x);
  for (const id of Object.keys(parProduit)) {
    const rec = b.cols.products[id]; if (!rec) continue;
    rec.doc = R.ajusterStock(rec.doc, parProduit[id], sens); rec.doc.updatedAt = Date.now(); rec.updated = Date.now();
    if (sens > 0) alertesProduit(b, rec);
  }
  return Object.keys(parProduit);
}
// Copie en mémoire : la démo reste utilisable si le navigateur refuse le stockage (navigation privée stricte).
let enMemoire = null;
function base() {
  let b = null;
  try { b = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch (e) { b = enMemoire; }
  if (!b || b.v !== VERSION_BASE || !b.cols) { b = enMemoire && enMemoire.v === VERSION_BASE ? enMemoire : creerBase(); enregistrer(b); }
  return b;
}
function enregistrer(b) {
  enMemoire = b;
  try { localStorage.setItem(CLE, JSON.stringify(b)); }
  catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) throw new ErreurApi(507, 'La mémoire de la démo est pleine. Retirez quelques photos ou réinitialisez la démo depuis la page d’accueil.', { code: 'memoire' });
  }
}
// Les liens entre la boutique et l'administration restent dans la même fenêtre de la démo.
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
  if (a && new URL(a.href, location.href).origin === location.origin) a.removeAttribute('target');
}, true);

/* ---------- Ce que voient les visiteurs (comme le serveur) ---------- */

function commandePublique(doc) {
  const d = R.copie(doc);
  const aVerifier = Array.isArray(d.issues) && d.issues.length > 0;
  delete d.adminNote; delete d.issues; delete d.reserved; delete d.stockApplied; delete d.declaredTotal;
  if (d.payment) { delete d.payment.providerId; delete d.payment.checkedAt; delete d.payment.previous; delete d.payment.paidId; delete d.payment.duplicates; delete d.payment.duplicatesRefundedAt; }
  (d.items || []).forEach((i) => { delete i.cost; delete i.available; });
  d.review = aVerifier && d.status !== 'cancelled' && !(d.payment && d.payment.status === 'paid');
  return d;
}
function produitPublic(doc) { const d = R.copie(doc); delete d.cost; delete d.supplier; return d; }
function vue(col, rec, gerant) {
  if (!rec) return null;
  const r = { id: rec.id, collectionId: col, collectionName: col, created: new Date(rec.created).toISOString(), updated: new Date(rec.updated).toISOString(), doc: R.copie(rec.doc) };
  if (col === 'products') r.active = rec.active !== false;
  if (col === 'media') r.file = rec.file;
  if (col === 'clients') Object.assign(r, { phone: rec.phone, name: rec.name, seen: rec.seen, relance: rec.relance || 0, created: new Date(rec.created).toISOString().replace('T', ' ') });
  if (!gerant) { if (col === 'products') r.doc = produitPublic(rec.doc); if (col === 'orders') r.doc = commandePublique(rec.doc); }
  else if (roleActuel() === 'livreur') { if (col === 'products') r.doc = produitPublic(rec.doc); if (col === 'orders') r.doc = { ...commandePublique(rec.doc), adminNote: rec.doc.adminNote || '' }; }
  // Comme le serveur : la boutique apprend quel paiement est ouvert (ici, le mode test).
  if (col === 'config') { const c = configPaiement(rec.doc); r.doc.payment = { provider: 'simulation', holdMinutes: c.payment.holdMinutes, test: true }; r.doc.accounts = { open: true, test: true, channels: ['whatsapp', 'sms'] }; }
  return r;
}
const remiseParCode = (b, code) => { const c = R.valider.codePromo(code); const rec = c && Object.values(b.cols.discounts).find((x) => x.code === c); return rec ? rec.doc : null; };

/* ---------- Compte de démonstration ---------- */

const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fauxJeton = () => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: COMPTE.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })}.demo`;
function expiration(j) { try { return JSON.parse(atob(j.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; } }
let auth = null;
let cleAuth = 'auth';
export const Auth = {
  utiliserCle(cle) { cleAuth = cle; },
  charger() { const a = Local.lire(cleAuth, null); auth = a && a.token && expiration(a.token) > Date.now() + 60000 ? a : null; if (!auth) Local.retirer(cleAuth); return auth; },
  enregistrer(a) { auth = a; Local.ecrire(cleAuth, a); },
  effacer() { auth = null; Local.retirer(cleAuth); },
  get jeton() { return auth ? auth.token : ''; },
  get compte() { return auth && auth.record ? auth.record : null; },
  get expireBientot() { return false; }
};
const gerant = () => !!auth && !!auth.record && auth.record.collectionName === 'admins';
/* Rôle dans l'équipe : dans la démo, il se choisit par l'e-mail de connexion (livreur@…, vendeur@…, sinon propriétaire). */
const roleActuel = () => (gerant() ? R.roleNettoye(auth.record.role) : '');
const roleDeEmail = (email) => (/^livreur/i.test(email) ? 'livreur' : /^vendeu/i.test(email) ? 'vendeur' : 'proprietaire');
/* L'équipe de la démo : le propriétaire et deux membres d'exemple. */
function equipe(b) {
  if (!Array.isArray(b.equipe)) {
    const t = Date.now() - 20 * JOUR;
    b.equipe = [
      { id: COMPTE.id, email: COMPTE.email, name: 'Messir', role: 'proprietaire', created: t },
      { id: 'demo-vendeur', email: 'vendeur@sokoyetu.com', name: 'Neema Furaha', role: 'vendeur', created: t + 2 * JOUR },
      { id: 'demo-livreur', email: 'livreur@sokoyetu.com', name: 'Patrick Mulumba', role: 'livreur', created: t + 5 * JOUR }
    ];
  }
  return b.equipe;
}
const vueMembre = (m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, created: new Date(m.created).toISOString().replace('T', ' ') });
/* Client connecté à son compte (boutique), sinon null. */
const clientConnecte = (b) => (auth && auth.record && auth.record.collectionName === 'clients' ? b.cols.clients[auth.record.id] || null : null);
const jetonClient = (id) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id, exp: Math.floor(Date.now() / 1000) + 90 * 86400 })}.demo`;
const vueCompte = (rec) => ({ id: rec.id, phone: rec.phone, name: rec.name, created: new Date(rec.created).toISOString(), doc: R.docCompte(rec.doc) });
const commandesDuCompte = (b, rec) => Object.values(b.cols.orders).filter((o) => o.client === rec.id || (o.phone && o.phone === R.chiffres(rec.phone))).sort((x, y) => y.created - x.created).map((o) => ({ id: o.id, t: o.token }));
function exigerGerant(droit) {
  if (!gerant()) throw new ErreurApi(403, 'Réservé à l’administration de la boutique.');
  if (droit && !R.peut(roleActuel(), droit)) throw new ErreurApi(403, 'Votre rôle dans l’équipe ne permet pas cette action.');
  return roleActuel();
}

/* ---------- Temps réel entre les onglets de la démo ---------- */

const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sokoyetu-demo') : null;
const abonnes = new Map();
function diffuser(col, id, action, avant) {
  const m = { col, id, action, avant: avant ? R.copie(avant) : null };
  if (canal) canal.postMessage(m);
  setTimeout(() => recevoir(m), 0);
}
function recevoir({ col, id, action, avant }) {
  const b = base(); const rec = b.cols[col] && b.cols[col][id];
  for (const [sujet, fns] of abonnes) {
    const [chemin, options] = sujet.split('?');
    const [c, cible] = chemin.split('/');
    if (c !== col || (cible !== '*' && cible !== id)) continue;
    let message;
    if (gerant()) {
      if (col === 'media') continue;
      message = { action, record: action === 'delete' ? { id, ...(avant ? vue(col, avant, true) : {}) } : vue(col, rec, true) };
    } else {
      if (col === 'discounts' || col === 'media' || col === 'clients') continue;
      if (col === 'orders') {
        let t = ''; try { t = JSON.parse(decodeURIComponent((options || '').replace(/^options=/, ''))).query.t; } catch (e) { }
        if (cible === '*' || !rec || !t || rec.token !== t) continue;
      }
      message = { action, record: action === 'delete' ? { id } : vue(col, rec, false) };
    }
    fns.forEach((fn) => { try { fn(message); } catch (e) { console.warn(e); } });
  }
}
if (canal) canal.onmessage = (ev) => recevoir(ev.data);

export const TempsReel = {
  abonner(sujet, fn) {
    if (!abonnes.has(sujet)) abonnes.set(sujet, new Set());
    abonnes.get(sujet).add(fn);
    return () => { const s = abonnes.get(sujet); if (s) { s.delete(fn); if (!s.size) abonnes.delete(sujet); } };
  },
  apresReconnexion() { return () => { }; },
  redemarrer() { }
};

/* ---------- Le « serveur » ---------- */

/* Droits de lecture et d'écriture des collections selon le rôle (comme les règles de la migration « équipe »). */
const DROIT_ECRITURE = { config: 'reglages', collections: 'catalogue', banners: 'catalogue', products: 'produits', discounts: 'remises', media: 'produits' };
function routeRecords(b, col, id, method, corps, q) {
  const table = b.cols[col]; if (!table) throw new ErreurApi(404, 'Collection inconnue.');
  const lecturePublique = ['config', 'collections', 'banners', 'products'].includes(col);
  const role = roleActuel();
  if (role && ((col === 'discounts' && !R.peut(role, 'remises')) || (col === 'clients' && !R.peut(role, 'clients')))) throw new ErreurApi(403, 'Votre rôle dans l’équipe ne permet pas cette action.');
  if (col === 'clients' && method !== 'GET') throw new ErreurApi(403, 'Les comptes se modifient par la boutique.');
  if (col === 'clients' && id && !gerant()) throw new ErreurApi(404, 'Introuvable.');
  if (method === 'GET' && !id) {
    if (!lecturePublique && !gerant()) return { items: [], page: 1, perPage: 500 };
    let l = Object.values(table);
    if (col === 'products' && !gerant()) l = l.filter((x) => x.active !== false);
    if (col === 'orders' && role === 'livreur') l = l.filter((x) => R.pourLivreur(x.doc));
    if (q.get('sort') === '-created') l.sort((x, y) => y.created - x.created);
    const page = Number(q.get('page') || 1), par = Number(q.get('perPage') || 500);
    return { items: l.slice((page - 1) * par, page * par).map((x) => vue(col, x, gerant())), page, perPage: par };
  }
  if (method === 'GET') {
    const rec = table[id];
    if (!rec) throw new ErreurApi(404, 'Introuvable.');
    if (col === 'orders' && !gerant() && rec.token !== q.get('t')) throw new ErreurApi(404, 'Introuvable.');
    if (col === 'orders' && role === 'livreur' && !R.pourLivreur(rec.doc)) throw new ErreurApi(404, 'Introuvable.');
    if ((col === 'discounts' || col === 'media') && !gerant()) throw new ErreurApi(404, 'Introuvable.');
    if (col === 'products' && !gerant() && rec.active === false) throw new ErreurApi(404, 'Introuvable.');
    return vue(col, rec, gerant());
  }
  exigerGerant(DROIT_ECRITURE[col]);
  // Comme sur le serveur : une commande ne change que par les routes de paiement et d'étapes.
  if (col === 'orders') throw new ErreurApi(403, 'Les commandes se modifient par leurs étapes.');
  const now = Date.now();
  if (method === 'DELETE') {
    const avant = table[id]; if (!avant) throw new ErreurApi(404, 'Introuvable.');
    delete table[id];
    if (col === 'products') b.alertes = (b.alertes || []).filter((x) => x.produit !== id);
    enregistrer(b);
    if (col === 'media') try { localStorage.removeItem(CLE_MEDIA + id); } catch (e) { }
    diffuser(col, id, 'delete', avant); return null;
  }
  const nouveau = method === 'POST';
  const rid = nouveau ? (corps && corps.id) || uid() : id;
  if (nouveau && table[rid]) throw new ErreurApi(400, 'Cet identifiant existe déjà.');
  if (!nouveau && !table[rid]) throw new ErreurApi(404, 'Introuvable.');
  const doc = R.copie((corps && corps.doc) || {});
  const rec = nouveau ? { id: rid, created: now } : table[rid];
  if (col === 'products') { if (!doc.createdAt) doc.createdAt = (rec.doc && rec.doc.createdAt) || now; doc.updatedAt = now; rec.active = doc.status !== 'draft'; }
  if (col === 'discounts') rec.code = R.valider.codePromo(doc.code);
  rec.doc = doc; rec.updated = now; table[rid] = rec;
  if (col === 'products' && !nouveau) alertesProduit(b, rec);
  enregistrer(b); diffuser(col, rid, nouveau ? 'create' : 'update');
  return vue(col, rec, true);
}

async function serveur(chemin, method, corps) {
  const [p, qs] = chemin.split('?'); const q = new URLSearchParams(qs || '');
  const b = base();
  let m;
  if (p === 'collections/admins/auth-with-password') {
    if (!corps || !String(corps.identity || '').includes('@') || !corps.password) throw new ErreurApi(400, 'E-mail ou mot de passe incorrect.');
    const email = String(corps.identity).trim().toLowerCase();
    const membre = equipe(b).find((x) => x.email === email);
    return { token: fauxJeton(), record: membre ? { ...COMPTE, id: membre.id, email, name: membre.name, role: membre.role } : { ...COMPTE, email, role: roleDeEmail(email) } };
  }
  if (p === 'collections/admins/auth-refresh') { exigerGerant(); return { token: fauxJeton(), record: Auth.compte }; }
  if (p === 'collections/clients/auth-refresh') { const c = clientConnecte(b); if (!c) throw new ErreurApi(401, 'Connectez-vous à votre compte.'); return { token: jetonClient(c.id), record: { id: c.id, collectionName: 'clients', phone: c.phone, name: c.name } }; }
  if ((m = p.match(/^collections\/admins\/records\/(.+)$/))) { exigerGerant(); return Auth.compte; }
  if ((m = p.match(/^collections\/([a-z]+)\/records(?:\/([^/]+))?$/))) return routeRecords(b, m[1], m[2] && decodeURIComponent(m[2]), method, corps, q);

  if (p === 'sokoyetu/etat') { exigerGerant(); return { version: __VERSION__ + ' · démo', ia: false, iaQuota: { utilises: 0, max: 60, restants: 60 }, paiement: { fournisseur: 'simulation', pret: true, test: true, panne: 0 }, codes: { pret: true, canaux: ['whatsapp', 'sms'], test: true } }; }
  // Surveillance (comme serveur/pb_hooks/lib/journal.js) : la démo n'a ni sauvegarde ni journal réels.
  if (p === 'sokoyetu/erreur') return null;
  if (p === 'sokoyetu/sante') {
    const r = { ok: true, version: __VERSION__ + ' · démo', heure: Date.now() };
    if (gerant()) r.details = { sauvegardes: { nombre: 7, derniere: Date.now() - 5 * 3600e3, verification: { quand: Date.now() - 2 * JOUR, ok: true, fichier: '@auto_pb_backup_sokoyetu.zip', message: 'Restauration réussie (exemple de la démonstration).' } }, paiement: { fournisseur: 'simulation', pret: true, test: true, panne: 0 }, erreurs: { heure: 0, jour: 0 }, alerte: { configuree: false, dernier: 0 }, problemes: [{ grave: false, texte: 'Démonstration : sur votre serveur, cette page montre l’état réel des sauvegardes, du paiement et des erreurs.' }] };
    return r;
  }
  if (p === 'sokoyetu/journal') { exigerGerant('journal'); return { erreurs: [] }; }

  // Comptes clients (comme serveur/pb_hooks/lib/comptes.js) : code affiché à l'écran, comme en mode test.
  if (p === 'sokoyetu/compte/code') {
    const tel = R.valider.telephone(corps && corps.telephone);
    if (!tel) throw new ErreurApi(400, 'Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.', { champ: 'telephone' });
    const canal = corps.canal === 'sms' ? 'sms' : 'whatsapp';
    const x = b.codes[tel];
    if (x && Date.now() < x.expire && Date.now() - x.envoye < 60000) return { telephone: tel, canal, canaux: ['whatsapp', 'sms'], renvoi: Math.ceil((60000 - (Date.now() - x.envoye)) / 1000), test: true, deja: true, code: x.code };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    b.codes[tel] = { code, envoye: Date.now(), expire: Date.now() + 600000, essais: 0 }; enregistrer(b);
    return { telephone: tel, canal, canaux: ['whatsapp', 'sms'], renvoi: 60, test: true, code };
  }
  if (p === 'sokoyetu/compte/connexion') {
    const tel = R.valider.telephone(corps.telephone); const x = tel && b.codes[tel]; const code = R.codeConnexion(corps.code);
    if (!x || Date.now() > x.expire || x.essais >= 5) throw new ErreurApi(400, 'Ce code a expiré. Demandez-en un nouveau.', { champ: 'code', expire: true });
    if (code !== x.code) { x.essais++; enregistrer(b); throw new ErreurApi(400, `Code incorrect. Encore ${5 - x.essais} essai${5 - x.essais > 1 ? 's' : ''}.`, { champ: 'code', expire: x.essais >= 5 }); }
    delete b.codes[tel];
    let rec = Object.values(b.cols.clients).find((c) => c.phone === tel);
    if (!rec) { const id = 'cli' + uid().slice(0, 12); rec = b.cols.clients[id] = { id, phone: tel, name: '', doc: R.docCompte({}), created: Date.now(), updated: Date.now() }; }
    if (!rec.name && R.valider.nom(corps.name)) rec.name = R.valider.nom(corps.name);
    rec.doc = R.daterCompte(R.fusionCompte(rec.doc, corps), Date.now()); rec.seen = Date.now(); rec.updated = Date.now();
    enregistrer(b); diffuser('clients', rec.id, 'update');
    return { token: jetonClient(rec.id), record: { id: rec.id, collectionName: 'clients', phone: rec.phone, name: rec.name }, meta: { compte: vueCompte(rec), commandes: commandesDuCompte(b, rec) } };
  }
  if (p === 'sokoyetu/compte' || p === 'sokoyetu/compte/supprimer') {
    const rec = clientConnecte(b); if (!rec) throw new ErreurApi(401, 'Connectez-vous à votre compte.');
    if (p === 'sokoyetu/compte/supprimer') {
      Object.values(b.cols.orders).filter((o) => o.client === rec.id).forEach((o) => { o.client = ''; });
      // Comme notifications.detacher : ce qui n'appartenait qu'au compte disparaît, l'appareil garde le reste.
      ['notifications', 'alertes'].forEach((k) => { b[k] = (b[k] || []).map((x) => (x.client === rec.id ? { ...x, client: '' } : x)).filter((x) => x.client || x.appareil); });
      delete b.cols.clients[rec.id]; enregistrer(b); diffuser('clients', rec.id, 'delete', rec); return { ok: true };
    }
    if (method === 'GET') return { compte: vueCompte(rec), commandes: commandesDuCompte(b, rec) };
    const d = R.docCompte(rec.doc);
    if (Array.isArray(corps.panier)) d.panier = R.panierCompte(corps.panier);
    if (Array.isArray(corps.favoris)) d.favoris = R.favorisCompte(corps.favoris);
    if (R.estObjet(corps.profil)) d.profil = R.profilCompte({ ...d.profil, ...corps.profil });
    rec.doc = R.daterCompte(d, Date.now());
    if (corps.name !== undefined && R.valider.nom(corps.name)) rec.name = R.valider.nom(corps.name);
    rec.seen = Date.now(); rec.updated = Date.now();
    enregistrer(b); diffuser('clients', rec.id, 'update');
    return { compte: vueCompte(rec) };
  }
  if (p === 'sokoyetu/discount') {
    const code = R.valider.codePromo(q.get('code'));
    const r = R.verifierRemise(code ? remiseParCode(b, code) : null, code, R.num(q.get('subtotal')), Date.now());
    return r.ok ? { ok: true, code: r.code, type: r.type, value: r.value, amount: r.amount, minSubtotal: r.minSubtotal } : { ok: false, reason: r.reason };
  }
  const cfg = () => configPaiement(b.cols.config.store ? b.cols.config.store.doc : {});
  const produit = (id) => (b.cols.products[id] ? b.cols.products[id].doc : null);
  if (p === 'sokoyetu/devis') {
    const code = R.valider.codePromo(corps.discountCode);
    const d = R.devis({ cfg: cfg(), produit, lignes: corps.items, zoneId: corps.zoneId, code: corps.discountCode, remise: code ? remiseParCode(b, code) : null, maintenant: Date.now() });
    d.lignes.forEach((l) => { delete l.cost; });
    return { lignes: d.lignes, problemes: d.problemes, sousTotal: d.sousTotal, remise: d.remise, livraison: d.livraison, frais: d.frais, fraisPct: d.fraisPct, total: d.total, poids: d.poids, zoneId: d.zone ? d.zone.id : '' };
  }
  if (p === 'sokoyetu/commander') {
    if (corps.website) throw new ErreurApi(400, 'Vérification impossible. Rechargez la page et réessayez.');
    const t = R.valider.jeton(corps.token);
    if (!t) throw new ErreurApi(400, 'Jeton de commande invalide. Rechargez la page et réessayez.');
    const deja = Object.values(b.cols.orders).find((x) => x.token === t);
    if (deja) { suivrePaiement(b, deja); return reponseClient(deja); }
    let prep;
    try {
      const code = R.valider.codePromo(corps.discountCode);
      prep = R.preparerCommande({ cfg: cfg(), produit, remise: code ? remiseParCode(b, code) : null, saisie: corps, maintenant: Date.now(), numero: R.numeroCommande() });
    } catch (err) { if (err instanceof R.ErreurCommande) throw new ErreurApi(400, err.message, { champ: err.champ || '' }); throw err; }
    const modifies = stock(b, prep.reserve, -1);
    const id = 'cmd' + uid().slice(0, 12); const now = Date.now();
    const cl = clientConnecte(b);
    b.cols.orders[id] = { id, doc: prep.commande, token: t, phone: prep.commande.phone, status: 'open', created: now, updated: now, client: cl ? cl.id : '', appareil: R.valider.jeton(corps.appareil) };
    enregistrer(b);
    modifies.forEach((pid) => diffuser('products', pid, 'update'));
    diffuser('orders', id, 'create');
    demanderPaiement(b, b.cols.orders[id], {});
    return reponseClient(b.cols.orders[id]);
  }
  if ((m = p.match(/^sokoyetu\/paiement\/([^/]+)(\/relancer)?$/))) {
    const rec = b.cols.orders[decodeURIComponent(m[1])];
    if (!rec || (!gerant() && rec.token !== q.get('t'))) throw new ErreurApi(404, 'Commande introuvable.');
    suivrePaiement(b, rec);
    if (!m[2]) return reponseClient(rec);
    const raison = R.relancePossible(rec.doc); if (raison) throw new ErreurApi(400, raison);
    if (rec.doc.payment.status === 'pending' && Date.now() - Number(rec.doc.payment.startedAt || 0) < R.RELANCE_APRES_S * 1000) throw new ErreurApi(400, 'La demande de paiement vient d’être envoyée : regardez votre téléphone, puis réessayez dans quelques secondes si rien n’arrive.');
    const moyen = R.moyensDePaiement(cfg()).find((x) => x.k === ((corps && corps.method) || rec.doc.payment.method));
    if (!moyen) throw new ErreurApi(400, 'Ce mode de paiement n’est pas disponible.', { champ: 'method' });
    const tel = R.valider.mobileMoney((corps && corps.phone) || rec.doc.payment.phone);
    if (!tel) throw new ErreurApi(400, `Numéro ${moyen.label} invalide : 10 chiffres, commençant par 08 ou 09.`, { champ: 'payphone' });
    demanderPaiement(b, rec, { methode: moyen.k, label: moyen.label, telephone: tel });
    return reponseClient(rec);
  }
  // Notifications (comme lib/notifications.js) : centre de notifications ; la démo n'a pas de service de notification du téléphone.
  if (p === 'sokoyetu/notifications') {
    const l = notificationsPour(b, corps).sort((x, y) => y.cree - x.cree || y.id - x.id).slice(0, 50)
      .map((x) => ({ id: x.id, type: x.type, ...R.texteNotification(x, corps.langue), url: x.url, cree: x.cree, lu: !!x.lu }));
    return { notifications: l, nonLues: l.filter((x) => !x.lu).length, alertes: alertesPour(b, corps) };
  }
  // « Prévenez-moi » (comme lib/alertes.js).
  if (p === 'sokoyetu/alertes' || p === 'sokoyetu/alertes/retirer') {
    const c = clientConnecte(b); const a = R.valider.jeton(corps.appareil);
    if (!c && !a) throw new ErreurApi(400, 'Appareil inconnu : rechargez la page.');
    const l = (b.alertes = Array.isArray(b.alertes) ? b.alertes : []);
    const moi = (x) => (c && x.client === c.id) || (a && x.appareil === a);
    if (p === 'sokoyetu/alertes/retirer') {
      b.alertes = l.filter((x) => !(moi(x) && x.produit === corps.produit && x.variante === String(corps.variante || '')));
      enregistrer(b); return { ok: true, alertes: alertesPour(b, corps) };
    }
    const prod = produit(String(corps.produit || ''));
    if (!prod || !R.estEnVente(prod)) throw new ErreurApi(404, 'Article introuvable.');
    const variante = R.varianteAlerte(prod, corps.variante);
    if (variante === null) throw new ErreurApi(400, 'Cette option n’existe plus : rechargez la page.');
    if (R.alerteDisponible(prod, variante)) throw new ErreurApi(400, 'Bonne nouvelle : il est de nouveau disponible. Ajoutez-le au panier.');
    if (alertesPour(b, corps).length >= R.MAX_ALERTES) throw new ErreurApi(400, `Vous attendez déjà ${R.MAX_ALERTES} articles : retirez-en quelques-uns (Compte → Notifications).`);
    if (!l.some((x) => x.produit === corps.produit && x.variante === variante && x.client === (c ? c.id : '') && x.appareil === (a || ''))) {
      l.push({ id: l.reduce((m, x) => Math.max(m, x.id), 0) + 1, produit: corps.produit, variante, client: c ? c.id : '', appareil: a || '', cree: Date.now() });
    }
    enregistrer(b); return { ok: true, alertes: alertesPour(b, corps) };
  }
  if (p === 'sokoyetu/relances') { exigerGerant('reglages'); return { relances: relancerPaniers(b) }; }
  if (p === 'sokoyetu/alertes/attente') {
    exigerGerant('produits');
    const out = {};
    (b.alertes || []).forEach((x) => {
      const o = out[x.produit] = out[x.produit] || { total: 0, variantes: {}, cibles: {} };
      const cible = x.client ? 'c' + x.client : 'a' + x.appareil;
      o.variantes[x.variante] = (o.variantes[x.variante] || 0) + 1; o.cibles[cible] = true; o.total = Object.keys(o.cibles).length;
    });
    Object.values(out).forEach((o) => { delete o.cibles; });
    return { produits: out };
  }
  // Annonces aux clients (comme lib/alertes.js) : dans la démo, le seul téléphone est ce navigateur.
  if (p === 'sokoyetu/annonces') {
    exigerGerant('annonces');
    const l = (b.annonces = Array.isArray(b.annonces) ? b.annonces : []);
    const vue24h = () => l.filter((x) => x.cree > Date.now() - JOUR).length;
    const abonne = !!Local.lire('pushDemo', false), promo = abonne && !!Local.lire('pushPromos', false);
    if (method === 'POST') {
      let x; try { x = R.annonceNettoyee(corps); } catch (err) { if (err instanceof R.ErreurCommande) throw new ErreurApi(400, err.message, { champ: err.champ }); throw err; }
      if (vue24h() >= R.ANNONCES_PAR_JOUR) throw new ErreurApi(400, `${R.ANNONCES_PAR_JOUR} annonces par 24 heures au plus : au-delà, vos clients risquent de couper les notifications.`);
      const id = l.reduce((m, y) => Math.max(m, y.id), 0) + 1; const appareil = R.valider.jeton(Local.lire('appareil', ''));
      const n = promo && appareil ? 1 : 0;
      if (n) ajouterNotification(b, { client: '', appareil, type: 'promo', details: { titre: x.titre, texte: x.texte }, url: x.url, cle: 'annonce:' + id });
      l.unshift({ id, ...x, auteur: (Auth.compte && (Auth.compte.name || Auth.compte.email)) || '', cree: Date.now(), destinataires: n });
      enregistrer(b);
    }
    return { abonnes: { telephones: abonne ? 1 : 0, promos: promo ? 1 : 0 }, restantes: Math.max(0, R.ANNONCES_PAR_JOUR - vue24h()), parJour: R.ANNONCES_PAR_JOUR, annonces: l.slice(0, 30) };
  }
  if (p === 'sokoyetu/notifications/lues') { notificationsPour(b, corps).forEach((x) => { x.lu = x.lu || Date.now(); }); enregistrer(b); return { ok: true }; }
  if (p.startsWith('sokoyetu/push/')) throw new ErreurApi(503, 'Les notifications du téléphone passent par le serveur de la boutique : indisponibles dans la démonstration.');
  if (p === 'sokoyetu/retrouver') {
    const n = R.numeroNettoye(corps.numero); const tel = R.chiffres(R.valider.telephone(corps.telephone));
    if (!R.numeroValide(n) || !tel) throw new ErreurApi(400, 'Indiquez le numéro de commande (6 caractères) et votre numéro de téléphone.');
    const rec = Object.values(b.cols.orders).find((x) => x.doc.number === n);
    const tels = rec ? [rec.doc.phone, rec.doc.customer && rec.doc.customer.phone, rec.doc.payment && rec.doc.payment.phone].map((x) => R.chiffres(R.valider.telephone(x))) : [];
    if (!rec || !tels.includes(tel)) throw new ErreurApi(404, 'Aucune commande ne correspond à ce numéro et à ce téléphone.');
    return { id: rec.id, token: rec.token };
  }
  if ((m = p.match(/^sokoyetu\/commandes\/(.+)$/))) {
    const role = exigerGerant();
    if (!R.etapePermise(role, String(corps.action || ''))) throw new ErreurApi(403, 'Votre rôle dans l’équipe ne permet pas cette action.');
    const rec = b.cols.orders[decodeURIComponent(m[1])]; if (!rec || (role === 'livreur' && !R.pourLivreur(rec.doc))) throw new ErreurApi(404, 'Commande introuvable.');
    let r;
    try { r = R.etapeCommande(rec.doc, String(corps.action || ''), { maintenant: Date.now(), note: corps.note, produit }); }
    catch (err) { if (err instanceof R.ErreurCommande) throw new ErreurApi(400, err.message); throw err; }
    const modifies = r.stock === 'reserver' ? stock(b, r.entrees, -1) : r.stock === 'restituer' ? stock(b, r.entrees, 1) : [];
    notifierCommande(b, rec, rec.doc, r.commande);
    rec.doc = r.commande; rec.status = r.commande.status; rec.updated = Date.now();
    enregistrer(b);
    modifies.forEach((pid) => diffuser('products', pid, 'update'));
    diffuser('orders', rec.id, 'update');
    return { id: rec.id, doc: role === 'livreur' ? { ...commandePublique(r.commande), adminNote: r.commande.adminNote || '' } : r.commande };
  }
  // L'équipe (propriétaire) : comme lib/equipe.js, sans vrai mot de passe.
  if (p === 'sokoyetu/equipe' && method === 'GET') { exigerGerant('equipe'); return { membres: equipe(b).map(vueMembre) }; }
  if (p === 'sokoyetu/equipe') {
    exigerGerant('equipe');
    const email = String(corps.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErreurApi(400, 'Adresse e-mail invalide.');
    if (!R.ROLES[corps.role]) throw new ErreurApi(400, 'Choisissez un rôle : propriétaire, vendeur ou livreur.');
    if (!R.valider.nom(corps.name)) throw new ErreurApi(400, 'Indiquez le nom du membre (2 à 60 lettres).');
    if (equipe(b).some((x) => x.email === email)) throw new ErreurApi(400, 'Cette adresse a déjà un compte dans l’équipe.');
    const membre = { id: 'adm' + uid().slice(0, 12), email, name: R.valider.nom(corps.name), role: corps.role, created: Date.now() };
    equipe(b).push(membre); enregistrer(b);
    return { membre: vueMembre(membre), motDePasse: 'DEMO-essai-2026' };
  }
  if ((m = p.match(/^sokoyetu\/equipe\/(.+)$/))) {
    exigerGerant('equipe');
    const l = equipe(b); const membre = l.find((x) => x.id === decodeURIComponent(m[1]));
    if (!membre) throw new ErreurApi(404, 'Ce membre de l’équipe n’existe plus.');
    const proprios = l.filter((x) => x.role === 'proprietaire').length;
    const moi = Auth.compte && Auth.compte.id === membre.id;
    if (method === 'DELETE') {
      if (moi) throw new ErreurApi(400, 'Vous ne pouvez pas retirer votre propre compte.');
      if (membre.role === 'proprietaire' && proprios <= 1) throw new ErreurApi(400, 'La boutique doit garder au moins un propriétaire.');
      b.equipe = l.filter((x) => x !== membre); enregistrer(b); return { ok: true };
    }
    if (corps.role !== undefined) {
      if (!R.ROLES[corps.role]) throw new ErreurApi(400, 'Choisissez un rôle : propriétaire, vendeur ou livreur.');
      if (membre.role === 'proprietaire' && corps.role !== 'proprietaire' && proprios <= 1) throw new ErreurApi(400, 'La boutique doit garder au moins un propriétaire.');
      membre.role = corps.role;
    }
    if (corps.reinitialiser && moi) throw new ErreurApi(400, 'Changez votre propre mot de passe dans « Mon compte ».');
    enregistrer(b);
    return { membre: vueMembre(membre), motDePasse: corps.reinitialiser ? 'DEMO-essai-2026' : '' };
  }
  if (p === 'sokoyetu/clients/effacer') {
    exigerGerant('effacer');
    const tel = R.chiffres(corps.phone); if (tel.length < 6) throw new ErreurApi(400, 'Numéro de téléphone manquant.');
    const l = Object.values(b.cols.orders).filter((x) => x.phone === tel);
    l.forEach((rec) => {
      const d = rec.doc;
      d.phone = ''; d.customer = { name: 'Client effacé', phone: '' };
      d.shipping = Object.assign({}, d.shipping || {}, { address: '', landmark: '' });
      d.note = ''; d.adminNote = ''; d.payment = Object.assign({}, d.payment || {}, { sender: '', phone: '', ref: d.payment && d.payment.ref ? '••••' : '' });
      d.erasedAt = Date.now(); (d.timeline = d.timeline || []).push({ at: Date.now(), text: 'Données personnelles effacées à la demande du client' });
      rec.phone = ''; rec.updated = Date.now();
    });
    const comptes = Object.values(b.cols.clients).filter((c) => R.chiffres(c.phone) === tel);
    const appareils = l.map((rec) => rec.appareil).filter(Boolean); l.forEach((rec) => { rec.appareil = ''; });
    b.notifications = (b.notifications || []).filter((x) => !appareils.includes(x.appareil) && !comptes.some((c) => c.id === x.client));
    b.alertes = (b.alertes || []).filter((x) => !appareils.includes(x.appareil) && !comptes.some((c) => c.id === x.client));
    comptes.forEach((c) => { delete b.cols.clients[c.id]; });
    enregistrer(b); l.forEach((rec) => diffuser('orders', rec.id, 'update')); comptes.forEach((c) => diffuser('clients', c.id, 'delete', c));
    return { effacees: l.length, comptes: comptes.length };
  }
  if (p === 'sokoyetu/visite') { visiteDemo(corps); return null; }
  if (p === 'sokoyetu/audience') { exigerGerant('audience'); return resumeDemo(q.get('jours'), q.get('graphe')); }
  if ((m = p.match(/^sokoyetu\/audience\/(.+)$/))) { exigerGerant('audience'); return articleDemo(decodeURIComponent(m[1]), q.get('jours'), q.get('graphe')); }
  if (p === 'sokoyetu/ia/produit') { exigerGerant(); throw new ErreurApi(503, 'Assistant indisponible dans la démonstration.', { code: 'no_key' }); }
  // Import depuis un fournisseur : la démo ne peut pas lire les sites chinois, elle montre un exemple de lecture.
  if (p === 'sokoyetu/import/lien') {
    exigerGerant();
    const url = String((corps && corps.url) || '').trim();
    if (!/^https?:\/\/([a-z0-9-]+\.)*(1688|alibaba|aliexpress|taobao|tmall|temu|shein|made-in-china|dhgate)\.(com|us)\//i.test(url)) throw new ErreurApi(400, 'Collez le lien d’une page produit (1688, Alibaba, AliExpress, Taobao…).', { code: 'bad_url' });
    await pause(900);
    return {
      url, title: '女士夏季连衣裙 中长款 酒红色 收腰显瘦', description: '', images: ['photos/p01-1.webp', 'photos/p01-1-s.webp'], price: 45, currency: 'CNY', ia: '',
      fiche: corps && corps.ia ? { title: 'Robe midi bordeaux cintrée', description: 'Une robe d’été mi-longue, cintrée à la taille, qui allonge la silhouette. Légère et facile à porter, du bureau aux sorties.\n\n(Exemple de la démonstration : sur votre serveur, l’assistant lit la vraie page du fournisseur.)', details: 'Matière : Polyester (probable)\nLongueur : Mi-mollet\nCoupe : Cintrée', colors: [{ name: 'Bordeaux', hex: '#7A1F2B' }], sizes: ['S', 'M', 'L', 'XL'], collectionIds: [], newCollection: '', tags: 'robe, été, bordeaux, femme', alt: 'Robe midi bordeaux, vue de face' } : null
    };
  }
  if (p === 'sokoyetu/import/photo') {
    exigerGerant();
    const url = String((corps && corps.url) || '').trim();
    if (!url) throw new ErreurApi(400, 'Adresse de photo invalide.', { code: 'bad_url' });
    await pause(200);
    return { type: 'url', src: url };
  }
  throw new ErreurApi(404, 'Adresse inconnue dans la démonstration.');
}

/* ---------- Fréquentation (comme serveur/pb_hooks/lib/audience.js), avec deux semaines de visites inventées ---------- */

const CLE_AUDIENCE = 'sokoyetu-demo:audience';
const jourDe = (t) => new Date(t + 2 * 3600e3).toISOString().slice(0, 10);
function audienceDemo() {
  let a = null;
  try { a = JSON.parse(localStorage.getItem(CLE_AUDIENCE) || 'null'); } catch (e) { }
  if (a && a.visiteurs) return a;
  a = { visiteurs: {}, articles: {}, etats: {} };
  const ids = Object.keys(base().cols.products); let graine = 7;
  const hasard = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
  for (let d = 13; d >= 1; d--) {
    const j = jourDe(Date.now() - d * JOUR);
    const n = 18 + Math.round(hasard() * 30) + (13 - d) * 2;
    for (let i = 0; i < n; i++) {
      const v = 'demo' + Math.floor(hasard() * 160); const k = j + '|' + v;
      const x = a.visiteurs[k] = a.visiteurs[k] || { jour: j, v, vu: 0, vues: 0, produit: '' };
      for (let q = Math.ceil(hasard() * 4); q > 0; q--) {
        const p = ids[Math.floor(Math.pow(hasard(), 1.8) * ids.length)]; if (!p) continue;
        const ka = j + '|' + p + '|' + v; const y = a.articles[ka] = a.articles[ka] || { jour: j, p, v, vues: 0, panier: 0, favori: 0 };
        y.vues++; x.vues++;
        if (hasard() < 0.12) { y.panier++; a.etats[v + '|panier|' + p] = 1; }
        if (hasard() < 0.08) { y.favori++; a.etats[v + '|favori|' + p] = 1; }
      }
    }
  }
  try { localStorage.setItem(CLE_AUDIENCE, JSON.stringify(a)); } catch (e) { }
  return a;
}
function visiteDemo(c) {
  const v = String((c && c.v) || ''); if (!/^[a-z0-9]{16,40}$/.test(v)) return;
  const a = audienceDemo(); const now = Date.now(); const j = jourDe(now);
  const p = /^[a-z0-9-]{2,40}$/.test(String(c.p || '')) ? String(c.p) : '';
  const act = ['vue', 'panier', 'favori'].includes(c.a) && p ? c.a : '';
  const x = a.visiteurs[j + '|' + v] = a.visiteurs[j + '|' + v] || { jour: j, v, vu: 0, vues: 0, produit: '' };
  x.vu = now; x.produit = p; if (act === 'vue') x.vues++;
  if (act) { const k = j + '|' + p + '|' + v; const y = a.articles[k] = a.articles[k] || { jour: j, p, v, vues: 0, panier: 0, favori: 0 }; y[act === 'vue' ? 'vues' : act]++; }
  [['panier', 'panier'], ['favori', 'favoris']].forEach(([type, cle]) => {
    if (!Array.isArray(c[cle])) return;
    Object.keys(a.etats).filter((k) => k.startsWith(v + '|' + type + '|')).forEach((k) => delete a.etats[k]);
    c[cle].slice(0, 60).forEach((id) => { a.etats[v + '|' + type + '|' + id] = 1; });
  });
  try { localStorage.setItem(CLE_AUDIENCE, JSON.stringify(a)); } catch (e) { }
}
function periodeDemo(n) { n = Math.max(1, Math.min(90, parseInt(n, 10) || 7)); return Array.from({ length: n }, (_, i) => jourDe(Date.now() - (n - 1 - i) * JOUR)); }
function resumeDemo(jours, graphe) {
  const a = audienceDemo(); const P = periodeDemo(jours); const G = periodeDemo(Math.max(P.length, parseInt(graphe, 10) || 0));
  const vis = Object.values(a.visiteurs); const recent = Date.now() - 90e3;
  const premier = {}; vis.forEach((x) => { if (!premier[x.v] || x.jour < premier[x.v]) premier[x.v] = x.jour; });
  const produits = {}; const fiche = (id) => (produits[id] = produits[id] || { id, vues: 0, visiteurs: 0, paniers: 0, favoris: 0, dansPaniers: 0, dansFavoris: 0, enLigne: 0 });
  Object.values(a.articles).filter((y) => y.jour >= P[0]).forEach((y) => { const f = fiche(y.p); f.vues += y.vues; f.visiteurs += y.vues > 0 ? 1 : 0; f.paniers += y.panier > 0 ? 1 : 0; f.favoris += y.favori > 0 ? 1 : 0; });
  Object.keys(a.etats).forEach((k) => { const [, type, p] = k.split('|'); fiche(p)[type === 'panier' ? 'dansPaniers' : 'dansFavoris']++; });
  const enLigne = new Set(); vis.filter((x) => x.vu > recent).forEach((x) => { enLigne.add(x.v); if (x.produit) fiche(x.produit).enLigne++; });
  const dansP = vis.filter((x) => x.jour >= P[0]);
  return {
    maintenant: Date.now(), periode: P.length, enLigne: enLigne.size, visiteurs: new Set(dansP.map((x) => x.v)).size,
    nouveaux: Object.values(premier).filter((j) => j >= P[0]).length, vues: dansP.reduce((s, x) => s + x.vues, 0),
    visiteursTotal: Object.keys(premier).length, gardeJours: 90,
    jours: G.map((j) => { const l = vis.filter((x) => x.jour === j); return { jour: j, visiteurs: l.length, vues: l.reduce((s, x) => s + x.vues, 0), nouveaux: Object.values(premier).filter((d) => d === j).length }; }),
    produits: Object.values(produits)
  };
}
function articleDemo(id, jours, graphe) {
  const a = audienceDemo(); const P = periodeDemo(jours); const G = periodeDemo(Math.max(P.length, parseInt(graphe, 10) || 0));
  const l = Object.values(a.articles).filter((y) => y.p === id);
  const etats = Object.keys(a.etats).filter((k) => k.endsWith('|' + id));
  const jx = G.map((j) => { const d = l.filter((y) => y.jour === j); return { jour: j, vues: d.reduce((s, y) => s + y.vues, 0), visiteurs: d.filter((y) => y.vues > 0).length, paniers: d.filter((y) => y.panier > 0).length, favoris: d.filter((y) => y.favori > 0).length }; });
  const dansP = l.filter((y) => y.jour >= P[0]);
  return {
    maintenant: Date.now(), id, periode: P.length, jours: jx,
    enLigne: Object.values(a.visiteurs).filter((x) => x.vu > Date.now() - 90e3 && x.produit === id).length,
    dansPaniers: etats.filter((k) => k.includes('|panier|')).length, dansFavoris: etats.filter((k) => k.includes('|favori|')).length,
    total: { vues: dansP.reduce((s, y) => s + y.vues, 0), visiteurs: new Set(dansP.filter((y) => y.vues > 0).map((y) => y.v)).size, paniers: dansP.filter((y) => y.panier > 0).length, favoris: dansP.filter((y) => y.favori > 0).length }
  };
}

/* ---------- Notifications (comme serveur/pb_hooks/lib/notifications.js) ---------- */

/* Commande changée : le client est prévenu (son appareil et son compte, ou le compte de son téléphone), une fois par étape. */
function notifierCommande(b, rec, avant, apres) {
  const l = R.evenementsCommande(avant, apres); if (!l.length) return;
  const client = rec.client || (Object.values(b.cols.clients).find((c) => R.chiffres(c.phone) === rec.phone) || {}).id || '';
  l.forEach((ev) => ajouterNotification(b, { client, appareil: rec.appareil || '', type: ev.type, details: ev.details, url: '/suivi/' + rec.id, cle: rec.id + ':' + ev.type }));
}
function ajouterNotification(b, x) {
  const n = (b.notifications = Array.isArray(b.notifications) ? b.notifications : []);
  if (x.cle && n.some((y) => y.cle === x.cle)) return;
  n.push({ id: n.reduce((m, y) => Math.max(m, y.id), 0) + 1, ...x, cree: Date.now(), lu: 0 });
  if (n.length > 300) b.notifications = n.slice(-300);
}
/* Article de nouveau disponible : chaque client qui l'attendait est prévenu une fois, son alerte disparaît. */
function alertesProduit(b, rec) {
  const l = Array.isArray(b.alertes) ? b.alertes : []; const p = rec.doc;
  const servies = l.filter((x) => x.produit === rec.id && R.alerteDisponible(p, x.variante));
  if (!servies.length) return;
  const vus = new Set();
  servies.forEach((x) => {
    const cible = x.client ? 'c' + x.client : 'a' + x.appareil; if (vus.has(cible)) return; vus.add(cible);
    ajouterNotification(b, { client: x.client, appareil: x.appareil, type: 'stock', details: { titre: p.title || 'Article', option: R.libelleVariante(x.variante) }, url: '/p/' + rec.id + '/' + R.slug(p.title), cle: 'stock:' + x.id });
  });
  b.alertes = l.filter((x) => !servies.includes(x));
}
function alertesPour(b, corps) {
  const c = clientConnecte(b); const a = R.valider.jeton(corps && corps.appareil);
  const vus = new Set();
  return (b.alertes || []).filter((x) => (c && x.client === c.id) || (a && x.appareil === a)).sort((x, y) => y.cree - x.cree)
    .filter((x) => { const k = x.produit + '#' + x.variante; if (vus.has(k)) return false; vus.add(k); return true; })
    .map((x) => ({ produit: x.produit, variante: x.variante }));
}
function notificationsPour(b, corps) {
  const c = clientConnecte(b); const a = R.valider.jeton(corps && corps.appareil);
  return (b.notifications || []).filter((x) => (c && x.client === c.id) || (a && x.appareil === a));
}

/* Relance des paniers laissés (comme comptes.relancerPaniers) : notification gratuite, une fois par panier. */
function relancerPaniers(b) {
  const cfg = configPaiement(b.cols.config.store ? b.cols.config.store.doc : {}); const now = Date.now(); let n = 0;
  if (!cfg.cartReminder.enabled) return 0;
  Object.values(b.cols.clients).forEach((rec) => {
    const tel = R.chiffres(rec.phone);
    const r = R.relancePanier({ doc: rec.doc, cfg, relance: rec.relance, maintenant: now, produit: (id) => (b.cols.products[id] ? b.cols.products[id].doc : null),
      commandeDepuis: (t) => Object.values(b.cols.orders).some((o) => (o.client === rec.id || (tel && o.phone === tel)) && o.created > t) });
    if (!r) return;
    ajouterNotification(b, { client: rec.id, appareil: '', type: 'panier', details: { titre: r.titre, autres: r.autres }, url: '/panier', cle: 'panier:' + rec.id + ':' + r.depuis });
    rec.relance = now; n++;
    diffuser('clients', rec.id, 'update');
  });
  if (n) enregistrer(b);
  return n;
}

/* ---------- Paiement en mode test (comme serveur/pb_hooks/lib/commandes.js) ---------- */

function verifierSimulation(d) {
  if (Date.now() - Number(d.payment.startedAt || 0) < DELAI_PAIEMENT) return { etat: 'en_attente' };
  if (/0000$/.test(String(d.payment.phone || ''))) return { etat: 'echec', message: 'Solde insuffisant (simulation).' };
  return { etat: 'paye', reference: 'TEST' + String(Date.now()).slice(-8) };
}
function appliquerPaiement(b, rec, r) {
  const avant = R.copie(rec.doc);
  let d = rec.doc; const now = Date.now(); let modifies = [];
  d.payment.checkedAt = now;
  if (r && r.etat === 'paye') { const x = R.paiementConfirme(d, { maintenant: now, reference: r.reference }); if (x.stock === 'reserver') modifies = stock(b, x.entrees, -1); d = x.commande; }
  else if (r && r.etat === 'echec' && d.payment.status === 'pending') d = R.paiementEchoue(d, { maintenant: now, raison: r.message });
  if (R.enAttentePaiement(d) && Number(d.expiresAt) && now > Number(d.expiresAt)) { const x = R.paiementExpire(d, { maintenant: now }); if (x.stock === 'restituer') modifies = modifies.concat(stock(b, x.entrees, 1)); d = x.commande; }
  notifierCommande(b, rec, avant, d);
  rec.doc = d; rec.status = d.status; rec.updated = now;
  enregistrer(b);
  modifies.forEach((pid) => diffuser('products', pid, 'update'));
  diffuser('orders', rec.id, 'update');
}
function suivrePaiement(b, rec) {
  const d = rec.doc;
  if (!R.enAttentePaiement(d)) return;
  if (Number(d.expiresAt) && Date.now() > Number(d.expiresAt)) { appliquerPaiement(b, rec, null); return; }
  if (d.payment.status !== 'pending') return;
  const r = verifierSimulation(d);
  if (r.etat !== 'en_attente') appliquerPaiement(b, rec, r);
}
function demanderPaiement(b, rec, opts) {
  const now = Date.now();
  rec.doc = R.paiementEnvoye(rec.doc, { maintenant: now, providerId: `SIM-${rec.doc.number}-${R.int(rec.doc.payment.attempts) + 1}`, ...opts });
  rec.updated = now; enregistrer(b); diffuser('orders', rec.id, 'update');
}
function reponseClient(rec) {
  const d = rec.doc; const p = d.payment || {};
  return { id: rec.id, order: commandePublique(d), paiement: { etat: p.status || '', message: p.error || '', expireA: Number(d.expiresAt) || 0, tentatives: R.int(p.attempts), relance: R.relancePossible(d) === '', test: true } };
}
// Comme les tâches du serveur : les paiements en cours avancent même si le client a fermé la page ; les paniers laissés
// sont rappelés (chaque minute dans la démo).
let derniereRelance = 0;
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  try { const b = base(); Object.values(b.cols.orders).filter((r) => R.enAttentePaiement(r.doc)).forEach((r) => suivrePaiement(b, r)); } catch (e) { }
  if (Date.now() - derniereRelance > 60000) { derniereRelance = Date.now(); try { relancerPaniers(base()); } catch (e) { } }
}, 4000);

/* ---------- Même interface que src/commun/js/api.js ---------- */

export async function requete(chemin, { method = 'GET', corps } = {}) {
  await pause(chemin.startsWith('sokoyetu/commander') ? 700 : 140);
  if (corps instanceof FormData) corps = Object.fromEntries(corps.entries());
  return R.copie(await serveur(chemin, method, corps));
}
export const versLigne = (r) => Object.assign({}, r && r.doc && typeof r.doc === 'object' ? r.doc : {}, { id: r.id });
export async function tout(col, q = {}) { const j = await requete(`collections/${col}/records?${new URLSearchParams(Object.assign({ page: 1, perPage: 5000 }, q))}`); return (j.items || []).map(versLigne); }
export const lire = async (col, id, q) => versLigne(await requete(`collections/${col}/records/${encodeURIComponent(id)}${q ? '?' + new URLSearchParams(q) : ''}`));
export async function ecrire(col, id, doc) {
  const corps = Object.assign({}, doc); delete corps.id;
  try { return versLigne(await requete(`collections/${col}/records/${encodeURIComponent(id)}`, { method: 'PATCH', corps: { doc: corps } })); }
  catch (e) { if (e.status !== 404) throw e; return versLigne(await requete(`collections/${col}/records`, { method: 'POST', corps: { id, doc: corps } })); }
}
export const supprimer = (col, id) => requete(`collections/${col}/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
export async function connexion(email, motDePasse) {
  const r = await requete('collections/admins/auth-with-password', { method: 'POST', corps: { identity: String(email).trim().toLowerCase(), password: motDePasse } });
  Auth.enregistrer({ token: r.token, record: r.record });
  return r.record;
}
export async function prolongerSession(col = 'admins') { const r = await requete(`collections/${col}/auth-refresh`, { method: 'POST' }); Auth.enregistrer({ token: r.token, record: r.record }); }
export async function changerMotDePasse(ancien, nouveau) { if (!ancien) throw new ErreurApi(400, 'Mot de passe actuel incorrect.'); await pause(300); return nouveau; }

let derniere = '';
export async function lireCatalogue(etag) {
  await pause(120);
  const b = base(); const l = (col) => Object.values(b.cols[col]).map((x) => versLigne(vue(col, x, false)));
  const donnees = { config: b.cols.config.store ? versLigne(vue('config', b.cols.config.store, false)) : null, collections: l('collections'), banners: l('banners'), products: Object.values(b.cols.products).filter((x) => x.active !== false).map((x) => versLigne(vue('products', x, false))) };
  const json = JSON.stringify(donnees);
  let h = 0; for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) | 0;
  derniere = '"' + (h >>> 0).toString(36) + json.length + '"';
  if (etag && etag === derniere) return null;
  return { donnees: JSON.parse(json), etag: derniere };
}

/* Photos ajoutées dans la démo : gardées dans le navigateur. */
const lireFichier = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(blob); });
export async function envoyerPhoto(blob) {
  exigerGerant();
  const id = 'm' + uid().slice(0, 14); const f = 'photo.' + (blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg');
  const donnees = await lireFichier(blob);
  try { localStorage.setItem(CLE_MEDIA + id, donnees); } catch (e) { throw new ErreurApi(507, 'La mémoire de la démo est pleine : retirez des photos ou réinitialisez la démo.', { code: 'memoire' }); }
  const b = base(); b.cols.media[id] = { id, doc: {}, file: f, created: Date.now(), updated: Date.now() }; enregistrer(b);
  await pause(250);
  return { type: 'pb', id, f };
}
/* Vidéos de la démo : gardées le temps de la visite seulement (trop lourdes pour la mémoire du navigateur). */
export async function envoyerVideo(fichier) {
  exigerGerant();
  await pause(400);
  return { type: 'blob', src: URL.createObjectURL(fichier), video: true };
}
const memoire = new Map();
export function urlFichierServeur(m) {
  if (!memoire.has(m.id)) { let d = ''; try { d = localStorage.getItem(CLE_MEDIA + m.id) || ''; } catch (e) { } if (d) memoire.set(m.id, d); return d; }
  return memoire.get(m.id);
}
