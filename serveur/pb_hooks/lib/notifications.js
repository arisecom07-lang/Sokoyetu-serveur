/*
 * Sokoyetu — notifications du client, gratuites : centre de notifications de la boutique (cloche) et notifications du
 * téléphone (lib/push.js). Ni SMS ni WhatsApp.
 *
 * Destinataire : le compte client (connecté), et/ou l'appareil qui a passé la commande, reconnu par un jeton tiré au
 * sort par la boutique dont le serveur ne garde que l'empreinte : le client sans compte est prévenu lui aussi.
 * Une commande prévient son compte (orders.client, sinon le compte du même téléphone) et son appareil (orders.appareil).
 * Le texte est écrit à la lecture, dans la langue du client (regles.texteNotification).
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;

const GARDE = 90 * 864e5;            // notifications gardées 90 jours
const MONTREES = 50;                 // au plus dans le centre de notifications
const RECENTES = 3 * 864e5;          // un téléphone n'est prévenu que de ce qui date de moins de 3 jours
const ECHECS_MAX = 10;               // abonnement oublié après 10 envois ratés de suite
const DUREE_TOURNEE = 40000;

/* Empreinte du jeton d'appareil envoyé par la boutique ('' si absent ou invalide). */
const empreinte = (jeton) => (R.valider.jeton(jeton) ? $security.sha256('appareil:' + jeton) : '');
const LANGUES = ['fr', 'en', 'sw', 'ln'];
const langue = (l) => (LANGUES.indexOf(String(l || '')) >= 0 ? String(l) : 'fr');

/* Qui demande : compte connecté et/ou appareil (jeton dans le corps de la demande). */
function destinataire(e, b) {
  const C = require(`${__hooks}/lib/comptes.js`);
  const compte = C.compteDe(e);
  return { client: compte ? compte.id : '', appareil: empreinte(b && b.appareil) };
}
const POUR = '((n.client != \'\' AND n.client = {:c}) OR (n.appareil != \'\' AND n.appareil = {:a}))';

/* Nouvelle notification. cle : jamais deux fois la même (ex. « <commande>:livree »). */
function creer(app, n) {
  if (!n.client && !n.appareil) return;
  app.db().newQuery('INSERT OR IGNORE INTO sokoyetu_notifications (client, appareil, type, details, url, cle, cree) VALUES ({:c}, {:a}, {:t}, {:d}, {:u}, {:k}, {:n})')
    .bind({ c: n.client || '', a: n.appareil || '', t: n.type, d: JSON.stringify(n.details || {}), u: n.url || '', k: n.cle || '', n: Date.now() }).execute();
}

/* Compte client d'un téléphone (commande passée sans compte avec le numéro d'un compte), sinon ''. */
function compteDuTelephone(app, tel) {
  if (!tel) return '';
  try { return app.findFirstRecordByData('clients', 'phone', tel).id; } catch (e) { return ''; }
}

/* Commande enregistrée (serveur.enregistrerCommande, même transaction) : ses changements d'étape préviennent le client. */
function apresCommande(app, rec, avant, apres) {
  const l = R.evenementsCommande(avant, apres);
  if (!l.length) return;
  const client = rec.getString('client') || compteDuTelephone(app, rec.getString('phone'));
  const appareil = rec.getString('appareil');
  l.forEach((ev) => creer(app, { client, appareil, type: ev.type, details: ev.details, url: '/suivi/' + rec.id, cle: rec.id + ':' + ev.type }));
}

const vue = (x, lg) => {
  const n = { type: String(x.type), details: JSON.parse(String(x.details || '{}')) };
  const t = R.texteNotification(n, lg);
  return t ? { id: Number(x.id), type: n.type, titre: t.titre, texte: t.texte, url: String(x.url), cree: Number(x.cree), lu: Number(x.lu) > 0 } : null;
};
function lignes(app, sql, params) {
  const l = arrayOf(new DynamicModel({ id: 0, type: '', details: '', url: '', cree: 0, lu: 0 }));
  app.db().newQuery(sql).bind(params).all(l);
  return l;
}

