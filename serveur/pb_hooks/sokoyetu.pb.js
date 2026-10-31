/// <reference path="../pb_data/types.d.ts" />
/*
 * Sokoyetu — règles du serveur (PocketBase).
 *
 *   sokoyakwetu.com          → la boutique (dossier pb_public)
 *   admin.sokoyakwetu.com    → l'administration (dossier pb_admin), application séparée
 *   /api/…                   → la base commune, avec les règles métier ci-dessous
 *
 * Chaque gestionnaire charge ses modules avec require : PocketBase exécute chaque appel dans un contexte isolé.
 */

/* ---------- Adresses, compression, cache et sécurité ---------- */

// Compression des pages, du code et des données. Photos, vidéos et polices sont déjà compressées : envoyées telles quelles
// (moins de travail pour le serveur), comme les lectures partielles d'une vidéo (Range), que la compression casserait.
routerUse((e) => {
  const chemin = String(e.request.url.path || '/');
  if (e.request.header.get('Range') || /\.(webp|jpe?g|png|gif|avif|heic|mp4|webm|mov|m4v|woff2?|zip|gz)$/i.test(chemin)) e.request.header.del('Accept-Encoding');
  return e.next();
});
routerUse($apis.gzip());

/* Poids maximal des requêtes envoyées aux routes de la boutique (une commande pèse quelques kilo-octets). */
const KO = 1024;
const LIMITE = { petite: $apis.bodyLimit(8 * KO), commande: $apis.bodyLimit(96 * KO), compte: $apis.bodyLimit(160 * KO), photo: $apis.bodyLimit(8 * 1024 * KO) };

routerUse((e) => {
  const hote = String(e.request.host || '').toLowerCase().split(':')[0];
  const chemin = String(e.request.url.path || '/');
  if (hote.indexOf('www.') === 0) return e.redirect(301, 'https://' + hote.slice(4) + e.request.url.requestURI());
  if (chemin.indexOf('/api/') === 0 || chemin.indexOf('/_/') === 0) return e.next();

  const admin = hote.indexOf('admin.') === 0;
  // Ancienne adresse de l'administration (version 1) : renvoi vers son sous-domaine.
  if (!admin && (chemin === '/admin.html' || chemin === '/admin')) return e.redirect(302, (e.request.tls ? 'https://' : 'http://') + 'admin.' + e.request.host + '/');
  const h = e.response.header();
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  if (e.request.tls) h.set('Strict-Transport-Security', 'max-age=31536000');
  h.set('Content-Security-Policy', admin
    ? "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    : "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' https://www.googletagmanager.com https://plausible.io https://gc.zgo.at; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://plausible.io https://*.goatcounter.com; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (/^\/assets\//.test(chemin)) h.set('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/^\/(photos|icones)\//.test(chemin) || /\.(png|webp|jpg|svg|ico|woff2)$/.test(chemin)) h.set('Cache-Control', 'public, max-age=604800');
  else h.set('Cache-Control', 'no-cache');

  // L'administration a ses propres fichiers ; les photos d'exemple restent celles de la boutique.
  if (admin && chemin.indexOf('/photos/') !== 0) return $apis.static(`${__hooks}/../pb_admin`, true)(e);
  return e.next();
});

/* ---------- Boutique : pages partageables et référencement ---------- */

routerAdd('GET', '/p/{chemin...}', (e) => require(`${__hooks}/lib/pages.js`).pageArticle(e));
routerAdd('GET', '/c/{chemin...}', (e) => require(`${__hooks}/lib/pages.js`).pageRayon(e));
routerAdd('GET', '/panier/partage', (e) => require(`${__hooks}/lib/pages.js`).pagePanier(e));
routerAdd('GET', '/sitemap.xml', (e) => require(`${__hooks}/lib/pages.js`).planDuSite(e));
routerAdd('GET', '/api/sokoyetu/catalogue', (e) => require(`${__hooks}/lib/pages.js`).catalogue(e));

/* ---------- Boutique : codes promo, devis et commandes ---------- */

// Vérifie un code promo sans exposer la liste des codes.
routerAdd('GET', '/api/sokoyetu/discount', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const q = e.requestInfo().query || {};
  const code = R.valider.codePromo(q['code']);
  const r = R.verifierRemise(code ? S.remiseParCode(e.app, code) : null, code, R.num(q['subtotal']), Date.now());
  return e.json(200, r.ok ? { ok: true, code: r.code, type: r.type, value: r.value, amount: r.amount, minSubtotal: r.minSubtotal } : { ok: false, reason: r.reason });
});

// Recalcule le panier avant le paiement : le client ne paie jamais un montant que le serveur n'a pas confirmé.
routerAdd('POST', '/api/sokoyetu/devis', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const b = S.corps(e);
  const P = S.lecteurProduits(e.app);
  const cfg = S.configuration(e.app);
  const code = R.valider.codePromo(b.discountCode);
  // Cagnotte du client connecté ({ cagnotte: true } pour l'utiliser) et cadeau de bienvenue du parrainage ({ parrain: code }).
  const fi = require(`${__hooks}/lib/fidelite.js`).pourCommande(e.app, require(`${__hooks}/lib/comptes.js`).compteDe(e), b, cfg);
  const d = R.devis({ cfg, produit: (id) => P.doc(id), lignes: b.items, zoneId: b.zoneId, code: b.discountCode, remise: code ? S.remiseParCode(e.app, code) : null,
    parrainage: fi.parrainage, cagnotte: b.cagnotte === true ? fi.cagnotte : 0, maintenant: Date.now() });
  d.lignes.forEach((l) => { delete l.cost; });
  return e.json(200, { lignes: d.lignes, problemes: d.problemes, sousTotal: d.sousTotal, remise: d.remise, bienvenue: d.bienvenue, cagnotte: d.cagnotte, livraison: d.livraison, frais: d.frais, fraisPct: d.fraisPct, total: d.total, gain: d.gain, poids: d.poids, zoneId: d.zone ? d.zone.id : '',
    fidelite: { solde: fi.cagnotte, raison: fi.raison } });
}, LIMITE.commande);

