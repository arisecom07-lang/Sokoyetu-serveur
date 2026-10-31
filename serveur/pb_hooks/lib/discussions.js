/*
 * Sokoyetu — discussion du client avec la boutique : le service client dans l'application, gratuit (ni SMS ni WhatsApp).
 *
 *   - Le client écrit depuis son compte, sinon depuis cet appareil (jeton d'appareil, comme les notifications), à propos
 *     d'un article ou d'une de ses commandes s'il le veut.
 *   - L'équipe (propriétaire et vendeurs : droit « messages ») répond depuis l'administration, page Messages.
 *   - Chaque réponse prévient le client par une notification gratuite (centre de notifications et téléphone).
 *
 * Une discussion par client : collection « discussions » (résumé, lu en temps réel par l'administration), messages dans
 * sokoyetu_messages. Une fois le client connecté, la discussion de son appareil rejoint celle de son compte.
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;

const MONTRES = 100;                 // derniers messages envoyés à l'écran
const GARDE = 365 * 864e5;           // discussion oubliée après un an sans message
const POUR = "((client != '' AND client = {:c}) OR (appareil != '' AND appareil = {:a}))";
const MODELE = { id: 0, auteur: '', texte: '', produit: '', commande: '', numero: '', par: '', cree: 0 };

function lignes(app, sql, params, modele) {
  const l = arrayOf(new DynamicModel(modele));
  app.db().newQuery(sql).bind(params || {}).all(l);
  return l;
}
const enregistrement = (app, id) => { try { return app.findRecordById('discussions', String(id || '')); } catch (e) { return null; } };
const premiere = (app, filtre, params) => app.findRecordsByFilter('discussions', filtre, '-maj', 1, 0, params)[0] || null;
const erreurSaisie = (err) => (err instanceof R.ErreurCommande ? new BadRequestError(err.message) : err);

/* Qui écrit : le compte connecté (enregistrement) et/ou cet appareil (empreinte du jeton envoyé par la boutique). */
function qui(e, b) {
  const compte = require(`${__hooks}/lib/comptes.js`).compteDe(e);
  return { compte, client: compte ? compte.id : '', appareil: require(`${__hooks}/lib/notifications.js`).empreinte(b && b.appareil) };
}

/* Messages d'une discussion (après le message « apres », sinon les derniers), du plus ancien au plus récent. */
function messages(app, discussion, apres, equipe) {
  const l = lignes(app, `SELECT m.id AS id, m.auteur AS auteur, m.texte AS texte, m.produit AS produit, m.commande AS commande,
      COALESCE(o.number, '') AS numero, m.par AS par, m.cree AS cree
    FROM sokoyetu_messages m LEFT JOIN orders o ON m.commande != '' AND o.id = m.commande
    WHERE m.discussion = {:d} AND m.id > {:apres} ORDER BY m.id DESC LIMIT ${MONTRES}`, { d: discussion, apres: Math.max(0, Number(apres) || 0) }, MODELE);
  // Copiés avant d'être remis dans l'ordre : inverser la liste lue en place mélangerait ses lignes.
  return l.map((x) => {
    const m = { id: Number(x.id), auteur: String(x.auteur), texte: String(x.texte), produit: String(x.produit), commande: x.commande ? { id: String(x.commande), numero: String(x.numero) } : null, cree: Number(x.cree) };
    if (equipe) m.par = String(x.par);
    return m;
  }).reverse();
}

/* Commandes de ce client (son compte, son téléphone, ou passées depuis son appareil), les plus récentes d'abord. */
function commandesDe(app, d) {
  return lignes(app, `SELECT id FROM orders WHERE (client != '' AND client = {:c}) OR (phone != '' AND phone = {:p}) OR (appareil != '' AND appareil = {:a})
    ORDER BY created DESC LIMIT 20`, { c: d.getString('client'), p: R.chiffres(d.getString('telephone')), a: d.getString('appareil') }, { id: '' }).map((x) => String(x.id));
}

