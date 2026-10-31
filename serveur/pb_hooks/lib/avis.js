/*
 * Sokoyetu — avis et notes des clients sur les articles.
 *
 *   - Seul un client qui a reçu l'article donne son avis : commande livrée, prouvée par son compte, son appareil ou le
 *     lien de suivi gardé sur son téléphone. Un avis par article et par téléphone ; le client peut le modifier.
 *   - L'avis est publié tout de suite, ou après vérification quand la boutique l'a choisi (réglages, « Avis des clients »).
 *   - L'équipe (propriétaire et vendeurs : droit « avis ») répond publiquement, et masque un avis abusif avec un motif
 *     (montré au client qui l'a écrit) ; jamais parce qu'il est négatif.
 *   - La note moyenne de chaque article part avec le catalogue public ; les avis publiés se lisent page par page.
 *   - Quelques jours après la livraison, le client reçoit une notification gratuite pour donner son avis.
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;

const erreurSaisie = (err) => (err instanceof R.ErreurCommande ? new BadRequestError(err.message) : err);
function lignes(app, sql, params, modele) {
  const l = arrayOf(new DynamicModel(modele));
  app.db().newQuery(sql).bind(params || {}).all(l);
  return l;
}
const catalogueChange = () => require(`${__hooks}/lib/pages.js`).catalogueChange();

/* Qui demande : le compte connecté et/ou cet appareil (empreinte du jeton envoyé par la boutique). */
function qui(e, b) {
  const compte = require(`${__hooks}/lib/comptes.js`).compteDe(e);
  return { client: compte ? compte.id : '', appareil: require(`${__hooks}/lib/notifications.js`).empreinte(b && b.appareil) };
}

/* Un avis tel que le montre la boutique (jamais le téléphone ni la commande), tel que le voit son auteur, tel que le voit l'équipe. */
const avisPublic = (rec) => ({
  id: rec.id, nom: rec.getString('nom'), note: rec.getInt('note'), texte: rec.getString('texte'), variante: rec.getString('variante'),
  cree: rec.getInt('cree'), reponse: rec.getString('reponse'), reponseLe: rec.getInt('reponse_le')
});
const avisAuteur = (rec) => Object.assign(avisPublic(rec), { etat: rec.getString('etat'), motif: R.MOTIFS_AVIS[rec.getString('motif')] || '', maj: rec.getInt('maj') });
const avisEquipe = (rec) => Object.assign(avisPublic(rec), {
  produit: rec.getString('produit'), commande: rec.getString('commande'), numero: rec.getString('numero'), telephone: rec.getString('telephone'), client: rec.getString('client'),
  etat: rec.getString('etat'), motif: rec.getString('motif'), reponse_par: rec.getString('reponse_par'), reponse_le: rec.getInt('reponse_le'), maj: rec.getInt('maj')
});

/* Avis déjà donnés depuis ce téléphone : { produit: enregistrement }. */
function avisDuTelephone(app, tel) {
  const r = {};
  if (tel) app.findRecordsByFilter('avis', 'telephone = {:t}', '', 500, 0, { t: tel }).forEach((rec) => { r[rec.getString('produit')] = rec; });
  return r;
}
const enVente = (P, id) => { const rec = P.rec(id); return !!rec && rec.getBool('active') && R.estEnVente(P.doc(id)); };

/* Commandes livrées de ce client : son compte, son appareil, ou les commandes suivies sur son téléphone ({ id, t }). */
function commandesLivrees(app, q, suivis) {
  const conditions = []; const params = {};
  if (q.client) { conditions.push("(client != '' AND client = {:c})"); params.c = q.client; }
  if (q.appareil) { conditions.push("(appareil != '' AND appareil = {:a})"); params.a = q.appareil; }
  (Array.isArray(suivis) ? suivis : []).slice(0, 30).forEach((x, i) => {
    const id = R.valider.identifiant(x && x.id); const t = R.valider.jeton(x && x.t);
    if (id && t) { conditions.push(`(id = {:i${i}} AND token = {:t${i}})`); params['i' + i] = id; params['t' + i] = t; }
  });
  if (!conditions.length) return [];
  return lignes(app, `SELECT id, number, phone, doc FROM orders WHERE etape = 'delivered' AND (${conditions.join(' OR ')}) ORDER BY created DESC LIMIT 30`,
    params, { id: '', number: '', phone: '', doc: '' })
    .map((x) => { let doc = {}; try { doc = JSON.parse(String(x.doc || '{}')); } catch (e) { } return { id: String(x.id), numero: String(x.number), telephone: String(x.phone), doc }; });
}

/* ---------- Côté client ---------- */

/*
 * Articles reçus que ce client peut noter (les plus récents d'abord), avec l'avis qu'il en a déjà donné :
 * { articles: [{ produit, titre, variante, commande, numero, livree, avis }] }.
 */