/*
 * Commande et paiement automatique par Mobile Money. Tout est recalculé ici et enregistré d'un bloc
 * (commande « en attente de paiement » + réservation du stock), puis la demande de paiement part chez le fournisseur :
 * le client la valide sur son téléphone. Renvoyer deux fois la même commande (connexion coupée, double appui) ne crée
 * qu'une commande : le jeton est vérifié dans la transaction, et l'index unique sur le jeton refuse toute copie.
 */
routerAdd('POST', '/api/sokoyetu/commander', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const C = require(`${__hooks}/lib/commandes.js`);
  const b = S.corps(e);
  if (b.website) return e.json(400, { message: 'Vérification impossible. Rechargez la page et réessayez.' });
  const jeton = R.valider.jeton(b.token);
  if (!jeton) return e.json(400, { message: 'Jeton de commande invalide. Rechargez la page et réessayez.' });
  const existante = () => { try { return e.app.findFirstRecordByData('orders', 'token', jeton); } catch (err) { return null; } };
  let deja = existante();
  if (deja) return e.json(200, C.reponseClient(deja.id, C.suivre(e.app, deja)));

  let id = null, erreur = null;
  try {
  e.app.runInTransaction((tx) => {
    try { deja = tx.findFirstRecordByData('orders', 'token', jeton); } catch (err) { deja = null; }
    if (deja) return;
    const P = S.lecteurProduits(tx);
    const cfg = S.configuration(tx);
    const code = R.valider.codePromo(b.discountCode);
    // Client connecté à son compte : la commande s'y rattache (sinon, commande sans compte).
    const compte = require(`${__hooks}/lib/comptes.js`).compteDe(e);
    // Solde de la cagnotte relu ici, dans la transaction : deux commandes simultanées ne la dépensent jamais deux fois.
    const fi = require(`${__hooks}/lib/fidelite.js`).pourCommande(tx, compte, b, cfg);
    let prep;
    try {
      prep = R.preparerCommande({
        cfg, produit: (x) => P.doc(x), remise: code ? S.remiseParCode(tx, code) : null,
        parrainage: fi.parrainage, cagnotte: fi.cagnotte, titulaire: fi.titulaire,
        saisie: b, maintenant: Date.now(), numero: S.numeroUnique(tx)
      });
    } catch (err) {
      if (err instanceof R.ErreurCommande) { erreur = { message: err.message, champ: err.champ }; return; }
      throw err;
    }
    S.appliquerStock(tx, prep.reserve, -1);
    const rec = new Record(tx.findCollectionByNameOrId('orders'));
    rec.set('token', jeton);
    if (compte) rec.set('client', compte.id);
    // Appareil qui commande (empreinte de son jeton) : il reçoit les notifications de la commande, même sans compte.
    rec.set('appareil', require(`${__hooks}/lib/notifications.js`).empreinte(b.appareil));
    S.enregistrerCommande(tx, rec, prep.commande);
    id = rec.id;
  });
  } catch (err) {
    // Deux envois simultanés avec le même jeton : le second est refusé par l'index unique, on renvoie la commande du premier.
    deja = existante();
    if (!deja) throw err;
  }
  if (deja) return e.json(200, C.reponseClient(deja.id, C.suivre(e.app, deja)));
  if (erreur) return e.json(400, erreur);
  const doc = C.demander(e.app, e.app.findRecordById('orders', id), Object.assign({ callbackUrl: C.adresseNotification(e) }, C.adressesCarte(e, id)));
  return e.json(200, C.reponseClient(id, doc));
}, LIMITE.commande);

// État du paiement d'une commande (le client attend la confirmation sur son téléphone). Revérifié auprès du fournisseur.
routerAdd('GET', '/api/sokoyetu/paiement/{id}', (e) => {
  const C = require(`${__hooks}/lib/commandes.js`);
  const rec = C.commandeDuClient(e);
  return e.json(200, C.reponseClient(rec.id, C.suivre(e.app, rec)));
});

// Nouvelle demande de paiement (refusée, rien reçu sur le téléphone, autre opérateur ou autre numéro, carte), même commande.
// Une seule nouvelle demande à la fois par commande (double appui, deux onglets) : sinon deux demandes valides en même temps.
routerAdd('POST', '/api/sokoyetu/paiement/{id}/relancer', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const C = require(`${__hooks}/lib/commandes.js`);
  const rec = C.commandeDuClient(e);
  const st = e.app.store(); const cle = 'relance:' + rec.id; const moi = $security.randomString(12);
  if (st.getOrSet(cle, () => moi) !== moi) return e.json(409, { message: 'Une demande de paiement est déjà en train de partir : regardez votre téléphone.' });
  try {
    const d = C.suivre(e.app, rec);
    const raison = R.relancePossible(d);
    if (raison) return e.json(400, { message: raison });
    // Carte en cours : le client revient de la page sécurisée (annulé, refusé) et peut repartir tout de suite.
    if (d.payment.status === 'pending' && !R.estCarte(d.payment.method) && Date.now() - Number(d.payment.startedAt || 0) < R.RELANCE_APRES_S * 1000) return e.json(400, { message: 'La demande de paiement vient d’être envoyée : regardez votre téléphone, puis réessayez dans quelques secondes si rien n’arrive.' });
    const b = S.corps(e);
    const moyen = R.moyensDePaiement(S.configuration(e.app)).find((m) => m.k === (b.method || d.payment.method));
    if (!moyen) return e.json(400, { message: 'Ce mode de paiement n’est pas disponible.', champ: 'method' });
    const tel = moyen.carte ? '' : R.valider.mobileMoney(b.phone || d.payment.phone);
    if (!moyen.carte && !tel) return e.json(400, { message: `Numéro ${moyen.label} invalide : 10 chiffres, commençant par 08 ou 09.`, champ: 'payphone' });
    const doc = C.demander(e.app, e.app.findRecordById('orders', rec.id), Object.assign({ callbackUrl: C.adresseNotification(e), methode: moyen.k, label: moyen.label, telephone: tel }, C.adressesCarte(e, rec.id)));
    return e.json(200, C.reponseClient(rec.id, doc));
  } finally { st.remove(cle); }
}, LIMITE.petite);

