/*
 * Sokoyetu — suivi des commandes payées par Mobile Money, côté serveur.
 * La commande naît « en attente de paiement » (stock réservé). Elle est validée quand le fournisseur confirme ;
 * sans paiement dans le délai (réglage holdMinutes), elle s'annule d'elle-même et ses articles reviennent en vente.
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;
const P = require(`${__hooks}/lib/paiement.js`);

const enCours = (d) => d.status === 'open' && !!d.payment && (d.payment.status === 'pending' || d.payment.status === 'failed');
const avecReference = (d, id) => Object.assign({}, d, { payment: Object.assign({}, d.payment, { providerId: id }) });

/* Applique une réponse du fournisseur (et l'échéance) à la commande, dans une transaction. Renvoie le document à jour. */
function appliquer(app, id, r) {
  let doc = null;
  app.runInTransaction((tx) => {
    const rec = tx.findRecordById('orders', id);
    let d = S.lire(rec); const now = Date.now();
    d.payment = d.payment || {}; d.payment.checkedAt = now;
    if (r && r.etat === 'paye') {
      const x = R.paiementConfirme(d, { maintenant: now, reference: r.reference });
      if (x.stock === 'reserver') S.appliquerStock(tx, x.entrees, -1);
      d = x.commande;
    } else if (r && r.etat === 'echec' && d.payment.status === 'pending' && (!r.id || r.id === d.payment.providerId)) {
      d = R.paiementEchoue(d, { maintenant: now, raison: r.message });
    }
    if (enCours(d) && Number(d.expiresAt) && now > Number(d.expiresAt)) {
      const x = R.paiementExpire(d, { maintenant: now });
      if (x.stock === 'restituer') S.appliquerStock(tx, x.entrees, 1);
      d = x.commande;
    }
    S.enregistrerCommande(tx, rec, d);
    doc = d;
  });
  return doc;
}

/* Revérifie le paiement auprès du fournisseur (au plus une fois par intervalle), et annule la commande à l'échéance. */
function suivre(app, rec, opts) {
  const d = S.lire(rec);
  if (!enCours(d)) return d;
  const now = Date.now();
  const echeance = Number(d.expiresAt) && now > Number(d.expiresAt);
  const recent = now - Number(d.payment.checkedAt || 0) < ((opts && opts.intervalle) || 3000);
  if (echeance) {
    // Dernière chance : une des demandes envoyées a-t-elle été payée entre-temps ?
    for (const id of [d.payment.providerId].concat(d.payment.previous || []).filter(Boolean)) {
      const r = P.verifier(avecReference(d, id));
      if (r.etat === 'paye') return appliquer(app, rec.id, r);
    }
    return appliquer(app, rec.id, null);
  }
  if (d.payment.status !== 'pending' || recent) return d;
  return appliquer(app, rec.id, Object.assign({ id: d.payment.providerId }, P.verifier(d)));
}

/* Envoie une (nouvelle) demande de paiement au fournisseur. opts = { callbackUrl, retourUrl, methode, label, telephone } */
function demander(app, rec, opts) {
  const d0 = S.lire(rec);
  const essai = R.copie(d0);
  if (opts.methode) { essai.payment.method = opts.methode; essai.payment.label = opts.label; }
  if (opts.telephone) essai.payment.phone = opts.telephone;
  const r = P.demarrer(essai, { callbackUrl: opts.callbackUrl, retourUrl: opts.retourUrl });
  let doc = null;
  app.runInTransaction((tx) => {
    const frais = tx.findRecordById('orders', rec.id);
    const now = Date.now();
    let d = R.paiementEnvoye(S.lire(frais), { maintenant: now, providerId: r.id || '', url: r.url || '', methode: opts.methode, label: opts.label, telephone: opts.telephone });
    if (r.etat === 'echec') d = R.paiementEchoue(d, { maintenant: now, raison: r.message });
    if (r.etat === 'paye') d = R.paiementConfirme(d, { maintenant: now, reference: r.reference }).commande;
    S.enregistrerCommande(tx, frais, d);
    doc = d;
  });
  return doc;
}

/* Ce que le client reçoit : sa commande (vue publique) et l'état du paiement. */
function reponseClient(id, d) {
  const p = d.payment || {};
  return {
    id, order: S.commandePublique(d),
    paiement: { etat: p.status || '', message: p.error || '', expireA: Number(d.expiresAt) || 0, tentatives: Number(p.attempts) || 0, relance: R.relancePossible(d) === '', test: !!p.test,
      url: p.status === 'pending' && d.status === 'open' ? String(p.url || '') : '' }
  };
}

/* La commande demandée par un client : son jeton est exigé (ou un compte d'administration). */
function commandeDuClient(e) {
  let rec;
  try { rec = e.app.findRecordById('orders', e.request.pathValue('id')); } catch (err) { throw new NotFoundError('Commande introuvable.'); }
  const t = String(e.requestInfo().query['t'] || '');
  if (!S.estGerant(e.requestInfo()) && (!t || rec.getString('token') !== t)) throw new NotFoundError('Commande introuvable.');
  return rec;
}

const hoteBoutique = (e) => String($os.getenv('SOKOYETU_DOMAINE') || e.request.host || '').replace(/^(www|admin)\./, '').split(':')[0];
/* Adresse à laquelle le fournisseur annonce le résultat d'un paiement. */
function adresseNotification(e) {
  return `https://${hoteBoutique(e)}/api/sokoyetu/notification/${P.fournisseur()}`;
}
/* Page de la boutique où le client revient après avoir payé sur la page du fournisseur (nyole). */
function adresseRetour(e, id) {
  const h = String($os.getenv('SOKOYETU_RETOUR') || `https://${hoteBoutique(e)}`).replace(/\/+$/, '');
  return `${h}/paiement/${encodeURIComponent(id)}`;
}

/* Chaque minute : paiements en cours revérifiés, commandes échues annulées. */
function surveiller(app) {
  let recs = [];
  try { recs = app.findRecordsByFilter('orders', "status = 'open' && (pay_status = 'pending' || pay_status = 'failed')", '-created', 300, 0); } catch (e) { return 0; }
  recs.forEach((rec) => { try { suivre(app, rec, { intervalle: 20000 }); } catch (err) { console.log('sokoyetu paiement', rec.id, err); } });
  return recs.length;
}

/* Notification du fournisseur : on retrouve la commande, puis on revérifie le paiement auprès de lui. */
function notification(app, nom, corps) {
  const ref = P.commandeConcernee(nom, corps);
  if (!ref) return false;
  let rec = null;
  if (ref.providerId) { try { rec = app.findFirstRecordByData('orders', 'pay_ref', ref.providerId); } catch (e) { } }
  if (!rec && ref.numero) { try { rec = app.findFirstRecordByData('orders', 'number', R.numeroNettoye(ref.numero)); } catch (e) { } }
  if (!rec) return false;
  const d = S.lire(rec);
  const id = ref.providerId || d.payment.providerId;
  if (!id || R.estPayee(d)) return true;
  appliquer(app, rec.id, Object.assign({ id }, P.verifier(avecReference(d, id))));
  return true;
}

module.exports = { suivre, demander, appliquer, reponseClient, commandeDuClient, adresseNotification, adresseRetour, surveiller, notification };
