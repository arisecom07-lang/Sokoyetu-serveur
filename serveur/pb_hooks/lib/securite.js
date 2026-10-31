/*
 * Sokoyetu — verrou des connexions par mot de passe (administration et tableau technique /_/).
 *
 * Après ECHECS mots de passe refusés en FENETRE pour un même compte, d'où qu'ils viennent, ce compte refuse toute
 * connexion pendant BLOCAGE : une attaque répartie sur beaucoup d'adresses IP ne peut pas essayer des milliers de mots
 * de passe (la limite par adresse, 5 essais en 15 secondes, s'applique en plus). Les sessions déjà ouvertes continuent,
 * et une connexion réussie remet le compteur à zéro. Un compte inexistant se comporte comme un vrai (rien n'est révélé).
 */
const S = require(`${__hooks}/lib/serveur.js`);

const ECHECS = 10;
const FENETRE = 15 * 60e3;
const BLOCAGE = 15 * 60e3;

const cleDe = (e) => String(e.collection.name) + ':' + String(e.identity || '').trim().toLowerCase().slice(0, 160);

function etat(app, cle) {
  const l = arrayOf(new DynamicModel({ n: 0, debut: 0, dernier: 0 }));
  app.db().newQuery('SELECT n, debut, dernier FROM sokoyetu_echecs WHERE cle = {:c}').bind({ c: cle }).all(l);
  return l.length ? { n: Number(l[0].n), debut: Number(l[0].debut), dernier: Number(l[0].dernier) } : null;
}

/* Un échec de plus (en une seule écriture : des essais simultanés comptent tous) ; renvoie le nombre d'échecs de la fenêtre. */
function noter(app, cle, t) {
  app.db().newQuery(`INSERT INTO sokoyetu_echecs (cle, n, debut, dernier) VALUES ({:c}, 1, {:t}, {:t})
    ON CONFLICT (cle) DO UPDATE SET n = CASE WHEN debut < {:f} THEN 1 ELSE n + 1 END,
      debut = CASE WHEN debut < {:f} THEN {:t} ELSE debut END, dernier = {:t}`).bind({ c: cle, t, f: t - FENETRE }).execute();
  const x = etat(app, cle);
  return x ? x.n : 0;
}

/* Minutes de verrou restantes pour ce compte (0 : pas de verrou). */
function verrou(x, t) {
  if (!x || x.n < ECHECS || t - x.dernier >= BLOCAGE) return 0;
  return Math.max(1, Math.ceil((BLOCAGE - (t - x.dernier)) / 60e3));
}

/* Gestionnaire de onRecordAuthWithPasswordRequest : verrou, vérification du mot de passe (e.next), puis bilan. */
function connexion(e) {
  const app = e.app; const cle = cleDe(e); const t = Date.now();
  const x = etat(app, cle);
  const minutes = verrou(x, t);
  if (minutes) throw new ApiError(429, `Trop de mots de passe refusés pour ce compte : par sécurité, il est verrouillé encore ${minutes} minute${minutes > 1 ? 's' : ''}. Réessayez ensuite.`);
  let ok = false;
  try {
    e.next();
    ok = true;
  } finally {
    if (ok) { if (x) app.db().newQuery('DELETE FROM sokoyetu_echecs WHERE cle = {:c}').bind({ c: cle }).execute(); }
    else if (noter(app, cle, t) === ECHECS && e.record) {
      S.trace('warn', 'Compte verrouillé 15 minutes après plusieurs mots de passe refusés', { module: 'securite', compte: e.record.email(), collection: e.collection.name, ip: e.realIP() });
    }
  }
}

/* Chaque nuit : échecs de plus d'un jour oubliés. */
function purger(app) {
  app.db().newQuery('DELETE FROM sokoyetu_echecs WHERE dernier < {:t}').bind({ t: Date.now() - 864e5 }).execute();
}

module.exports = { ECHECS, FENETRE, BLOCAGE, connexion, purger, verrou };