// Mode test : la page de paiement par carte de la boutique remplace celle du fournisseur ; { issue: ok | refus | annule }.
// Fermée dès qu'un vrai fournisseur encaisse.
routerAdd('POST', '/api/sokoyetu/paiement/{id}/carte-test', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const C = require(`${__hooks}/lib/commandes.js`); const P = require(`${__hooks}/lib/paiement.js`);
  const rec = C.commandeDuClient(e);
  const d = S.lire(rec); const issue = String(S.corps(e).issue || '');
  if (P.fournisseur() !== 'simulation' || !d.payment || d.payment.provider !== 'simulation' || !R.estCarte(d.payment.method)) return e.json(404, { message: 'Page de test indisponible : le paiement par carte passe par la page sécurisée du fournisseur.' });
  if (['ok', 'refus', 'annule'].indexOf(issue) < 0) return e.json(400, { message: 'Issue inconnue.' });
  if (d.status === 'open' && d.payment.status === 'pending') {
    e.app.runInTransaction((tx) => {
      const r = tx.findRecordById('orders', rec.id); const x = S.lire(r);
      if (x.payment.status !== 'pending' || x.payment.providerId !== d.payment.providerId) return;
      x.payment.simulation = { id: x.payment.providerId, issue };
      S.enregistrerCommande(tx, r, x);
    });
  }
  return e.json(200, C.reponseClient(rec.id, C.suivre(e.app, e.app.findRecordById('orders', rec.id), { intervalle: 1 })));
}, LIMITE.petite);

// Le fournisseur annonce le résultat d'un paiement. Toujours revérifié auprès de lui ; toujours répondu 200.
routerAdd('POST', '/api/sokoyetu/notification/{fournisseur}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  const C = require(`${__hooks}/lib/commandes.js`);
  try { C.notification(e.app, String(e.request.pathValue('fournisseur') || ''), S.corps(e)); } catch (err) { S.trace('error', 'Notification de paiement non traitée', { module: 'paiement', erreur: String(err) }); }
  return e.json(200, { ok: true });
}, LIMITE.commande);

// Retrouver sa commande avec son numéro et son téléphone (autre appareil, historique effacé…).
routerAdd('POST', '/api/sokoyetu/retrouver', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const b = S.corps(e);
  const n = R.numeroNettoye(b.numero); const tel = R.chiffres(R.valider.telephone(b.telephone));
  if (!R.numeroValide(n) || !tel) return e.json(400, { message: 'Indiquez le numéro de commande (6 caractères) et votre numéro de téléphone.' });
  const introuvable = () => e.json(404, { message: 'Aucune commande ne correspond à ce numéro et à ce téléphone.' });
  let rec;
  try { rec = e.app.findFirstRecordByData('orders', 'number', n); } catch (err) { return introuvable(); }
  const d = S.lire(rec);
  const telephones = [d.phone, d.customer && d.customer.phone, d.payment && d.payment.phone].map((x) => R.chiffres(R.valider.telephone(x))).filter(Boolean);
  if (telephones.indexOf(tel) < 0) return introuvable();
  return e.json(200, { id: rec.id, token: rec.getString('token') });
}, LIMITE.petite);

// Chaque minute : paiements en cours revérifiés, commandes non payées à temps annulées (stock rendu).
cronAdd('sokoyetu-paiements', '* * * * *', () => {
  require(`${__hooks}/lib/commandes.js`).surveiller($app);
});

/* ---------- Boutique : comptes clients facultatifs (voir lib/comptes.js) ---------- */

// Envoie un code de connexion sur WhatsApp (ou par SMS : canal « sms ») au numéro indiqué.
routerAdd('POST', '/api/sokoyetu/compte/code', (e) => require(`${__hooks}/lib/comptes.js`).repondre(e, (C) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  const hote = String(e.request.host || '').toLowerCase().split(':')[0].replace(/^www\./, '');
  const b = S.corps(e);
  return e.json(200, C.demanderCode(e.app, b.telephone, /\.[a-z]{2,}$/.test(hote) ? hote : '', b.canal));
}), LIMITE.petite);

// Vérifie le code et connecte le client (compte créé au premier code). Le panier et les favoris de l'appareil rejoignent le compte.
routerAdd('POST', '/api/sokoyetu/compte/connexion', (e) => require(`${__hooks}/lib/comptes.js`).repondre(e, (C) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  const b = S.corps(e);
  const rec = C.verifierCode(e.app, b.telephone, b.code, b.name);
  C.enregistrer(e.app, rec, { panier: b.panier, favoris: b.favoris, profil: b.profil }, true);
  return $apis.recordAuthResponse(e, rec, 'code', { compte: C.vue(rec), commandes: C.commandes(e.app, rec) });
}), LIMITE.compte);

// Le compte connecté : nom, téléphone, panier, favoris, coordonnées, et ses commandes (identifiant et jeton de suivi).
routerAdd('GET', '/api/sokoyetu/compte', (e) => {
  const C = require(`${__hooks}/lib/comptes.js`);
  const rec = C.exigerCompte(e);
  return e.json(200, { compte: C.vue(rec), commandes: C.commandes(e.app, rec) });
});

// Panier, favoris, coordonnées ou nom changés sur un appareil : enregistrés pour tous les autres.
routerAdd('POST', '/api/sokoyetu/compte', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  const C = require(`${__hooks}/lib/comptes.js`);
  const rec = C.exigerCompte(e);
  return e.json(200, { compte: C.enregistrer(e.app, rec, S.corps(e), false) });
}, LIMITE.compte);