function aDonner(app, q, b) {
  if (!S.configuration(app).reviews.enabled) return { articles: [] };
  const P = S.lecteurProduits(app);
  const vus = {}; const parTelephone = {}; const articles = [];
  commandesLivrees(app, q, b && b.suivis).forEach((o) => {
    R.articlesANoter(o.doc).forEach((a) => {
      if (vus[a.produit] || !enVente(P, a.produit)) return;
      vus[a.produit] = true;
      if (!parTelephone[o.telephone]) parTelephone[o.telephone] = avisDuTelephone(app, o.telephone);
      const deja = parTelephone[o.telephone][a.produit];
      articles.push({ produit: a.produit, titre: a.titre, variante: a.variante, commande: o.id, numero: o.numero, livree: R.int(o.doc.deliveredAt), avis: deja ? avisAuteur(deja) : null });
    });
  });
  return { articles };
}

/* Le client donne (ou modifie) son avis : { appareil, commande, t (jeton de suivi), produit, note, texte }. */
function donner(app, q, b) {
  const cfg = S.configuration(app);
  if (!cfg.reviews.enabled) throw new BadRequestError('Les avis sont fermés pour le moment.');
  let saisie; try { saisie = R.avisNettoye(b); } catch (err) { throw erreurSaisie(err); }
  const produit = R.valider.identifiant(b.produit);
  let o = null; try { o = app.findRecordById('orders', R.valider.identifiant(b.commande)); } catch (e) { }
  const t = R.valider.jeton(b.t);
  if (!o || !((t && o.getString('token') === t) || (q.client && o.getString('client') === q.client) || (q.appareil && o.getString('appareil') === q.appareil))) throw new NotFoundError('Commande introuvable.');
  const doc = S.lire(o);
  if (doc.fulfillment !== 'delivered') throw new BadRequestError('Vous pourrez donner votre avis une fois la commande reçue.');
  const ligne = R.articlesANoter(doc).find((a) => a.produit === produit);
  if (!ligne) throw new BadRequestError('Cet article ne fait pas partie de cette commande.');
  if (!enVente(S.lecteurProduits(app), produit)) throw new BadRequestError('Cet article n’est plus en vente : impossible de le noter.');
  const tel = o.getString('phone'); const now = Date.now();
  let rec = null; try { rec = app.findFirstRecordByFilter('avis', 'produit = {:p} && telephone = {:t}', { p: produit, t: tel }); } catch (e) { }
  const avant = rec ? { etat: rec.getString('etat') } : null;
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId('avis'));
    rec.set('produit', produit); rec.set('telephone', tel); rec.set('cree', now);
  }
  rec.set('commande', o.id); rec.set('numero', o.getString('number'));
  rec.set('client', o.getString('client') || q.client || rec.getString('client'));
  if (q.appareil) rec.set('appareil', q.appareil);
  rec.set('nom', R.nomPublic(doc.customer && doc.customer.name));
  rec.set('note', saisie.note); rec.set('texte', saisie.texte); rec.set('variante', ligne.variante);
  rec.set('etat', R.etatAvis(cfg, avant));
  rec.set('motif', ''); rec.set('maj', now);
  try { app.save(rec); } catch (err) {
    // Deux envois en même temps (double appui, deux écrans) : le premier a créé l'avis.
    let double = false; try { double = !avant && !!app.findFirstRecordByFilter('avis', 'produit = {:p} && telephone = {:t}', { p: produit, t: tel }); } catch (e) { }
    if (double) throw new BadRequestError('Avis déjà enregistré depuis un autre écran : rechargez la page.');
    throw err;
  }
  catalogueChange();
  return { avis: avisAuteur(rec) };
}

/* Avis publiés d'un article, les plus récents d'abord (?page=0, ?note=5 pour une seule note), et leur résumé. */
function publics(app, produit, page, note) {
  const p = R.valider.identifiant(produit);
  if (!p || !S.configuration(app).reviews.enabled) return { resume: R.resumeAvis({}), avis: [], suite: false };
  const rep = {};
  lignes(app, "SELECT note, COUNT(*) AS n FROM avis WHERE produit = {:p} AND etat = 'publie' GROUP BY note", { p }, { note: 0, n: 0 }).forEach((x) => { rep[Number(x.note)] = Number(x.n); });
  const n = Math.min(500, Math.max(0, R.int(page))); const seule = R.int(note) >= 1 && R.int(note) <= 5 ? R.int(note) : 0;
  const l = app.findRecordsByFilter('avis', "produit = {:p} && etat = 'publie'" + (seule ? ' && note = {:note}' : ''), '-cree', R.AVIS_PAR_PAGE + 1, n * R.AVIS_PAR_PAGE, { p, note: seule });
  return { resume: R.resumeAvis(rep), avis: l.slice(0, R.AVIS_PAR_PAGE).map(avisPublic), suite: l.length > R.AVIS_PAR_PAGE };
}

/* Note moyenne et nombre d'avis publiés de chaque article : { produit: { note, nombre } } (catalogue public). */
function resumes(app) {
  const r = {};
  lignes(app, "SELECT produit, note, COUNT(*) AS n FROM avis WHERE etat = 'publie' GROUP BY produit, note", {}, { produit: '', note: 0, n: 0 })
    .forEach((x) => { const k = String(x.produit); (r[k] = r[k] || {})[Number(x.note)] = Number(x.n); });
  const out = {};
  Object.keys(r).forEach((k) => { const s = R.resumeAvis(r[k]); out[k] = { note: s.note, nombre: s.nombre }; });
  return out;
}

