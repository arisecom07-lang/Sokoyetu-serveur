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
      const x = R.paiementConfirme(d, { maintenant: now, reference: r.reference, id: r.id });
      if (x.stock === 'reserver') S.appliquerStock(tx, x.entrees, -1);
      if (x.double) S.trace('error', 'Commande payée deux fois : à rembourser', { module: 'paiement', commande: d.number, reference: r.reference || r.id, montant: d.total });
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
      if (r.etat === 'paye') return appliquer(app, rec.id, Object.assign({ id }, r));
    }
    return appliquer(app, rec.id, null);
  }
  if (d.payment.status !== 'pending' || recent) return d;
  return appliquer(app, rec.id, Object.assign({ id: d.payment.providerId }, P.verifier(d)));
}

/* Envoie une (nouvelle) demande de paiement au fournisseur. opts = { callbackUrl, methode, label, telephone } */
function demander(app, rec, opts) {
  const d0 = S.lire(rec);
  const essai = R.copie(d0);
  if (opts.methode) { essai.payment.method = opts.methode; essai.payment.label = opts.label; }
  if (opts.telephone) essai.payment.phone = opts.telephone;
  const r = P.demarrer(essai, { callbackUrl: opts.callbackUrl });
  let doc = null;
  app.runInTransaction((tx) => {
    const frais = tx.findRecordById('orders', rec.id);
    const now = Date.now();
    let d = R.paiementEnvoye(S.lire(frais), { maintenant: now, providerId: r.id || '', methode: opts.methode, label: opts.label, telephone: opts.telephone });
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
    paiement: { etat: p.status || '', message: p.error || '', expireA: Number(d.expiresAt) || 0, tentatives: Number(p.attempts) || 0, relance: R.relancePossible(d) === '', test: !!p.test }
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

/* Adresse à laquelle le fournisseur annonce le résultat d'un paiement. */
function adresseNotification(e) {
  const hote = String($os.getenv('SOKOYETU_DOMAINE') || e.request.host || '').replace(/^(www|admin)\./, '').split(':')[0];
  return `https://${hote}/api/sokoyetu/notification/${P.fournisseur()}`;
}

/*
 * Chaque minute : paiements en cours revérifiés, commandes échues annulées.
 * Une seule tournée à la fois, 45 secondes au plus (le fournisseur peut être lent) ; les demandes précédentes d'une
 * commande (nouvelle tentative du client) sont aussi revérifiées : un paiement validé en retard est reconnu tout de suite.
 */
const DUREE_TOURNEE = 45000;
const MAX_ANCIENNES = 40; // vérifications de demandes précédentes par tournée
function surveiller(app) {
  const st = app.store(); const moi = $security.randomString(12); const debut = Date.now();
  const tenu = st.getOrSet('paiements:tournee', () => moi + ':' + debut);
  if (tenu !== moi + ':' + debut) {
    // Tournée précédente bloquée plus de 5 minutes (arrêt brutal) : reprise.
    if (debut - Number(String(tenu).split(':')[1] || 0) < 300000) return 0;
    st.set('paiements:tournee', moi + ':' + debut);
  }
  let n = 0;
  try {
    let recs = [];
    try { recs = app.findRecordsByFilter('orders', "status = 'open' && (pay_status = 'pending' || pay_status = 'failed')", '-created', 300, 0); } catch (e) { return 0; }
    let anciennes = 0;
    for (const rec of recs) {
      if (Date.now() - debut > DUREE_TOURNEE) { S.trace('warn', 'Suivi des paiements interrompu : tournée trop longue', { module: 'paiement', restantes: recs.length - n }); break; }
      n++;
      try {
        const d = S.lire(rec);
        // Demandes précédentes encore en attente (le client a réessayé) : l'une d'elles a peut-être été payée.
        const precedentes = ((d.payment && d.payment.previous) || []).filter(Boolean);
        let payee = null;
        for (const id of precedentes) {
          if (anciennes >= MAX_ANCIENNES || P.etat().panne) break;
          anciennes++;
          const r = P.verifier(avecReference(d, id));
          if (r.etat === 'paye') { payee = Object.assign({ id }, r); break; }
        }
        if (payee) appliquer(app, rec.id, payee); else suivre(app, rec, { intervalle: 20000 });
      } catch (err) { S.trace('error', 'Suivi du paiement impossible', { module: 'paiement', commande: rec.getString('number'), erreur: String(err) }); }
    }
  } finally {
    if (st.get('paiements:tournee') === moi + ':' + debut) st.remove('paiements:tournee');
  }
  return n;
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
  if (!id) return true;
  if (R.estPayee(d)) {
    // Déjà payée : si c'est une AUTRE demande de la même commande qui vient d'être payée, le client a payé deux fois.
    const payee = d.payment.paidId || d.payment.providerId;
    if (id === payee || (d.payment.duplicates || []).some((x) => x && x.id === id)) return true;
    const r = P.verifier(avecReference(d, id));
    if (r.etat === 'paye') appliquer(app, rec.id, Object.assign({ id }, r));
    return true;
  }
  appliquer(app, rec.id, Object.assign({ id }, P.verifier(avecReference(d, id))));
  return true;
}

module.exports = { suivre, demander, appliquer, reponseClient, commandeDuClient, adresseNotification, surveiller, notification };