// Toutes les heures : les clients avec compte qui ont laissé leur panier reçoivent un rappel gratuit (voir comptes.relancerPaniers).
cronAdd('sokoyetu-relances', '23 * * * *', () => {
  try { require(`${__hooks}/lib/comptes.js`).relancerPaniers($app); }
  catch (err) { require(`${__hooks}/lib/serveur.js`).trace('error', 'Relance des paniers impossible', { module: 'comptes', erreur: String(err) }); }
  // « Votre avis compte » : quelques jours après la livraison (voir lib/avis.js).
  try { require(`${__hooks}/lib/avis.js`).rappeler($app); }
  catch (err) { require(`${__hooks}/lib/serveur.js`).trace('error', 'Rappel des avis impossible', { module: 'avis', erreur: String(err) }); }
});
// Les mêmes rappels tout de suite (tableau technique, essais) : { relances, avis } clients prévenus.
routerAdd('POST', '/api/sokoyetu/relances', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'reglages');
  return e.json(200, { relances: require(`${__hooks}/lib/comptes.js`).relancerPaniers(e.app), avis: require(`${__hooks}/lib/avis.js`).rappeler(e.app) });
});

// Le client supprime son compte (ses commandes restent, détachées du compte).
routerAdd('POST', '/api/sokoyetu/compte/supprimer', (e) => {
  const C = require(`${__hooks}/lib/comptes.js`);
  C.supprimer(e.app, C.exigerCompte(e));
  return e.json(200, { ok: true });
}, LIMITE.petite);

/* ---------- Boutique : notifications gratuites du client (voir lib/notifications.js et lib/push.js) ---------- */

// Centre de notifications : celles du compte connecté et de cet appareil ({ appareil, langue }), les plus récentes d'abord,
// et les articles dont il attend le retour en stock.
routerAdd('POST', '/api/sokoyetu/notifications', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const N = require(`${__hooks}/lib/notifications.js`);
  const b = S.corps(e); const dest = N.destinataire(e, b);
  return e.json(200, Object.assign(N.liste(e.app, dest, b.langue), { alertes: require(`${__hooks}/lib/alertes.js`).liste(e.app, dest) }));
}, LIMITE.petite);
routerAdd('POST', '/api/sokoyetu/notifications/lues', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const N = require(`${__hooks}/lib/notifications.js`);
  const b = S.corps(e);
  return e.json(200, N.marquerLues(e.app, N.destinataire(e, b), b.ids));
}, LIMITE.petite);

// Notifications du téléphone : clé publique du serveur, abonnement du navigateur, désabonnement.
routerAdd('GET', '/api/sokoyetu/push/cle', (e) => e.json(200, { cle: require(`${__hooks}/lib/push.js`).clePublique(e.app) }));
routerAdd('POST', '/api/sokoyetu/push/abonner', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const N = require(`${__hooks}/lib/notifications.js`);
  const b = S.corps(e);
  return e.json(200, N.abonner(e.app, N.destinataire(e, b), b));
}, LIMITE.petite);
routerAdd('POST', '/api/sokoyetu/push/desabonner', (e) => e.json(200, require(`${__hooks}/lib/notifications.js`).desabonner(e.app, require(`${__hooks}/lib/serveur.js`).corps(e))), LIMITE.petite);
// Appelées par le service worker du téléphone : ce qu'il doit afficher, et son abonnement renouvelé par le navigateur.
routerAdd('POST', '/api/sokoyetu/push/attente', (e) => e.json(200, require(`${__hooks}/lib/notifications.js`).attente(e.app, require(`${__hooks}/lib/serveur.js`).corps(e))), LIMITE.petite);
routerAdd('POST', '/api/sokoyetu/push/renouveler', (e) => e.json(200, require(`${__hooks}/lib/notifications.js`).renouveler(e.app, require(`${__hooks}/lib/serveur.js`).corps(e))), LIMITE.petite);

// Chaque minute : chaque téléphone abonné qui a du nouveau reçoit un signal (gratuit).
cronAdd('sokoyetu-notifications', '* * * * *', () => {
  try { require(`${__hooks}/lib/notifications.js`).pousser($app); }
  catch (err) { require(`${__hooks}/lib/serveur.js`).trace('error', 'Tournée des notifications impossible', { module: 'push', erreur: String(err) }); }
});

/* ---------- Boutique : « Prévenez-moi » au retour en stock (voir lib/alertes.js) ---------- */

// { appareil, produit, variante } : variante '' pour l'article entier, « Rouge|M » pour une option épuisée.
routerAdd('POST', '/api/sokoyetu/alertes', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const N = require(`${__hooks}/lib/notifications.js`);
  const b = S.corps(e);
  return e.json(200, require(`${__hooks}/lib/alertes.js`).ajouter(e.app, N.destinataire(e, b), b));
}, LIMITE.petite);
routerAdd('POST', '/api/sokoyetu/alertes/retirer', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const N = require(`${__hooks}/lib/notifications.js`);
  const b = S.corps(e);
  return e.json(200, require(`${__hooks}/lib/alertes.js`).retirer(e.app, N.destinataire(e, b), b));
}, LIMITE.petite);

/* ---------- Boutique : discussion avec la boutique, le service client dans l'application (voir lib/discussions.js) ---------- */

// La discussion de ce client (son compte, sinon cet appareil) : { appareil, apres } ; les réponses de la boutique sont alors lues.
routerAdd('POST', '/api/sokoyetu/discussion', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const D = require(`${__hooks}/lib/discussions.js`);
  const b = S.corps(e);
  return e.json(200, D.lire(e.app, D.qui(e, b), b));
}, LIMITE.petite);
// Le client écrit : { appareil, texte, produit, commande, t (jeton de suivi de la commande), nom, apres }.
routerAdd('POST', '/api/sokoyetu/discussion/envoyer', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const D = require(`${__hooks}/lib/discussions.js`);
  const b = S.corps(e);
  return e.json(200, D.envoyer(e.app, D.qui(e, b), b));
}, LIMITE.petite);

/* ---------- Boutique : avis et notes des clients sur les articles (voir lib/avis.js) ---------- */

