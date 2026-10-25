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

routerUse($apis.gzip());

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
    ? "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
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
  const code = R.valider.codePromo(b.discountCode);
  const d = R.devis({ cfg: S.configuration(e.app), produit: (id) => P.doc(id), lignes: b.items, zoneId: b.zoneId, code: b.discountCode, remise: code ? S.remiseParCode(e.app, code) : null, maintenant: Date.now() });
  d.lignes.forEach((l) => { delete l.cost; });
  return e.json(200, { lignes: d.lignes, problemes: d.problemes, sousTotal: d.sousTotal, remise: d.remise, livraison: d.livraison, total: d.total, zoneId: d.zone ? d.zone.id : '' });
});

/*
 * Enregistre une commande payée par Mobile Money. Tout est recalculé ici, puis enregistré d'un bloc
 * (commande + réservation du stock). Renvoyer deux fois la même commande (connexion coupée) ne crée qu'une commande.
 */
routerAdd('POST', '/api/sokoyetu/commander', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  const b = S.corps(e);
  if (b.website) return e.json(400, { message: 'Vérification impossible. Rechargez la page et réessayez.' });
  const jeton = R.valider.jeton(b.token);
  if (!jeton) return e.json(400, { message: 'Jeton de commande invalide. Rechargez la page et réessayez.' });
  try {
    const deja = e.app.findFirstRecordByData('orders', 'token', jeton);
    return e.json(200, { id: deja.id, order: S.commandePublique(S.lire(deja)) });
  } catch (err) { /* nouvelle commande */ }

  let resultat = null, erreur = null;
  e.app.runInTransaction((tx) => {
    const P = S.lecteurProduits(tx);
    const code = R.valider.codePromo(b.discountCode);
    let prep;
    try {
      prep = R.preparerCommande({
        cfg: S.configuration(tx), produit: (id) => P.doc(id), remise: code ? S.remiseParCode(tx, code) : null,
        saisie: b, maintenant: Date.now(), numero: $security.randomStringWithAlphabet(5, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789')
      });
    } catch (err) {
      if (err instanceof R.ErreurCommande) { erreur = { message: err.message, champ: err.champ }; return; }
      throw err;
    }
    S.appliquerStock(tx, prep.reserve, -1);
    const rec = new Record(tx.findCollectionByNameOrId('orders'));
    rec.set('doc', prep.commande);
    rec.set('token', jeton);
    rec.set('phone', prep.commande.phone);
    rec.set('status', 'open');
    tx.save(rec);
    resultat = { id: rec.id, order: S.commandePublique(prep.commande) };
  });
  if (erreur) return e.json(400, erreur);
  return e.json(200, resultat);
});

/* ---------- Administration ---------- */

// Étapes d'une commande : paiement confirmé, préparation, expédition, livraison, annulation (stock restitué)…
routerAdd('POST', '/api/sokoyetu/commandes/{id}', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  S.exigerGerant(e);
  const b = S.corps(e);
  let sortie = null, erreur = null;
  e.app.runInTransaction((tx) => {
    let rec;
    try { rec = tx.findRecordById('orders', e.request.pathValue('id')); } catch (err) { erreur = { status: 404, message: 'Commande introuvable.' }; return; }
    const P = S.lecteurProduits(tx);
    let r;
    try { r = R.etapeCommande(S.lire(rec), String(b.action || ''), { maintenant: Date.now(), note: b.note, produit: (id) => P.doc(id) }); }
    catch (err) { if (err instanceof R.ErreurCommande) { erreur = { status: 400, message: err.message }; return; } throw err; }
    if (r.stock === 'reserver') S.appliquerStock(tx, r.entrees, -1);
    if (r.stock === 'restituer') S.appliquerStock(tx, r.entrees, 1);
    rec.set('doc', r.commande);
    rec.set('status', r.commande.status);
    tx.save(rec);
    sortie = { id: rec.id, doc: r.commande };
  });
  if (erreur) return e.json(erreur.status, { message: erreur.message });
  return e.json(200, sortie);
});

// Droit à l'effacement : nom, téléphone, adresse et références de paiement d'un client retirés de ses commandes.
routerAdd('POST', '/api/sokoyetu/clients/effacer', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
  S.exigerGerant(e);
  const tel = R.chiffres(S.corps(e).phone);
  if (tel.length < 6) return e.json(400, { message: 'Numéro de téléphone manquant.' });
  let n = 0;
  e.app.runInTransaction((tx) => {
    tx.findRecordsByFilter('orders', 'phone = {:p}', '', 10000, 0, { p: tel }).forEach((rec) => {
      const d = S.lire(rec);
      d.phone = ''; d.customer = { name: 'Client effacé', phone: '' };
      d.shipping = Object.assign({}, d.shipping || {}, { address: '', landmark: '' });
      d.note = ''; d.adminNote = '';
      d.payment = Object.assign({}, d.payment || {}, { sender: '', ref: d.payment && d.payment.ref ? '••••' : '' });
      d.erasedAt = Date.now();
      (d.timeline = d.timeline || []).push({ at: Date.now(), text: 'Données personnelles effacées à la demande du client' });
      rec.set('doc', d); rec.set('phone', '');
      tx.save(rec); n++;
    });
  });
  return e.json(200, { effacees: n });
});

// Assistant IA : rédige une fiche produit à partir d'une photo.
routerAdd('POST', '/api/sokoyetu/ia/produit', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e);
  const IA = require(`${__hooks}/lib/ia.js`);
  try { return e.json(200, IA.fiche(S.corps(e))); }
  catch (err) {
    if (err && err.code) return e.json(err.status || 502, { code: err.code, message: 'Assistant indisponible (' + err.code + ').' });
    throw err;
  }
});

// État du serveur pour l'administration.
routerAdd('GET', '/api/sokoyetu/etat', (e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  S.exigerGerant(e);
  return e.json(200, { version: require(`${__hooks}/lib/version.js`).version, ia: require(`${__hooks}/lib/ia.js`).active() });
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

function majRemise(e) {
  const S = require(`${__hooks}/lib/serveur.js`);
  e.record.set('code', S.R.valider.codePromo(S.lire(e.record).code));
  return e.next();
}
onRecordCreateRequest(majRemise, 'discounts');
onRecordUpdateRequest(majRemise, 'discounts');

/* ---------- Ce que les clients ne voient jamais : coûts d'achat, notes internes, contrôles ---------- */

onRecordEnrich((e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  if (!S.estGerant(e.requestInfo)) { e.record.set('doc', S.commandePublique(S.lire(e.record))); e.record.hide('token'); }
  return e.next();
}, 'orders');

onRecordEnrich((e) => {
  const S = require(`${__hooks}/lib/serveur.js`);
  if (!S.estGerant(e.requestInfo)) e.record.set('doc', S.produitPublic(S.lire(e.record)));
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
