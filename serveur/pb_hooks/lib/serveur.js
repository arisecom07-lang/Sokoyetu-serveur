/*
 * Sokoyetu — accès aux données pour les hooks PocketBase.
 * Les documents sont stockés en JSON dans le champ « doc » de chaque enregistrement.
 */
const R = require(`${__hooks}/lib/regles.js`);

function lire(rec, champ) {
  try { const s = rec.getString(champ || 'doc'); const v = s ? JSON.parse(s) : {}; return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

/* Réglages de la boutique ; le fournisseur de paiement vient du serveur (sokoyetu.env), jamais des réglages. */
function configuration(app) {
  let brut = {};
  try { brut = lire(app.findRecordById('config', 'store')); } catch (e) { }
  const c = R.config(brut);
  const P = require(`${__hooks}/lib/paiement.js`);
  c.payment.provider = P.pret() ? P.fournisseur() : '';
  return c;
}

/* Lecteur de produits avec cache, pour une même requête. */
function lecteurProduits(app) {
  const cache = {};
  return {
    doc(id) {
      if (!id) return null;
      if (!(id in cache)) {
        try { const rec = app.findRecordById('products', id); cache[id] = { rec, doc: lire(rec) }; } catch (e) { cache[id] = null; }
      }
      return cache[id] ? cache[id].doc : null;
    },
    rec(id) { this.doc(id); return cache[id] ? cache[id].rec : null; }
  };
}

function remiseParCode(app, code) {
  const c = R.valider.codePromo(code);
  if (!c) return null;
  try { return lire(app.findFirstRecordByData('discounts', 'code', c)); } catch (e) { return null; }
}

/*
 * Rôle du compte de l'administration qui fait la demande (regles.ROLES), '' pour un visiteur ou un client.
 * Le tableau technique (superutilisateur) a tous les droits ; un compte sans rôle est celui du propriétaire.
 */
function roleDe(info) {
  try {
    if (!info) return '';
    if (info.hasSuperuserAuth()) return 'proprietaire';
    if (!info.auth || info.auth.collection().name !== 'admins') return '';
    return R.roleNettoye(info.auth.getString('role'));
  } catch (e) { return ''; }
}
const estGerant = (info) => !!roleDe(info);

/* Refuse la demande si elle ne vient pas de l'administration, ou si le rôle n'a pas ce droit (regles.DROITS). Renvoie le rôle. */
function exigerGerant(e, droit) {
  const role = roleDe(e.requestInfo());
  if (!role) throw new ForbiddenError('Réservé à l’administration de la boutique.');
  if (droit && !R.peut(role, droit)) throw new ForbiddenError('Votre rôle dans l’équipe ne permet pas cette action.');
  return role;
}

function corps(e) {
  const b = e.requestInfo().body;
  return b && typeof b === 'object' ? b : {};
}

/* Applique au catalogue une réservation (sens -1) ou une restitution (sens +1) de stock. */
function appliquerStock(app, entrees, sens) {
  const parProduit = {};
  for (const x of entrees || []) { if (x && x.productId) (parProduit[x.productId] = parProduit[x.productId] || []).push(x); }
  for (const id of Object.keys(parProduit)) {
    let rec; try { rec = app.findRecordById('products', id); } catch (e) { continue; }
    const doc = R.ajusterStock(lire(rec), parProduit[id], sens);
    doc.updatedAt = Date.now();
    rec.set('doc', doc);
    app.save(rec);
  }
}

/* Vue « client » d'une commande : sans coûts d'achat, notes internes ni détails de stock. */
function commandePublique(doc) {
  const d = R.copie(doc);
  const aVerifier = Array.isArray(d.issues) && d.issues.length > 0;
  delete d.adminNote; delete d.issues; delete d.reserved; delete d.stockApplied; delete d.declaredTotal;
  // Références internes des demandes de paiement : jamais montrées au client.
  if (d.payment) { delete d.payment.providerId; delete d.payment.checkedAt; delete d.payment.previous; delete d.payment.paidId; delete d.payment.duplicates; delete d.payment.duplicatesRefundedAt; }
  (d.items || []).forEach((i) => { delete i.cost; delete i.available; });
  d.review = aVerifier && d.status !== 'cancelled' && !(d.payment && d.payment.status === 'paid');
  return d;
}
/* Vue « livreur » : celle du client, plus la note interne (consignes de livraison) ; jamais les coûts ni les marges. */
function commandeLivreur(doc) {
  const d = commandePublique(doc);
  d.adminNote = nettoyerNote(doc.adminNote);
  return d;
}
const nettoyerNote = (n) => String(n || '').slice(0, 1000);

function produitPublic(doc) {
  const d = R.copie(doc);
  // Coût d'achat et fournisseur (lien 1688, prix d'usine) : réservés à la boutique.
  delete d.cost; delete d.supplier;
  // Image d'aperçu des liens partagés : lue par le serveur seulement (pages /p/…), inutile au catalogue.
  delete d.share;
  return d;
}

/* Enregistre le document d'une commande et ses champs de recherche (numéro, état du paiement, échéance, référence du fournisseur). */
function champsCommande(rec, doc) {
  rec.set('status', doc.status || 'open');
  rec.set('phone', doc.phone || '');
  rec.set('number', doc.number || '');
  rec.set('pay_status', (doc.payment && doc.payment.status) || '');
  rec.set('pay_ref', (doc.payment && doc.payment.providerId) || '');
  rec.set('expires', Number(doc.expiresAt) || 0);
  rec.set('etape', doc.fulfillment || 'unfulfilled');
}
function enregistrerCommande(app, rec, doc) {
  const avant = rec.isNew() ? {} : lire(rec);
  rec.set('doc', doc);
  champsCommande(rec, doc);
  app.save(rec);
  // Le client est prévenu de chaque étape (centre de notifications, téléphone), dans la même transaction.
  try { require(`${__hooks}/lib/notifications.js`).apresCommande(app, rec, avant, doc); }
  catch (e) { trace('error', 'Notification de commande impossible', { module: 'notifications', commande: doc.number, erreur: String(e) }); }
}

/* Numéro de commande jamais déjà attribué (6 caractères tirés au sort, sans 0/O ni 1/I). */
function numeroUnique(app) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 10; i++) {
    const n = $security.randomStringWithAlphabet(6, alphabet);
    try { app.findFirstRecordByData('orders', 'number', n); } catch (e) { return n; }
  }
  return $security.randomStringWithAlphabet(8, alphabet);
}