// Avis publiés d'un article : ?produit=…&page=0&note=5 (une seule note) ; résumé (moyenne, nombre, répartition).
routerAdd('GET', '/api/sokoyetu/avis', (e) => {
  const q = e.requestInfo().query || {};
  return e.json(200, require(`${__hooks}/lib/avis.js`).publics(e.app, q['produit'], q['page'], q['note']));
});
// Articles reçus que ce client peut noter : { appareil, suivis: [{ id, t }] } (commandes suivies sur ce téléphone).
routerAdd('POST', '/api/sokoyetu/avis/a-donner', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const A = require(`${__hooks}/lib/avis.js`);
  const b = S.corps(e);
  return e.json(200, A.aDonner(e.app, A.qui(e, b), b));
}, LIMITE.petite);
// Le client donne ou modifie son avis : { appareil, commande, t, produit, note, texte }.
routerAdd('POST', '/api/sokoyetu/avis/donner', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const A = require(`${__hooks}/lib/avis.js`);
  const b = S.corps(e);
  return e.json(200, A.donner(e.app, A.qui(e, b), b));
}, LIMITE.petite);

/* ---------- Boutique : cagnotte de fidélité et parrainage (voir lib/fidelite.js) ---------- */

// La cagnotte du client connecté : solde, gains à venir, historique, et son code de parrainage.
routerAdd('GET', '/api/sokoyetu/cagnotte', (e) => {
  const C = require(`${__hooks}/lib/comptes.js`);
  return e.json(200, require(`${__hooks}/lib/fidelite.js`).vue(e.app, C.exigerCompte(e)));
});
// Lien de parrainage ouvert (?code=K7M2QX) : prénom du parrain et cadeau de bienvenue du filleul.
routerAdd('GET', '/api/sokoyetu/parrainage', (e) => e.json(200, require(`${__hooks}/lib/fidelite.js`).lien(e.app, (e.requestInfo().query || {})['code'])));

/* ---------- Boutique : fréquentation (compteurs anonymes, voir lib/audience.js) ---------- */

// La boutique se signale tant qu'elle est à l'écran, et à chaque article ouvert, mis au panier ou en favori.
routerAdd('POST', '/api/sokoyetu/visite', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  try { require(`${__hooks}/lib/audience.js`).enregistrer(e.app, S.corps(e), e.request.header.get('User-Agent')); } catch (err) { S.trace('warn', 'Visite non comptée', { module: 'audience', erreur: String(err) }); }
  return e.noContent(204);
}, LIMITE.commande);

// Recherches populaires (mots seulement, sans accents) : lues à l'ouverture de la recherche, gardées une heure par le navigateur.
routerAdd('GET', '/api/sokoyetu/recherches', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  let termes = [];
  try { termes = require(`${__hooks}/lib/audience.js`).populaires(e.app); } catch (err) { S.trace('warn', 'Recherches populaires indisponibles', { module: 'audience', erreur: String(err) }); }
  e.response.header().set('Cache-Control', 'public, max-age=3600');
  return e.json(200, { termes });
});

// Chaque nuit : compteurs de plus de 90 jours effacés.
cronAdd('sokoyetu-audience', '17 3 * * *', () => {
  require(`${__hooks}/lib/audience.js`).purger($app);
  require(`${__hooks}/lib/comptes.js`).purger($app);
  require(`${__hooks}/lib/notifications.js`).purger($app);
  require(`${__hooks}/lib/alertes.js`).purger($app);
  require(`${__hooks}/lib/discussions.js`).purger($app);
  require(`${__hooks}/lib/serveur.js`).purgerCompteurs($app);
  require(`${__hooks}/lib/securite.js`).purger($app);
});

/* ---------- Surveillance : erreurs, état du serveur, alerte si le site tombe (voir lib/journal.js) ---------- */

// Une erreur dans le navigateur d'un client ou de la gérante : gardée dans le journal du serveur.
routerAdd('POST', '/api/sokoyetu/erreur', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  try { require(`${__hooks}/lib/journal.js`).signaler(e, S.corps(e)); } catch (err) { }
  return e.noContent(204);
}, $apis.bodyLimit(16 * KO));

// État du serveur, pour un service de surveillance (UptimeRobot…) et pour l'administration (détail).
routerAdd('GET', '/api/sokoyetu/sante', (e) => require(`${__hooks}/lib/journal.js`).sante(e));

// Toutes les 5 minutes : signal au service d'alerte (SOKOYETU_ALERTE_URL, voir alerte.sh).
cronAdd('sokoyetu-veille', '*/5 * * * *', () => {
  require(`${__hooks}/lib/journal.js`).veille($app);
});

/* ---------- Administration ---------- */

// Étapes d'une commande : paiement confirmé, préparation, expédition, livraison, annulation (stock restitué)…
// Le livreur ne fait que « En route » et « Livrée », sur les commandes payées à livrer ; les remboursements restent au propriétaire.
routerAdd('POST', '/api/sokoyetu/commandes/{id}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const role = S.exigerGerant(e);
  const b = S.corps(e);
  if (!R.etapePermise(role, String(b.action || ''))) return e.json(403, { message: 'Votre rôle dans l’équipe ne permet pas cette action.' });
  let sortie = null, erreur = null;
  e.app.runInTransaction((tx) => {
    let rec;
    try { rec = tx.findRecordById('orders', e.request.pathValue('id')); } catch (err) { erreur = { status: 404, message: 'Commande introuvable.' }; return; }
    if (role === 'livreur' && !R.pourLivreur(S.lire(rec))) { erreur = { status: 404, message: 'Commande introuvable.' }; return; }
    const P = S.lecteurProduits(tx);
    let r;
    try { r = R.etapeCommande(S.lire(rec), String(b.action || ''), { maintenant: Date.now(), note: b.note, produit: (id) => P.doc(id) }); }
    catch (err) { if (err instanceof R.ErreurCommande) { erreur = { status: 400, message: err.message }; return; } throw err; }
    if (r.stock === 'reserver') S.appliquerStock(tx, r.entrees, -1);
    if (r.stock === 'restituer') S.appliquerStock(tx, r.entrees, 1);
    S.enregistrerCommande(tx, rec, r.commande);
    sortie = { id: rec.id, doc: role === 'livreur' ? S.commandeLivreur(r.commande) : r.commande };
  });
  if (erreur) return e.json(erreur.status, { message: erreur.message });
  return e.json(200, sortie);
}, $apis.bodyLimit(16 * KO));