/* Nom et téléphone montrés à l'équipe : ceux du compte, sinon le nom donné dans la discussion, sinon la dernière commande. */
function identite(app, d, q, nom) {
  if (q.compte) {
    d.set('telephone', q.compte.getString('phone'));
    if (q.compte.getString('name')) d.set('nom', q.compte.getString('name'));
  }
  const donne = R.nettoyer(nom, 60);
  if (donne && !(q.compte && q.compte.getString('name'))) d.set('nom', donne);
  if (d.getString('nom') && d.getString('telephone')) return;
  const o = lignes(app, `SELECT COALESCE(CASE WHEN json_valid(doc) THEN json_extract(doc, '$.customer.name') END, '') AS nom, phone FROM orders
    WHERE (client != '' AND client = {:c}) OR (appareil != '' AND appareil = {:a}) ORDER BY created DESC LIMIT 1`, { c: q.client, a: q.appareil }, { nom: '', phone: '' })[0];
  if (!o) return;
  if (!d.getString('nom')) d.set('nom', R.nettoyer(String(o.nom), 60));
  if (!d.getString('telephone')) d.set('telephone', String(o.phone));
}

/* Résumé de la discussion recalculé depuis ses messages (après la réunion de deux discussions). */
function resumer(app, d) {
  const der = lignes(app, 'SELECT auteur, texte, cree FROM sokoyetu_messages WHERE discussion = {:d} ORDER BY id DESC LIMIT 1', { d: d.id }, { auteur: '', texte: '', cree: 0 })[0];
  const n = lignes(app, "SELECT COUNT(*) AS n FROM sokoyetu_messages WHERE discussion = {:d} AND auteur = 'client' AND cree > {:t}", { d: d.id, t: d.getInt('lu_boutique') }, { n: 0 })[0];
  d.set('dernier', der ? R.apercuMessage(String(der.texte), 160) : '');
  d.set('auteur', der ? String(der.auteur) : '');
  if (der) d.set('maj', Number(der.cree));
  d.set('non_lus', Number(n.n));
  d.set('a_repondre', !!der && String(der.auteur) === 'client');
  app.save(d);
}

/* Discussion de ce client : celle de son compte, sinon celle de cet appareil. Connecté, celle de l'appareil rejoint son compte. */
function trouver(app, q) {
  const parCompte = q.client ? premiere(app, 'client = {:c}', { c: q.client }) : null;
  const parAppareil = q.appareil ? premiere(app, "client = '' && appareil = {:a}", { a: q.appareil }) : null;
  if (!q.client || !parAppareil) return parCompte || parAppareil;
  if (!parCompte) {
    parAppareil.set('client', q.client); parAppareil.set('appareil', '');
    identite(app, parAppareil, q, '');
    app.save(parAppareil);
    return parAppareil;
  }
  app.runInTransaction((tx) => {
    tx.db().newQuery('UPDATE sokoyetu_messages SET discussion = {:a} WHERE discussion = {:b}').bind({ a: parCompte.id, b: parAppareil.id }).execute();
    tx.delete(tx.findRecordById('discussions', parAppareil.id));
    resumer(tx, tx.findRecordById('discussions', parCompte.id));
  });
  return enregistrement(app, parCompte.id);
}

/* ---------- Côté client ---------- */

/*
 * La discussion à l'écran : ses messages (après « apres » pour une mise à jour) et le moment où l'équipe l'a lue.
 * Les réponses de la boutique sont alors lues par le client, et leurs notifications aussi.
 */
function lire(app, q, b) {
  const d = trouver(app, q);
  if (!d) return { discussion: null, messages: [] };
  const recu = Number(lignes(app, "SELECT COALESCE(MAX(cree), 0) AS t FROM sokoyetu_messages WHERE discussion = {:d} AND auteur = 'boutique'", { d: d.id }, { t: 0 })[0].t);
  if (recu > d.getInt('lu_client')) {
    const t = Date.now();
    d.set('lu_client', t); app.save(d);
    app.db().newQuery(`UPDATE sokoyetu_notifications SET lu = {:t} WHERE lu = 0 AND type = 'message' AND ${POUR}`).bind({ t, c: q.client, a: q.appareil }).execute();
  }
  return { discussion: { id: d.id, luBoutique: d.getInt('lu_boutique') }, messages: messages(app, d.id, b && b.apres, false) };
}

