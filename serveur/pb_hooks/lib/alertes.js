/*
 * Sokoyetu — « Prévenez-moi » et annonces de la boutique, en notifications gratuites (lib/notifications.js).
 *
 *   - Un client demande à être prévenu du retour d'un article épuisé, ou d'une seule de ses options : dès que le stock
 *     revient (fiche modifiée, commande annulée qui rend son stock), il reçoit une notification, une seule fois.
 *   - Le propriétaire annonce une promotion ou une nouveauté aux téléphones qui ont accepté les annonces
 *     (R.ANNONCES_PAR_JOUR au plus en 24 heures).
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;

const GARDE = 180 * 864e5;           // alerte oubliée après 6 mois sans retour en stock
const POUR = '((client != \'\' AND client = {:c}) OR (appareil != \'\' AND appareil = {:a}))';
/* Un même client n'est prévenu qu'une fois par article : son compte, sinon son appareil. */
const CIBLE = "CASE WHEN client != '' THEN 'c' || client ELSE 'a' || appareil END";

function lignes(app, sql, params, modele) {
  const l = arrayOf(new DynamicModel(modele));
  app.db().newQuery(sql).bind(params || {}).all(l);
  return l;
}

/* Articles que ce client attend : [{ produit, variante }]. */
function liste(app, dest) {
  if (!dest.client && !dest.appareil) return [];
  return lignes(app, `SELECT produit, variante, MAX(cree) AS cree FROM sokoyetu_alertes WHERE ${POUR} GROUP BY produit, variante ORDER BY cree DESC LIMIT ${R.MAX_ALERTES}`,
    { c: dest.client, a: dest.appareil }, { produit: '', variante: '', cree: 0 }).map((x) => ({ produit: String(x.produit), variante: String(x.variante) }));
}

/* « Prévenez-moi » : { produit, variante } (variante '' : l'article entier). */
function ajouter(app, dest, b) {
  if (!dest.client && !dest.appareil) throw new BadRequestError('Appareil inconnu : rechargez la page.');
  let rec; try { rec = app.findRecordById('products', String(b.produit || '')); } catch (e) { throw new NotFoundError('Article introuvable.'); }
  const p = S.lire(rec);
  if (!R.estEnVente(p)) throw new NotFoundError('Article introuvable.');
  const variante = R.varianteAlerte(p, b.variante);
  if (variante === null) throw new BadRequestError('Cette option n’existe plus : rechargez la page.');
  if (R.alerteDisponible(p, variante)) throw new BadRequestError('Bonne nouvelle : il est de nouveau disponible. Ajoutez-le au panier.');
  const deja = lignes(app, `SELECT COUNT(DISTINCT produit || '#' || variante) AS n FROM sokoyetu_alertes WHERE ${POUR}`, { c: dest.client, a: dest.appareil }, { n: 0 });
  if (Number(deja[0].n) >= R.MAX_ALERTES) throw new BadRequestError(`Vous attendez déjà ${R.MAX_ALERTES} articles : retirez-en quelques-uns (Compte → Notifications).`);
  app.db().newQuery('INSERT OR IGNORE INTO sokoyetu_alertes (produit, variante, client, appareil, cree) VALUES ({:p}, {:v}, {:c}, {:a}, {:t})')
    .bind({ p: rec.id, v: variante, c: dest.client, a: dest.appareil, t: Date.now() }).execute();
  return { ok: true, alertes: liste(app, dest) };
}

function retirer(app, dest, b) {
  if (dest.client || dest.appareil) {
    app.db().newQuery(`DELETE FROM sokoyetu_alertes WHERE produit = {:p} AND variante = {:v} AND ${POUR}`)
      .bind({ p: String(b.produit || ''), v: String(b.variante || ''), c: dest.client, a: dest.appareil }).execute();
  }
  return { ok: true, alertes: liste(app, dest) };
}

/*
 * Fiche d'un article enregistrée (après la transaction) : les clients qui attendaient une option revenue en stock sont
 * prévenus, une seule fois chacun, et leur alerte disparaît. Renvoie le nombre d'alertes servies.
 */
function apresProduit(app, rec) {
  const l = lignes(app, `SELECT id, variante, client, appareil, ${CIBLE} AS cible FROM sokoyetu_alertes WHERE produit = {:p} ORDER BY id`,
    { p: rec.id }, { id: 0, variante: '', client: '', appareil: '', cible: '' });
  if (!l.length) return 0;
  const p = S.lire(rec);
  const N = require(`${__hooks}/lib/notifications.js`);
  const servies = []; const prevenus = {};
  l.forEach((x) => {
    const v = String(x.variante);
    if (!R.alerteDisponible(p, v)) return;
    servies.push(Number(x.id));
    if (prevenus[String(x.cible)]) return;
    prevenus[String(x.cible)] = true;
    N.creer(app, { client: String(x.client), appareil: String(x.appareil), type: 'stock', details: { titre: p.title || 'Article', option: R.libelleVariante(v) },
      url: '/p/' + rec.id + '/' + R.slug(p.title), cle: 'stock:' + x.id });
  });
  if (servies.length) app.db().newQuery(`DELETE FROM sokoyetu_alertes WHERE id IN (${servies.join(',')})`).execute();
  return servies.length;
}

/* Article supprimé : plus rien à attendre. */
function retirerProduit(app, id) {
  app.db().newQuery('DELETE FROM sokoyetu_alertes WHERE produit = {:p}').bind({ p: String(id) }).execute();
}