/* Centre de notifications : les plus récentes d'abord, et le nombre de non lues. */
function liste(app, dest, lg) {
  if (!dest.client && !dest.appareil) return { notifications: [], nonLues: 0 };
  const l = lignes(app, `SELECT n.id AS id, n.type AS type, n.details AS details, n.url AS url, n.cree AS cree, n.lu AS lu FROM sokoyetu_notifications n
    WHERE ${POUR} AND n.cree > {:depuis} ORDER BY n.cree DESC, n.id DESC LIMIT ${MONTREES}`, { c: dest.client, a: dest.appareil, depuis: Date.now() - GARDE });
  const notifications = l.map((x) => vue(x, langue(lg))).filter(Boolean);
  return { notifications, nonLues: notifications.filter((n) => !n.lu).length };
}

/* Tout marquer comme lu (ou seulement ids). */
function marquerLues(app, dest, ids) {
  if (!dest.client && !dest.appareil) return { ok: true };
  const choix = Array.isArray(ids) ? ids.map(Number).filter((x) => x > 0).slice(0, 100) : null;
  if (choix && !choix.length) return { ok: true };
  app.db().newQuery(`UPDATE sokoyetu_notifications SET lu = {:t} WHERE lu = 0 AND id IN (SELECT n.id FROM sokoyetu_notifications n WHERE ${POUR}${choix ? ` AND n.id IN (${choix.join(',')})` : ''})`)
    .bind({ t: Date.now(), c: dest.client, a: dest.appareil }).execute();
  return { ok: true };
}

/* ---------- Notifications du téléphone ---------- */

function abonnement(app, endpoint) {
  const l = arrayOf(new DynamicModel({ endpoint: '', auth: '', client: '', appareil: '', langue: '', promos: 0, curseur: 0 }));
  app.db().newQuery('SELECT endpoint, auth, client, appareil, langue, promos, curseur FROM sokoyetu_abonnements WHERE endpoint = {:e}').bind({ e: String(endpoint || '') }).all(l);
  return l.length ? l[0] : null;
}
const cleValide = (k, min, max) => new RegExp(`^[A-Za-z0-9_-]{${min},${max}}={0,2}$`).test(String(k || ''));

/*
 * Abonnement du navigateur (PushSubscription.toJSON()) pour ce compte et/ou cet appareil ; promos : annonces de la boutique
 * acceptées. Un nouvel abonnement n'est prévenu que de ce qui arrive ensuite.
 */
function abonner(app, dest, b) {
  const P = require(`${__hooks}/lib/push.js`);
  const a = R.estObjet(b.abonnement) ? b.abonnement : {}; const k = R.estObjet(a.keys) ? a.keys : {};
  if (!P.adresseValide(a.endpoint)) throw new BadRequestError('Service de notification non reconnu.');
  if (!cleValide(k.auth, 16, 44) || !cleValide(k.p256dh, 80, 100)) throw new BadRequestError('Abonnement invalide.');
  if (!dest.client && !dest.appareil) throw new BadRequestError('Appareil inconnu : rechargez la page.');
  const t = Date.now();
  app.db().newQuery(`INSERT INTO sokoyetu_abonnements (endpoint, auth, p256dh, client, appareil, langue, promos, cree, vu, curseur, pousse, echecs)
    VALUES ({:e}, {:k}, {:p}, {:c}, {:a}, {:l}, {:pr}, {:t}, {:t}, {:t}, 0, 0)
    ON CONFLICT (endpoint) DO UPDATE SET auth = excluded.auth, p256dh = excluded.p256dh, client = excluded.client, appareil = excluded.appareil,
      langue = excluded.langue, promos = excluded.promos, vu = excluded.vu, echecs = 0`)
    .bind({ e: String(a.endpoint), k: String(k.auth), p: String(k.p256dh), c: dest.client, a: dest.appareil, l: langue(b.langue), pr: b.promos ? 1 : 0, t }).execute();
  return { ok: true, promos: !!b.promos };
}

