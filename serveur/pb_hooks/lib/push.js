/*
 * Sokoyetu — notifications du téléphone (Web Push), gratuites. Le navigateur du client s'abonne auprès de son service de
 * notification (Google pour Chrome et Android, Mozilla, Apple, Microsoft) avec la clé publique VAPID du serveur. Pour
 * prévenir le téléphone, le serveur envoie à ce service un signal SANS contenu, signé par sa clé (ES256, lib/p256.js) ;
 * le téléphone vient alors chercher le texte chez nous (route /api/sokoyetu/push/attente). Aucun contenu à chiffrer,
 * et rien de lisible ne passe par ces services.
 */
const P256 = require(`${__hooks}/lib/p256.js`);
const S = require(`${__hooks}/lib/serveur.js`);

const hasard = () => $security.randomStringWithAlphabet(64, '0123456789abcdef');

/* Clé VAPID du serveur : créée une fois pour toutes (en changer désabonnerait tous les téléphones). */
function cle(app) {
  const st = app.store();
  const memo = st.get('push:cle');
  if (memo) return memo;
  const lire = () => {
    const l = arrayOf(new DynamicModel({ valeur: '' }));
    app.db().newQuery("SELECT valeur FROM sokoyetu_cles WHERE nom = 'vapid'").all(l);
    return l.length ? JSON.parse(String(l[0].valeur)) : null;
  };
  let c = lire();
  if (!c) {
    app.db().newQuery("INSERT OR IGNORE INTO sokoyetu_cles (nom, valeur) VALUES ('vapid', {:v})").bind({ v: JSON.stringify(P256.cles(hasard())) }).execute();
    c = lire(); // deux créations simultanées : la première gagne
  }
  st.set('push:cle', c);
  return c;
}
const clePublique = (app) => cle(app).public;

/* Services de notification acceptés : le serveur n'envoie rien ailleurs. */
const SERVICES = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)\/\S+$/i;
function adresseValide(url) {
  const u = String(url || '');
  if (!u || u.length > 1000) return false;
  // Tests : faux service local (SOKOYETU_PUSH_ESSAI=http://127.0.0.1:8099).
  const essai = String($os.getenv('SOKOYETU_PUSH_ESSAI') || '');
  if (essai && u.indexOf(essai + '/') === 0) return true;
  return SERVICES.test(u);
}

/* Le serveur se présente aux services par l'adresse de la boutique. */
const contact = () => 'https://' + (String($os.getenv('SOKOYETU_DOMAINE') || '').replace(/^(www|admin)\./, '').split(':')[0] || 'sokoyakwetu.com');

/* Jeton VAPID (valable 12 heures) pour le service de cette adresse, gardé en mémoire 6 heures. */
function jeton(app, url) {
  const aud = String(url).match(/^https?:\/\/[^/]+/)[0];
  const st = app.store(); const k = 'push:jwt:' + aud;
  const memo = st.get(k);
  if (memo && memo.fin > Date.now()) return memo.jwt;
  const entree = P256.texteBase64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
    P256.texteBase64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact() }));
  const jwt = entree + '.' + P256.signer($security.sha256(entree), cle(app).prive, hasard);
  st.set(k, { jwt, fin: Date.now() + 6 * 3600e3 });
  return jwt;
}

/*
 * Envoie le signal à un abonnement. urgent : à montrer tout de suite (étape de commande) plutôt qu'au réveil du téléphone.
 * Renvoie 'ok', 'expire' (abonnement révoqué par le navigateur : à oublier) ou 'echec' (réessayé plus tard ; l'abonnement
 * est oublié après plusieurs échecs de suite, voir notifications.pousser).
 */
function envoyer(app, endpoint, urgent) {
  let r;
  try {
    r = $http.send({
      url: endpoint, method: 'POST', body: '', timeout: 10,
      headers: { TTL: '172800', Urgency: urgent ? 'high' : 'normal', Authorization: 'vapid t=' + jeton(app, endpoint) + ', k=' + clePublique(app) }
    });
  } catch (e) {
    S.trace('warn', 'Service de notification injoignable', { module: 'push', service: String(endpoint).split('/')[2], erreur: String(e) });
    return 'echec';
  }
  if (r.statusCode >= 200 && r.statusCode < 300) return 'ok';
  if (r.statusCode === 404 || r.statusCode === 410) return 'expire';
  S.trace('warn', 'Notification refusée par le service', { module: 'push', service: String(endpoint).split('/')[2], statut: r.statusCode, reponse: String(r.raw || '').slice(0, 200) });
  return 'echec';
}

module.exports = { cle, clePublique, adresseValide, envoyer };