/* Administration : combien de clients attendent chaque article, et chaque option ({ produit: { total, variantes } }). */
function attente(app) {
  const out = {};
  lignes(app, `SELECT produit, variante, COUNT(DISTINCT ${CIBLE}) AS n FROM sokoyetu_alertes GROUP BY produit, variante`, {}, { produit: '', variante: '', n: 0 })
    .forEach((x) => {
      const o = out[String(x.produit)] = out[String(x.produit)] || { total: 0, variantes: {} };
      o.variantes[String(x.variante)] = Number(x.n);
    });
  lignes(app, `SELECT produit, COUNT(DISTINCT ${CIBLE}) AS n FROM sokoyetu_alertes GROUP BY produit`, {}, { produit: '', n: 0 })
    .forEach((x) => { out[String(x.produit)].total = Number(x.n); });
  return out;
}

/* ---------- Annonces de la boutique ---------- */

const depuis24h = (app) => Number(lignes(app, 'SELECT COUNT(*) AS n FROM sokoyetu_annonces WHERE cree > {:t}', { t: Date.now() - 864e5 }, { n: 0 })[0].n);

/* Page « Annonces » : téléphones abonnés, annonces encore possibles aujourd'hui, dernières annonces. */
function annonces(app) {
  const N = require(`${__hooks}/lib/notifications.js`);
  const l = lignes(app, 'SELECT id, titre, texte, url, auteur, cree, destinataires FROM sokoyetu_annonces ORDER BY cree DESC, id DESC LIMIT 30', {},
    { id: 0, titre: '', texte: '', url: '', auteur: '', cree: 0, destinataires: 0 });
  return {
    abonnes: N.abonnes(app), restantes: Math.max(0, R.ANNONCES_PAR_JOUR - depuis24h(app)), parJour: R.ANNONCES_PAR_JOUR,
    annonces: l.map((x) => ({ id: Number(x.id), titre: String(x.titre), texte: String(x.texte), url: String(x.url), auteur: String(x.auteur), cree: Number(x.cree), destinataires: Number(x.destinataires) }))
  };
}

/*
 * Nouvelle annonce : une notification pour chaque téléphone qui accepte les annonces (son appareil ; un même appareil
 * abonné deux fois n'en reçoit qu'une). La tournée des notifications les envoie dans la minute.
 */
function annoncer(app, auteur, b) {
  let a;
  try { a = R.annonceNettoyee(b); } catch (err) { if (err instanceof R.ErreurCommande) throw new BadRequestError(err.message); throw err; }
  let id = 0, trop = false;
  app.runInTransaction((tx) => {
    if (depuis24h(tx) >= R.ANNONCES_PAR_JOUR) { trop = true; return; }
    const t = Date.now();
    tx.db().newQuery('INSERT INTO sokoyetu_annonces (titre, texte, url, auteur, cree) VALUES ({:ti}, {:te}, {:u}, {:au}, {:t})')
      .bind({ ti: a.titre, te: a.texte, u: a.url, au: String(auteur || '').slice(0, 80), t }).execute();
    id = Number(lignes(tx, 'SELECT MAX(id) AS id FROM sokoyetu_annonces', {}, { id: 0 })[0].id);
    tx.db().newQuery(`INSERT OR IGNORE INTO sokoyetu_notifications (client, appareil, type, details, url, cle, cree)
      SELECT CASE WHEN appareil = '' THEN client ELSE '' END, appareil, 'promo', {:d}, {:u},
        'annonce:' || {:id} || ':' || CASE WHEN appareil = '' THEN 'c' || client ELSE 'a' || appareil END, {:t}
      FROM sokoyetu_abonnements WHERE promos = 1 AND (appareil != '' OR client != '')`)
      .bind({ d: JSON.stringify({ titre: a.titre, texte: a.texte }), u: a.url, id: String(id), t }).execute();
    const n = Number(lignes(tx, 'SELECT COUNT(*) AS n FROM sokoyetu_notifications WHERE cle LIKE {:k}', { k: 'annonce:' + id + ':%' }, { n: 0 })[0].n);
    tx.db().newQuery('UPDATE sokoyetu_annonces SET destinataires = {:n} WHERE id = {:id}').bind({ n, id }).execute();
  });
  if (trop) throw new BadRequestError(`${R.ANNONCES_PAR_JOUR} annonces par 24 heures au plus : au-delà, vos clients risquent de couper les notifications.`);
  return annonces(app);
}

/* Chaque nuit : alertes de plus de 6 mois (l'article n'est jamais revenu) oubliées. */
function purger(app) {
  app.db().newQuery('DELETE FROM sokoyetu_alertes WHERE cree < {:t}').bind({ t: Date.now() - GARDE }).execute();
}

/* Droit à l'effacement et compte supprimé : les alertes de ces comptes et appareils disparaissent. */
function effacer(app, clients, appareils) {
  const ids = (l) => (l || []).filter(Boolean).map((x) => "'" + String(x).replace(/[^a-z0-9]/gi, '') + "'").join(',');
  const c = ids(clients), a = ids(appareils);
  if (c) app.db().newQuery(`DELETE FROM sokoyetu_alertes WHERE client IN (${c})`).execute();
  if (a) app.db().newQuery(`DELETE FROM sokoyetu_alertes WHERE appareil IN (${a})`).execute();
}

module.exports = { liste, ajouter, retirer, apresProduit, retirerProduit, attente, annonces, annoncer, purger, effacer };