// Droit à l'effacement : nom, téléphone, adresse et références de paiement d'un client retirés de ses commandes.
routerAdd('POST', '/api/sokoyetu/clients/effacer', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  S.exigerGerant(e, 'effacer');
  const tel = R.chiffres(S.corps(e).phone);
  if (tel.length < 6) return e.json(400, { message: 'Numéro de téléphone manquant.' });
  let n = 0; const appareils = [];
  e.app.runInTransaction((tx) => {
    tx.findRecordsByFilter('orders', 'phone = {:p}', '', 10000, 0, { p: tel }).forEach((rec) => {
      if (rec.getString('appareil')) appareils.push(rec.getString('appareil'));
      rec.set('appareil', '');
      const d = S.lire(rec);
      d.phone = ''; d.customer = { name: 'Client effacé', phone: '' };
      d.shipping = Object.assign({}, d.shipping || {}, { address: '', landmark: '' });
      d.note = ''; d.adminNote = '';
      d.payment = Object.assign({}, d.payment || {}, { sender: '', phone: '', ref: d.payment && d.payment.ref ? '••••' : '' });
      d.erasedAt = Date.now();
      (d.timeline = d.timeline || []).push({ at: Date.now(), text: 'Données personnelles effacées à la demande du client' });
      S.enregistrerCommande(tx, rec, d); n++;
    });
  });
  // Notifications, abonnements, alertes et discussions du compte, des appareils de ces commandes et de ce téléphone : effacés aussi (avant le compte).
  const clients = e.app.findRecordsByFilter('clients', 'phone = {:a} || phone = {:b}', '', 10, 0, { a: tel, b: '+' + tel }).map((c) => c.id);
  require(`${__hooks}/lib/notifications.js`).effacer(e.app, clients, appareils);
  require(`${__hooks}/lib/alertes.js`).effacer(e.app, clients, appareils);
  require(`${__hooks}/lib/discussions.js`).effacer(e.app, clients, appareils, tel);
  require(`${__hooks}/lib/avis.js`).effacer(e.app, clients, tel);
  e.app.runInTransaction((tx) => require(`${__hooks}/lib/fidelite.js`).effacer(tx, tel));
  const comptes = require(`${__hooks}/lib/comptes.js`).effacerParTelephone(e.app, tel);
  return e.json(200, { effacees: n, comptes });
}, LIMITE.petite);

// Assistant IA : rédige une fiche produit à partir d'une photo.
routerAdd('POST', '/api/sokoyetu/ia/produit', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'produits');
  const IA = require(`${__hooks}/lib/ia.js`);
  try { return e.json(200, IA.fiche(S.corps(e))); }
  catch (err) {
    if (err && err.code) return e.json(err.status || 502, { code: err.code, message: 'Assistant indisponible (' + err.code + ').' });
    throw err;
  }
}, LIMITE.photo);

// Photo ajoutée à une fiche : l'assistant repère l'article, l'administration recadre et éclaire la photo.
routerAdd('POST', '/api/sokoyetu/ia/cadre', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'produits');
  const IA = require(`${__hooks}/lib/ia.js`);
  try { return e.json(200, IA.cadre(S.corps(e))); }
  catch (err) {
    if (err && err.code) return e.json(err.status || 502, { code: err.code, message: 'Assistant indisponible (' + err.code + ').' });
    throw err;
  }
}, LIMITE.photo);

// Import depuis un fournisseur (1688, Alibaba…) : titre, photos et prix d'usine ; avec ia=true, l'assistant rédige la fiche en français.
routerAdd('POST', '/api/sokoyetu/import/lien', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'produits');
  const I = require(`${__hooks}/lib/import.js`); const IA = require(`${__hooks}/lib/ia.js`);
  const b = S.corps(e);
  try {
    const r = I.lirePage(b.url);
    const out = { url: r.url, title: r.lu.title, description: r.lu.description, images: r.lu.images, price: r.lu.price, currency: r.lu.currency, fiche: null, ia: '' };
    if (b.ia && IA.active() && r.lu.images.length) {
      try { out.fiche = IA.fiche({ imageUrl: r.lu.images[0], texte: r.texte, hint: b.hint, shop: b.shop, city: b.city, collections: b.collections }); }
      catch (err) { out.ia = (err && err.code) || 'upstream_error'; }
    }
    return e.json(200, out);
  } catch (err) {
    if (err && err.code) return e.json(err.status || 502, { code: err.code, message: err.code === 'bad_url' ? 'Collez le lien d’une page produit (1688, Alibaba, AliExpress, Taobao…).' : 'Le site du fournisseur n’a pas laissé lire cette page.' });
    throw err;
  }
}, LIMITE.petite);
// Copie une photo (adresse publique) dans la médiathèque : import en masse, photos d'un fournisseur.
routerAdd('POST', '/api/sokoyetu/import/photo', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'produits');
  try { return e.json(200, require(`${__hooks}/lib/import.js`).copierPhoto(e.app, S.corps(e).url)); }
  catch (err) {
    if (err && err.code) return e.json(err.status || 502, { code: err.code, message: err.code === 'not_image' ? 'Ce lien ne mène pas à une photo (JPEG, PNG ou WebP).' : err.code === 'bad_url' ? 'Adresse de photo invalide.' : err.code === 'too_big' ? 'Photo trop lourde : 10 Mo au plus.' : 'Photo introuvable à cette adresse.' });
    throw err;
  }
}, LIMITE.petite);

