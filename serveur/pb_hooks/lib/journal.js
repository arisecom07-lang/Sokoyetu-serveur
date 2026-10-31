/*
 * Sokoyetu — surveillance du serveur : journal des erreurs, état de santé, alerte si le site tombe.
 *
 *   signaler()  une erreur survenue dans le navigateur d'un client ou de la gérante est gardée dans le journal du serveur ;
 *   lire()      les erreurs des derniers jours, pour la page « Journal » de l'administration ;
 *   sante()     GET /api/sokoyetu/sante : 200 { ok: true } si la base répond (pour un service de surveillance extérieur),
 *               avec, pour l'administration, sauvegardes, paiement et erreurs récentes ;
 *   veille()    toutes les 5 minutes, signal envoyé à un service d'alerte (SOKOYETU_ALERTE_URL, par exemple Healthchecks.io) :
 *               s'il n'arrive plus (serveur arrêté, panne), ce service vous prévient par e-mail ou Telegram.
 * Le journal lui-même est celui de PocketBase (tableau technique /_/ → Logs), gardé 30 jours.
 */
const S = require(`${__hooks}/lib/serveur.js`);

const env = (k) => String($os.getenv(k) || '').trim();
const texte = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').trim().slice(0, n);
// Bruit sans conséquence (extensions du navigateur, mesure de mise en page, scripts tiers masqués).
const BRUIT = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-(web-)?extension:|webkit-masked-url:|__gCrWeb|instantSearchSDKJSBridge/i;