/* Le navigateur renouvelle son abonnement (pushsubscriptionchange) : le nouveau prend la place de l'ancien. */
function renouveler(app, b) {
  const ancien = abonnement(app, b.ancien && b.ancien.endpoint);
  if (!ancien || String(ancien.auth) !== String((b.ancien && b.ancien.auth) || '')) throw new NotFoundError('Abonnement inconnu.');
  const r = abonner(app, { client: String(ancien.client), appareil: String(ancien.appareil) }, { abonnement: b.nouveau, langue: String(ancien.langue), promos: Number(ancien.promos) > 0 });
  if (String(b.nouveau && b.nouveau.endpoint) !== String(ancien.endpoint)) app.db().newQuery('DELETE FROM sokoyetu_abonnements WHERE endpoint = {:e}').bind({ e: String(ancien.endpoint) }).execute();
  return r;
}

function desabonner(app, b) {
  app.db().newQuery('DELETE FROM sokoyetu_abonnements WHERE endpoint = {:e} AND auth = {:k}').bind({ e: String(b.endpoint || ''), k: String(b.auth || '') }).execute();
  return { ok: true };
}

/*
 * Le téléphone a reçu le signal : il vient chercher ce qu'il doit afficher (4 au plus, pas encore lues ni montrées).
 * Une même commande n'occupe qu'une place dans la liste des notifications du téléphone (tag), la dernière étape remplaçant la précédente.
 */
function attente(app, b) {
  const ab = abonnement(app, b.endpoint);
  if (!ab || String(ab.auth) !== String(b.auth || '')) throw new NotFoundError('Abonnement inconnu.');
  const l = lignes(app, `SELECT n.id AS id, n.type AS type, n.details AS details, n.url AS url, n.cree AS cree, n.lu AS lu FROM sokoyetu_notifications n
    WHERE ${POUR} AND n.cree > {:curseur} AND n.cree > {:depuis} AND n.lu = 0 ORDER BY n.cree DESC, n.id DESC LIMIT 4`,
  { c: String(ab.client), a: String(ab.appareil), curseur: Number(ab.curseur), depuis: Date.now() - RECENTES });
  const curseur = l.reduce((m, x) => Math.max(m, Number(x.cree)), Number(ab.curseur));
  app.db().newQuery('UPDATE sokoyetu_abonnements SET curseur = {:c}, vu = {:t} WHERE endpoint = {:e}').bind({ c: curseur, t: Date.now(), e: String(ab.endpoint) }).execute();
  const notifications = l.map((x) => {
    const v = vue(x, String(ab.langue)); if (!v) return null;
    const commande = /^\/suivi\/([a-z0-9]+)$/.exec(v.url);
    return { titre: v.titre, texte: v.texte, url: v.url, tag: commande ? 'commande-' + commande[1] : 'notification-' + v.id };
  }).filter(Boolean);
  return { notifications };
}

/*
 * Chaque minute : chaque téléphone abonné qui a du nouveau (pas encore lu dans la boutique) reçoit un signal.
 * Une seule tournée à la fois, 40 secondes au plus.
 */