// Fréquentation : en ligne maintenant, visiteurs par jour, chiffres par article (?jours=1 à 90, &graphe=7 : colonnes du graphique).
routerAdd('GET', '/api/sokoyetu/audience', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'audience');
  return e.json(200, require(`${__hooks}/lib/audience.js`).resume(e.app, (e.requestInfo().query || {})['jours'], (e.requestInfo().query || {})['graphe']));
});
routerAdd('GET', '/api/sokoyetu/audience/{id}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'audience');
  const r = require(`${__hooks}/lib/audience.js`).article(e.app, e.request.pathValue('id'), (e.requestInfo().query || {})['jours'], (e.requestInfo().query || {})['graphe']);
  return r ? e.json(200, r) : e.json(404, { message: 'Article introuvable.' });
});

// État du serveur pour l'administration.
routerAdd('GET', '/api/sokoyetu/etat', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e);
  const IA = require(`${__hooks}/lib/ia.js`);
  return e.json(200, { version: require(`${__hooks}/lib/version.js`).version, ia: IA.active(), iaQuota: IA.quota(), paiement: require(`${__hooks}/lib/paiement.js`).etat(), codes: require(`${__hooks}/lib/envoi.js`).etat() });
});

/* ---------- Administration : l'équipe (propriétaire seulement, voir lib/equipe.js) ---------- */

routerAdd('GET', '/api/sokoyetu/equipe', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'equipe');
  return e.json(200, { membres: require(`${__hooks}/lib/equipe.js`).liste(e.app) });
});
// Nouveau membre : son mot de passe provisoire n'est montré qu'une fois, dans cette réponse.
routerAdd('POST', '/api/sokoyetu/equipe', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'equipe');
  return e.json(200, require(`${__hooks}/lib/equipe.js`).ajouter(e.app, S.corps(e)));
}, LIMITE.petite);
// Rôle ou nom changé, nouveau mot de passe provisoire (« reinitialiser »).
routerAdd('POST', '/api/sokoyetu/equipe/{id}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'equipe');
  return e.json(200, require(`${__hooks}/lib/equipe.js`).modifier(e.app, e.request.pathValue('id'), S.corps(e), e.auth ? e.auth.id : ''));
}, LIMITE.petite);
routerAdd('DELETE', '/api/sokoyetu/equipe/{id}', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'equipe');
  return e.json(200, require(`${__hooks}/lib/equipe.js`).retirer(e.app, e.request.pathValue('id'), e.auth ? e.auth.id : ''));
});

/* ---------- Administration : avis des clients (propriétaire et vendeurs, voir lib/avis.js) ---------- */
// La liste se lit dans la collection « avis » (temps réel) ; ici, { action: 'publier' | 'masquer', motif } ou { reponse }.
routerAdd('POST', '/api/sokoyetu/avis/{id}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'avis');
  const auteur = e.auth ? (e.auth.getString('name') || e.auth.email()) : '';
  return e.json(200, require(`${__hooks}/lib/avis.js`).moderer(e.app, e.request.pathValue('id'), S.corps(e), auteur));
}, LIMITE.petite);

/* ---------- Administration : cagnotte d'un client (voir lib/fidelite.js) ---------- */
// Solde, gains, cagnotte utilisée et filleuls du client de ce téléphone.
routerAdd('GET', '/api/sokoyetu/clients/{tel}/cagnotte', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'clients');
  return e.json(200, require(`${__hooks}/lib/fidelite.js`).pourClient(e.app, e.request.pathValue('tel')));
});
// Geste de la boutique (propriétaire) : { montant, motif, jeton } ajoutés à sa cagnotte ; le client en est prévenu.
routerAdd('POST', '/api/sokoyetu/clients/{tel}/cagnotte', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'cagnotte');
  const auteur = e.auth ? (e.auth.getString('name') || e.auth.email()) : '';
  return e.json(200, require(`${__hooks}/lib/fidelite.js`).offrir(e.app, e.request.pathValue('tel'), S.corps(e), auteur));
}, LIMITE.petite);

/* ---------- Administration : messages des clients (propriétaire et vendeurs, voir lib/discussions.js) ---------- */
// La liste des discussions se lit dans la collection « discussions » (temps réel) ; ici, une discussion et ses messages.

// Messages (?apres=<id> : seulement les nouveaux) et commandes de ce client.
routerAdd('GET', '/api/sokoyetu/discussions/{id}', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'messages');
  return e.json(200, require(`${__hooks}/lib/discussions.js`).vue(e.app, e.request.pathValue('id'), (e.requestInfo().query || {})['apres']));
});
// Réponse de l'équipe { texte, produit, commande, apres } (le client est prévenu), ou { action: 'lue' | 'traitee' }.
routerAdd('POST', '/api/sokoyetu/discussions/{id}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const D = require(`${__hooks}/lib/discussions.js`);
  S.exigerGerant(e, 'messages');
  const b = S.corps(e); const id = e.request.pathValue('id');
  if (b.action) return e.json(200, D.marquer(e.app, id, String(b.action)));
  const auteur = e.auth ? (e.auth.getString('name') || e.auth.email()) : '';
  return e.json(200, D.repondre(e.app, id, auteur, b));
}, LIMITE.petite);
routerAdd('DELETE', '/api/sokoyetu/discussions/{id}', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'messages');
  return e.json(200, require(`${__hooks}/lib/discussions.js`).supprimer(e.app, e.request.pathValue('id')));
});

/* ---------- Administration : clients en attente d'un article, annonces aux clients (voir lib/alertes.js) ---------- */

// Combien de clients attendent le retour de chaque article épuisé (et de chaque option).
routerAdd('GET', '/api/sokoyetu/alertes/attente', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'produits');
  return e.json(200, { produits: require(`${__hooks}/lib/alertes.js`).attente(e.app) });
});
// Promotions et nouveautés annoncées aux téléphones qui les acceptent (propriétaire) : { titre, texte, url }.
routerAdd('GET', '/api/sokoyetu/annonces', (e) => {
  require(`${__hooks}/lib/serveur.js`).exigerGerant(e, 'annonces');
  return e.json(200, require(`${__hooks}/lib/alertes.js`).annonces(e.app));
});
routerAdd('POST', '/api/sokoyetu/annonces', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'annonces');
  const auteur = e.auth ? (e.auth.getString('name') || e.auth.email()) : '';
  return e.json(200, require(`${__hooks}/lib/alertes.js`).annoncer(e.app, auteur, S.corps(e)));
}, LIMITE.petite);