/* Erreur envoyée par la boutique ou l'administration : { app, genre, message, source, ligne, colonne, pile, page, version }. */
function signaler(e, b) {
  const message = texte(b.message, 300) || 'Erreur inconnue';
  const source = texte(b.source, 300);
  if (BRUIT.test(message) || BRUIT.test(source) || BRUIT.test(texte(b.pile, 300))) return false;
  const app = b.app === 'admin' ? 'admin' : 'boutique';
  // La page sans ses paramètres : l'adresse de suivi d'une commande contient son jeton.
  const page = texte(b.page, 300).replace(/[?#].*$/, '');
  $app.logger().warn('Erreur dans le navigateur (' + app + ') : ' + message,
    'type', 'navigateur', 'app', app, 'genre', texte(b.genre, 20), 'page', page, 'source', source.replace(/[?#].*$/, ''),
    'ligne', Number(b.ligne) || 0, 'colonne', Number(b.colonne) || 0, 'pile', texte(b.pile, 1500).replace(/\?t=[A-Za-z0-9]+/g, '?t=…'),
    'version', texte(b.version, 40), 'agent', texte(e.request.header.get('User-Agent'), 200));
  return true;
}

/* Les erreurs à connaître : du serveur, des navigateurs, et les requêtes en erreur 5xx. Pas les refus ordinaires (400, 404, 429). */
const FILTRE = "created >= {:depuis} AND ((json_extract(data, '$.type') = 'request' AND CAST(json_extract(data, '$.status') AS INTEGER) >= 500)"
  + " OR (IFNULL(json_extract(data, '$.type'), '') != 'request' AND level >= 4))";
const depuis = (ms) => new Date(Date.now() - ms).toISOString().replace('T', ' ');

function lire(app, jours, limite) {
  const j = Math.min(30, Math.max(1, parseInt(jours, 10) || 7)); const n = Math.min(300, Math.max(1, parseInt(limite, 10) || 100));
  // data : texte JSON de l'entrée du journal (lu comme texte, puis décodé).
  const l = arrayOf(new DynamicModel({ id: '', level: 0, message: '', data: '', created: '' }));
  app.logQuery().andWhere($dbx.exp(FILTRE, { depuis: depuis(j * 864e5) })).orderBy('created DESC').limit(n).all(l);
  return l.map((x) => {
    let d = {}; try { d = JSON.parse(String(x.data || '{}')) || {}; } catch (e) { d = {}; }
    const garde = {};
    ['type', 'module', 'app', 'genre', 'page', 'source', 'ligne', 'pile', 'version', 'agent', 'commande', 'compte', 'ip', 'erreur', 'detail', 'method', 'url', 'status', 'error', 'details'].forEach((k) => {
      if (d[k] !== undefined && d[k] !== null && d[k] !== '') garde[k] = typeof d[k] === 'object' ? JSON.stringify(d[k]).slice(0, 1000) : d[k];
    });
    return { id: x.id, niveau: Number(x.level) >= 8 ? 'erreur' : 'alerte', message: String(x.message), quand: Date.parse(String(x.created).replace(' ', 'T')) || 0, details: garde };
  });
}
function compterErreurs(app, ms) {
  const l = arrayOf(new DynamicModel({ n: 0 }));
  try { app.logQuery().select('COUNT(*) AS n').andWhere($dbx.exp(FILTRE, { depuis: depuis(ms) })).all(l); } catch (e) { return 0; }
  return l.length ? Number(l[0].n) || 0 : 0;
}

/* Sauvegardes automatiques (pb_data/backups) : nombre, date de la plus récente ; dernière vérification de restauration. */
function sauvegardes(app) {
  const out = { nombre: 0, derniere: 0, verification: null };
  try {
    $os.readDir(app.dataDir() + '/backups').forEach((f) => {
      if (f.isDir() || !/\.zip$/i.test(f.name())) return;
      out.nombre++;
      out.derniere = Math.max(out.derniere, f.info().modTime().unixMilli());
    });
  } catch (e) { /* aucune sauvegarde encore */ }
  try {
    const v = JSON.parse(toString($os.readFile(app.dataDir() + '/../sauvegardes/verification.json')));
    if (v && typeof v === 'object') out.verification = { quand: Number(v.quand) || 0, ok: !!v.ok, fichier: texte(v.fichier, 120), message: texte(v.message, 300) };
  } catch (e) { /* jamais vérifiée */ }
  return out;
}

/* Ce qui ne va pas : { texte, grave }. Les points graves déclenchent l'alerte. */
function problemes(app, d) {
  const l = [];
  const heures = (t) => (Date.now() - t) / 3600e3;
  if (!d.sauvegardes.derniere) l.push({ grave: false, texte: 'Aucune sauvegarde automatique pour l’instant (la première a lieu chaque nuit à 5 h).' });
  else if (heures(d.sauvegardes.derniere) > 36) l.push({ grave: true, texte: `Dernière sauvegarde il y a ${Math.round(heures(d.sauvegardes.derniere))} heures : la sauvegarde de la nuit n’a pas eu lieu.` });
  const v = d.sauvegardes.verification;
  if (v && !v.ok) l.push({ grave: true, texte: 'La dernière sauvegarde vérifiée ne se restaure pas : ' + (v.message || 'voir sauvegarde.sh verifier') });
  else if (d.sauvegardes.nombre && (!v || heures(v.quand) > 9 * 24)) l.push({ grave: false, texte: 'Restauration des sauvegardes non vérifiée depuis plus d’une semaine (sudo /opt/sokoyetu/sauvegarde.sh verifier).' });
  if (d.paiement.panne && Date.now() - d.paiement.panne > 15 * 60000) l.push({ grave: true, texte: `Le service de paiement ne répond pas depuis ${Math.round((Date.now() - d.paiement.panne) / 60000)} minutes.` });
  if (d.erreurs.heure >= 20) l.push({ grave: true, texte: `${d.erreurs.heure} erreurs dans la dernière heure : voir le journal.` });
  if (!d.alerte.configuree) l.push({ grave: false, texte: 'Alerte en cas de panne non branchée (sudo /opt/sokoyetu/alerte.sh).' });
  return l;
}

function details(app) {
  const P = require(`${__hooks}/lib/paiement.js`);
  const d = {
    sauvegardes: sauvegardes(app),
    paiement: P.etat(),
    erreurs: { heure: compterErreurs(app, 3600e3), jour: compterErreurs(app, 864e5) },
    alerte: { configuree: /^https:\/\//.test(env('SOKOYETU_ALERTE_URL')), dernier: Number(app.store().get('veille:dernier')) || 0 }
  };
  d.problemes = problemes(app, d);
  return d;
}

/* État du serveur : 200 si la base répond, 503 sinon. L'administration reçoit le détail. */
function sante(e) {
  let base = false;
  try { const l = arrayOf(new DynamicModel({ n: 0 })); e.app.db().newQuery('SELECT 1 AS n').all(l); base = l.length === 1; } catch (err) { base = false; }
  const sortie = { ok: base, version: require(`${__hooks}/lib/version.js`).version, heure: Date.now() };
  if (S.estGerant(e.requestInfo())) { try { sortie.details = details(e.app); } catch (err) { sortie.details = null; } }
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(base ? 200 : 503, sortie);
}

/* Toutes les 5 minutes : signal au service d'alerte (« /fail » et la raison s'il y a un problème grave). */
function veille(app) {
  const url = env('SOKOYETU_ALERTE_URL');
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return false;
  let graves = [];
  try { graves = details(app).problemes.filter((p) => p.grave).map((p) => p.texte); } catch (err) { graves = ['Contrôle du serveur impossible : ' + String(err).slice(0, 200)]; }
  try {
    const res = $http.send({ url: graves.length ? url.replace(/\/+$/, '') + '/fail' : url, method: 'POST', timeout: 10, body: graves.join('\n') || 'Sokoyetu : tout va bien', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (res.statusCode >= 400) S.trace('warn', 'Le service d’alerte refuse le signal', { module: 'veille', statut: res.statusCode });
    else app.store().set('veille:dernier', Date.now());
  } catch (err) { S.trace('warn', 'Service d’alerte injoignable', { module: 'veille', erreur: String(err) }); }
  return true;
}

module.exports = { signaler, lire, sante, veille, details, sauvegardes, compterErreurs };