/* L'article dont parle le client : en vente seulement. Sa commande : seulement la sienne (jeton de suivi, compte ou appareil). */
function produitPublic(app, id) {
  try { return R.estEnVente(S.lire(app.findRecordById('products', id))); } catch (e) { return false; }
}
function commandeDuClient(app, id, q, jeton) {
  let o; try { o = app.findRecordById('orders', id); } catch (e) { return false; }
  return (R.valider.jeton(jeton) && o.getString('token') === jeton) || (q.client && o.getString('client') === q.client) || (q.appareil && o.getString('appareil') === q.appareil);
}

/* Le client écrit : { appareil, texte, produit, commande, t (jeton de suivi de la commande), nom }. */
function envoyer(app, q, b) {
  if (!q.client && !q.appareil) throw new BadRequestError('Appareil inconnu : rechargez la page.');
  let m; try { m = R.messageNettoye(b); } catch (err) { throw erreurSaisie(err); }
  if (m.produit && !produitPublic(app, m.produit)) m.produit = '';
  if (m.commande && !commandeDuClient(app, m.commande, q, b.t)) m.commande = '';
  const avant = trouver(app, q);
  let trop = false;
  app.runInTransaction((tx) => {
    const t = Date.now();
    let d = avant ? tx.findRecordById('discussions', avant.id) : null;
    if (d) {
      const n = Number(lignes(tx, "SELECT COUNT(*) AS n FROM sokoyetu_messages WHERE discussion = {:d} AND auteur = 'client' AND cree > {:t}", { d: d.id, t: t - 864e5 }, { n: 0 })[0].n);
      if (n >= R.MESSAGES_PAR_JOUR) { trop = true; return; }
    } else {
      d = new Record(tx.findCollectionByNameOrId('discussions'));
      d.set('id', $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789'));
      d.set('client', q.client); d.set('appareil', q.client ? '' : q.appareil);
    }
    identite(tx, d, q, b.nom);
    tx.db().newQuery("INSERT INTO sokoyetu_messages (discussion, auteur, texte, produit, commande, par, cree) VALUES ({:d}, 'client', {:x}, {:p}, {:c}, '', {:t})")
      .bind({ d: d.id, x: m.texte, p: m.produit, c: m.commande, t }).execute();
    d.set('dernier', R.apercuMessage(m.texte, 160)); d.set('auteur', 'client'); d.set('maj', t);
    d.set('non_lus', d.getInt('non_lus') + 1); d.set('a_repondre', true);
    tx.save(d);
  });
  if (trop) throw new BadRequestError('Beaucoup de messages d’un coup : attendez la réponse de la boutique, elle vous répond ici.');
  return lire(app, q, b);
}

/* ---------- Côté équipe (administration) ---------- */

const resume = (d) => ({
  id: d.id, client: d.getString('client'), nom: d.getString('nom'), telephone: d.getString('telephone'), dernier: d.getString('dernier'), auteur: d.getString('auteur'),
  maj: d.getInt('maj'), non_lus: d.getInt('non_lus'), a_repondre: d.getBool('a_repondre'), lu_client: d.getInt('lu_client'), lu_boutique: d.getInt('lu_boutique')
});

/* Une discussion : son résumé, ses messages (après « apres ») et les commandes de ce client (identifiants). */
function vue(app, id, apres) {
  const d = enregistrement(app, id);
  if (!d) throw new NotFoundError('Discussion introuvable.');
  return { discussion: resume(d), messages: messages(app, d.id, apres, true), commandes: commandesDe(app, d) };
}

/* L'équipe répond : { texte, produit, commande } ; le client est prévenu par une notification gratuite. */
function repondre(app, id, auteur, b) {
  let m; try { m = R.messageNettoye(b); } catch (err) { throw erreurSaisie(err); }
  if (m.produit) { try { app.findRecordById('products', m.produit); } catch (e) { m.produit = ''; } }
  let trouvee = false;
  app.runInTransaction((tx) => {
    let d; try { d = tx.findRecordById('discussions', String(id || '')); } catch (e) { return; }
    trouvee = true;
    if (m.commande && commandesDe(tx, d).indexOf(m.commande) < 0) m.commande = '';
    const t = Date.now();
    tx.db().newQuery("INSERT INTO sokoyetu_messages (discussion, auteur, texte, produit, commande, par, cree) VALUES ({:d}, 'boutique', {:x}, {:p}, {:c}, {:par}, {:t})")
      .bind({ d: d.id, x: m.texte, p: m.produit, c: m.commande, par: String(auteur || '').slice(0, 80), t }).execute();
    const mid = Number(lignes(tx, 'SELECT MAX(id) AS id FROM sokoyetu_messages WHERE discussion = {:d}', { d: d.id }, { id: 0 })[0].id);
    d.set('dernier', R.apercuMessage(m.texte, 160)); d.set('auteur', 'boutique'); d.set('maj', t);
    d.set('non_lus', 0); d.set('a_repondre', false); d.set('lu_boutique', t);
    tx.save(d);
    require(`${__hooks}/lib/notifications.js`).creer(tx, { client: d.getString('client'), appareil: d.getString('appareil'), type: 'message',
      details: { texte: R.apercuMessage(m.texte, 120) }, url: '/discussion', cle: 'message:' + mid });
  });
  if (!trouvee) throw new NotFoundError('Discussion introuvable.');
  return vue(app, id, b.apres);
}

/* « lue » : l'équipe a lu les messages du client ; « traitee » : rien à répondre (un merci, par exemple). */
function marquer(app, id, action) {
  const d = enregistrement(app, id);
  if (!d) throw new NotFoundError('Discussion introuvable.');
  if (action !== 'lue' && action !== 'traitee') throw new BadRequestError('Action inconnue.');
  if (d.getInt('non_lus') > 0 || (action === 'traitee' && d.getBool('a_repondre'))) {
    d.set('non_lus', 0); d.set('lu_boutique', Date.now());
    if (action === 'traitee') d.set('a_repondre', false);
    app.save(d);
  }
  return { discussion: resume(d) };
}

/* Discussion supprimée par l'équipe (message abusif, client qui le demande) : ses messages aussi. */
function supprimer(app, id) {
  const d = enregistrement(app, id);
  if (!d) throw new NotFoundError('Discussion introuvable.');
  app.runInTransaction((tx) => {
    tx.db().newQuery('DELETE FROM sokoyetu_messages WHERE discussion = {:d}').bind({ d: d.id }).execute();
    tx.delete(tx.findRecordById('discussions', d.id));
  });
  return { ok: true };
}

/* Droit à l'effacement et compte supprimé : les discussions de ces comptes, appareils ou téléphone disparaissent. */
function effacer(app, clients, appareils, telephone) {
  const ids = (l) => (l || []).filter(Boolean).map((x) => "'" + String(x).replace(/[^a-z0-9]/gi, '') + "'").join(',');
  const c = ids(clients), a = ids(appareils), tel = R.chiffres(telephone);
  const conditions = [c && `client IN (${c})`, a && `appareil IN (${a})`, tel && '(telephone = {:t} OR telephone = {:plus})'].filter(Boolean);
  if (!conditions.length) return 0;
  const l = lignes(app, `SELECT id FROM discussions WHERE ${conditions.join(' OR ')}`, { t: tel, plus: '+' + tel }, { id: '' });
  l.forEach((x) => { try { supprimer(app, String(x.id)); } catch (e) { } });
  return l.length;
}

/* Chaque nuit : discussions sans message depuis un an oubliées. */
function purger(app) {
  lignes(app, 'SELECT id FROM discussions WHERE maj < {:t} LIMIT 500', { t: Date.now() - GARDE }, { id: '' }).forEach((x) => { try { supprimer(app, String(x.id)); } catch (e) { } });
}

module.exports = { qui, lire, envoyer, vue, repondre, marquer, supprimer, effacer, purger };