function versRecord(rec) {
  return Object.assign({}, lire(rec), { id: rec.id });
}

/*
 * Journal du serveur (tableau technique /_/ → Logs, et page « Journal » de l'administration) :
 * trace('error', 'Message', { module: 'paiement', commande: 'K7M2QX' }). Niveaux : info, warn, error.
 */
function trace(niveau, message, attributs) {
  const args = ['type', 'serveur'];
  Object.keys(attributs || {}).forEach((k) => { const v = attributs[k]; if (v !== undefined && v !== null && v !== '') args.push(k, typeof v === 'number' ? v : String(v).slice(0, 500)); });
  const methode = niveau === 'error' || niveau === 'warn' ? niveau : 'info';
  try { $app.logger()[methode](String(message), ...args); } catch (e) { console.log('sokoyetu', niveau, message, JSON.stringify(attributs || {})); }
}

/* Compteurs du jour (heure de Bukavu et Goma, UTC+2), partagés par tout le serveur : plafonds des appels qui coûtent. */
const jourLocal = (t) => new Date((t || Date.now()) + 2 * 3600e3).toISOString().slice(0, 10);
function compteurJour(app, nom) {
  const l = arrayOf(new DynamicModel({ n: 0 }));
  try { app.db().newQuery('SELECT n FROM sokoyetu_compteurs WHERE cle = {:c}').bind({ c: nom + ':' + jourLocal() }).all(l); } catch (e) { return 0; }
  return l.length ? Number(l[0].n) || 0 : 0;
}
function ajouterCompteur(app, nom) {
  try {
    app.db().newQuery('INSERT INTO sokoyetu_compteurs (cle, n, maj) VALUES ({:c}, 1, {:t}) ON CONFLICT (cle) DO UPDATE SET n = n + 1, maj = excluded.maj')
      .bind({ c: nom + ':' + jourLocal(), t: Date.now() }).execute();
  } catch (e) { trace('warn', 'Compteur du jour indisponible', { module: 'compteurs', nom, erreur: String(e) }); }
}
/* Chaque nuit : compteurs de plus de 400 jours effacés. */
function purgerCompteurs(app) {
  try { app.db().newQuery('DELETE FROM sokoyetu_compteurs WHERE maj < {:t}').bind({ t: Date.now() - 400 * 864e5 }).execute(); } catch (e) { }
}

module.exports = { R, lire, configuration, lecteurProduits, remiseParCode, roleDe, estGerant, exigerGerant, corps, appliquerStock, commandePublique, commandeLivreur, produitPublic, versRecord, champsCommande, enregistrerCommande, numeroUnique, trace, jourLocal, compteurJour, ajouterCompteur, purgerCompteurs };