// Journal des erreurs (serveur et navigateurs) des derniers jours : ?jours=7&limite=100.
routerAdd('GET', '/api/sokoyetu/journal', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e, 'journal');
  const q = e.requestInfo().query || {};
  return e.json(200, { erreurs: require(`${__hooks}/lib/journal.js`).lire(e.app, q['jours'], q['limite']) });
});

/* ---------- Champs techniques tenus à jour automatiquement ---------- */

function majProduit(e) {
  const S = require(`${__hooks}/lib/serveur.js`);
  const d = S.lire(e.record);
  const now = Date.now();
  if (!d.createdAt) d.createdAt = now;
  d.updatedAt = now;
  e.record.set('doc', d);
  e.record.set('active', d.status !== 'draft');
  return e.next();
}
onRecordCreateRequest(majProduit, 'products');
onRecordUpdateRequest(majProduit, 'products');

// Catalogue public gardé en mémoire (lib/pages.js) : reconstruit à la prochaine visite après tout changement,
// y compris le stock modifié par une commande.
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib/pages.js`).catalogueChange(); return e.next(); }, 'products', 'collections', 'banners', 'config');
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib/pages.js`).catalogueChange(); return e.next(); }, 'products', 'collections', 'banners', 'config');
onRecordAfterDeleteSuccess((e) => { require(`${__hooks}/lib/pages.js`).catalogueChange(); return e.next(); }, 'products', 'collections', 'banners', 'config');

// Article de nouveau en stock (fiche modifiée, commande annulée qui rend son stock) : les clients qui l'attendaient sont prévenus.
onRecordAfterUpdateSuccess((e) => {
  try { require(`${__hooks}/lib/alertes.js`).apresProduit(e.app, e.record); }
  catch (err) { require(`${__hooks}/lib/serveur.js`).trace('error', 'Alertes de retour en stock non traitées', { module: 'alertes', produit: e.record.id, erreur: String(err) }); }
  return e.next();
}, 'products');
onRecordAfterDeleteSuccess((e) => {
  try { require(`${__hooks}/lib/alertes.js`).retirerProduit(e.app, e.record.id); } catch (err) { }
  return e.next();
}, 'products');

function majRemise(e) {
  const S = require(`${__hooks}/lib/serveur.js`);
  e.record.set('code', S.R.valider.codePromo(S.lire(e.record).code));
  return e.next();
}
onRecordCreateRequest(majRemise, 'discounts');
onRecordUpdateRequest(majRemise, 'discounts');

// Médiathèque : 10 Mo au plus pour une photo (la limite de 30 Mo du champ vaut pour les vidéos).
onRecordCreateRequest((e) => {
  for (const f of e.findUploadedFiles('file') || []) {
    if (/\.(jpe?g|png|webp|gif|heic|avif)$/i.test(String(f.originalName || f.name || '')) && Number(f.size) > 10 * 1048576) throw new BadRequestError('Photo trop lourde : 10 Mo au plus.');
  }
  return e.next();
}, 'media');

// Commande retouchée depuis le tableau de bord technique : champs de recherche réalignés sur le document.
onRecordUpdateRequest((e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.champsCommande(e.record, S.lire(e.record));
  return e.next();
}, 'orders');

/* ---------- Comptes de l'administration et du tableau technique (voir lib/securite.js) ---------- */

// Mots de passe refusés : après plusieurs échecs, le compte se verrouille un moment, d'où que viennent les essais.
onRecordAuthWithPasswordRequest((e) => require(`${__hooks}/lib/securite.js`).connexion(e), 'admins', '_superusers');
// Un membre de l'équipe ne change jamais lui-même son rôle (la règle de la collection le refuse déjà) : seul le
// propriétaire le change, page « Équipe » (routes /api/sokoyetu/equipe, qui n'utilisent pas cette API).
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth() && e.record.getString('role') !== e.record.original().getString('role')) throw new ForbiddenError('Seul le propriétaire change les rôles de l’équipe (page « Équipe »).');
  return e.next();
}, 'admins');

/* ---------- Ce que les clients ne voient jamais : coûts d'achat, notes internes, contrôles ---------- */

onRecordEnrich((e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  const role = S.roleDe(e.requestInfo);
  if (!role) { e.record.set('doc', S.commandePublique(S.lire(e.record))); e.record.hide('token', 'pay_ref'); }
  else if (role === 'livreur') { e.record.set('doc', S.commandeLivreur(S.lire(e.record))); e.record.hide('token', 'pay_ref'); }
  return e.next();
}, 'orders');

onRecordEnrich((e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  const role = S.roleDe(e.requestInfo);
  if (!role || !S.R.peut(role, 'produits')) e.record.set('doc', S.produitPublic(S.lire(e.record)));
  return e.next();
}, 'products');

/* ---------- Console : compte administrateur ---------- */
//   ./pocketbase sokoyetu-admin e-mail mot-de-passe
$app.rootCmd.addCommand(new Command({
  use: 'sokoyetu-admin',
  short: 'Crée le compte administrateur de la boutique ou change son mot de passe',
  run: (cmd, args) => {
    const email = String(args[0] || '').trim().toLowerCase(), pass = String(args[1] || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pass.length < 10) { console.error('Usage : sokoyetu-admin e-mail mot-de-passe (10 caractères minimum)'); $os.exit(1); }
    let rec;
    try { rec = $app.findAuthRecordByEmail('admins', email); }
    catch (e) { rec = new Record($app.findCollectionByNameOrId('admins')); rec.setEmail(email); }
    rec.setPassword(pass); rec.setVerified(true);
    $app.save(rec);
    console.log('Compte administrateur prêt : ' + email);
  }
}));