function pousser(app) {
  const P = require(`${__hooks}/lib/push.js`);
  const st = app.store(); const moi = $security.randomString(12) + ':' + Date.now();
  if (st.getOrSet('push:tournee', () => moi) !== moi) {
    if (Date.now() - Number(String(st.get('push:tournee')).split(':')[1] || 0) < 300000) return 0;
    st.set('push:tournee', moi);
  }
  let n = 0; const debut = Date.now();
  try {
    const l = arrayOf(new DynamicModel({ endpoint: '', derniere: 0, urgent: 0, echecs: 0 }));
    app.db().newQuery(`SELECT a.endpoint AS endpoint, MAX(n.cree) AS derniere, MAX(n.type != 'promo') AS urgent, a.echecs AS echecs
      FROM sokoyetu_abonnements a JOIN sokoyetu_notifications n
        ON ((n.client != '' AND n.client = a.client) OR (n.appareil != '' AND n.appareil = a.appareil))
      WHERE n.lu = 0 AND n.cree > a.pousse AND n.cree > a.curseur AND n.cree > {:depuis}
      GROUP BY a.endpoint ORDER BY a.echecs, MAX(n.cree) LIMIT 300`).bind({ depuis: Date.now() - RECENTES }).all(l);
    for (const x of l) {
      if (Date.now() - debut > DUREE_TOURNEE) break;
      const endpoint = String(x.endpoint);
      const r = P.envoyer(app, endpoint, Number(x.urgent) > 0);
      n++;
      if (r === 'ok') app.db().newQuery('UPDATE sokoyetu_abonnements SET pousse = {:d}, echecs = 0 WHERE endpoint = {:e}').bind({ d: Number(x.derniere), e: endpoint }).execute();
      else if (r === 'expire' || Number(x.echecs) + 1 >= ECHECS_MAX) app.db().newQuery('DELETE FROM sokoyetu_abonnements WHERE endpoint = {:e}').bind({ e: endpoint }).execute();
      // Échec passager : nouvel essai à la tournée suivante ; au troisième, ce lot est abandonné (le suivant repartira).
      else app.db().newQuery('UPDATE sokoyetu_abonnements SET echecs = echecs + 1, pousse = CASE WHEN echecs >= 2 THEN {:d} ELSE pousse END WHERE endpoint = {:e}').bind({ d: Number(x.derniere), e: endpoint }).execute();
    }
  } finally {
    if (st.get('push:tournee') === moi) st.remove('push:tournee');
  }
  return n;
}

/* Combien de téléphones reçoivent les notifications (administration). */
function abonnes(app) {
  const l = arrayOf(new DynamicModel({ n: 0, promos: 0 }));
  app.db().newQuery('SELECT COUNT(*) AS n, COALESCE(SUM(promos), 0) AS promos FROM sokoyetu_abonnements').all(l);
  return { telephones: Number(l[0].n) || 0, promos: Number(l[0].promos) || 0 };
}

/* Chaque nuit : vieilles notifications et téléphones plus vus depuis 6 mois effacés. */
function purger(app) {
  app.db().newQuery('DELETE FROM sokoyetu_notifications WHERE cree < {:t}').bind({ t: Date.now() - GARDE }).execute();
  app.db().newQuery('DELETE FROM sokoyetu_abonnements WHERE vu < {:t}').bind({ t: Date.now() - 180 * 864e5 }).execute();
}

/* Droit à l'effacement : les notifications et les abonnements de ces comptes et appareils disparaissent. */
function effacer(app, clients, appareils) {
  const ids = (l) => l.filter(Boolean).map((x) => "'" + String(x).replace(/[^a-z0-9]/gi, '') + "'").join(',');
  const c = ids(clients || []), a = ids(appareils || []);
  if (c) { app.db().newQuery(`DELETE FROM sokoyetu_notifications WHERE client IN (${c})`).execute(); app.db().newQuery(`DELETE FROM sokoyetu_abonnements WHERE client IN (${c})`).execute(); }
  if (a) { app.db().newQuery(`DELETE FROM sokoyetu_notifications WHERE appareil IN (${a})`).execute(); app.db().newQuery(`DELETE FROM sokoyetu_abonnements WHERE appareil IN (${a})`).execute(); }
}

module.exports = { empreinte, destinataire, creer, apresCommande, liste, marquerLues, abonner, renouveler, desabonner, attente, pousser, abonnes, purger, effacer };