/* ---------- Côté équipe (administration) ---------- */

/*
 * { action: 'publier' } ; { action: 'masquer', motif } (voir R.MOTIFS_AVIS) ; { reponse } : réponse publique de la boutique
 * ('' la retire). La première réponse prévient le client par une notification gratuite.
 */
function moderer(app, id, b, auteur) {
  let rec; try { rec = app.findRecordById('avis', String(id || '')); } catch (e) { throw new NotFoundError('Avis introuvable.'); }
  const x = b || {};
  if (x.action === 'publier') { rec.set('etat', 'publie'); rec.set('motif', ''); }
  else if (x.action === 'masquer') { rec.set('etat', 'masque'); rec.set('motif', R.MOTIFS_AVIS[x.motif] ? x.motif : 'autre'); }
  else if (typeof x.reponse === 'string') {
    const texte = R.reponseAvisNettoyee(x.reponse);
    rec.set('reponse', texte); rec.set('reponse_par', texte ? String(auteur || '').slice(0, 80) : ''); rec.set('reponse_le', texte ? Date.now() : 0);
  } else throw new BadRequestError('Action inconnue.');
  rec.set('maj', Date.now());
  app.runInTransaction((tx) => {
    tx.save(rec);
    if (!rec.getString('reponse') || rec.getString('etat') === 'masque') return;
    const P = S.lecteurProduits(tx); const p = P.doc(rec.getString('produit'));
    const titre = (p && p.title) || 'votre article';
    require(`${__hooks}/lib/notifications.js`).creer(tx, { client: rec.getString('client'), appareil: rec.getString('appareil'), type: 'avis_reponse',
      details: { titre, texte: R.apercuMessage(rec.getString('reponse'), 110) }, url: `/p/${rec.getString('produit')}/${R.slug(titre)}`, cle: 'avis_reponse:' + rec.id });
  });
  catalogueChange();
  return { avis: avisEquipe(rec) };
}

/*
 * Toutes les heures : « Votre avis compte », une fois par commande, de 2 à 14 jours après la livraison, quand il reste
 * des articles à noter. Renvoie le nombre de clients prévenus.
 */
function rappeler(app) {
  const cfg = S.configuration(app);
  if (!cfg.reviews.enabled || !cfg.reviews.reminder) return 0;
  const now = Date.now(); const N = require(`${__hooks}/lib/notifications.js`); const P = S.lecteurProduits(app);
  const l = lignes(app, `SELECT o.id AS id, o.client AS client, o.appareil AS appareil, o.phone AS phone, o.doc AS doc FROM orders o
    WHERE o.etape = 'delivered' AND CAST(json_extract(o.doc, '$.deliveredAt') AS INTEGER) BETWEEN {:de} AND {:a}
      AND NOT EXISTS (SELECT 1 FROM sokoyetu_notifications n WHERE n.cle = 'avis:' || o.id) LIMIT 300`,
  { de: now - R.RAPPEL_AVIS_JOURS[1] * R.JOUR, a: now - R.RAPPEL_AVIS_JOURS[0] * R.JOUR }, { id: '', client: '', appareil: '', phone: '', doc: '' });
  let n = 0;
  l.forEach((x) => {
    let doc = {}; try { doc = JSON.parse(String(x.doc || '{}')); } catch (e) { return; }
    const deja = avisDuTelephone(app, String(x.phone));
    const r = R.rappelAvis({ cfg, o: doc, notes: (id) => !!deja[id] || !enVente(P, id), maintenant: now });
    if (!r) return;
    let client = String(x.client);
    if (!client && x.phone) { try { client = app.findFirstRecordByData('clients', 'phone', String(x.phone)).id; } catch (e) { } }
    if (!client && !String(x.appareil)) return;
    N.creer(app, { client, appareil: String(x.appareil), type: 'avis', details: r, url: '/avis', cle: 'avis:' + x.id });
    n++;
  });
  return n;
}

/* Droit à l'effacement et compte supprimé : les avis de ces comptes ou de ce téléphone disparaissent. */
function effacer(app, clients, telephone) {
  const ids = (clients || []).filter(Boolean).map((c) => String(c).replace(/[^a-z0-9]/gi, ''));
  const tel = R.chiffres(telephone);
  const conditions = ids.map((_, i) => `client = {:c${i}}`); const params = {};
  ids.forEach((c, i) => { params['c' + i] = c; });
  if (tel) { conditions.push('telephone = {:t}', 'telephone = {:plus}'); params.t = tel; params.plus = '+' + tel; }
  if (!conditions.length) return 0;
  const l = app.findRecordsByFilter('avis', conditions.join(' || '), '', 1000, 0, params);
  l.forEach((rec) => { try { app.delete(rec); } catch (e) { } });
  if (l.length) catalogueChange();
  return l.length;
}

module.exports = { qui, aDonner, donner, publics, resumes, moderer, rappeler, effacer };
