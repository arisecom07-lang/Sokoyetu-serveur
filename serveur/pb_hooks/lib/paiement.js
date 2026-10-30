/*
 * Sokoyetu — paiement automatique par Mobile Money.
 *
 * Le fournisseur se choisit sur le serveur, jamais dans le navigateur (fichier /opt/sokoyetu/sokoyetu.env, script paiement.sh) :
 *   SOKOYETU_PAIEMENT=flexpay      FLEXPAY_MARCHAND=…  FLEXPAY_JETON=…  (FLEXPAY_URL pour l'environnement de test de FlexPay)
 *   SOKOYETU_PAIEMENT=simulation   essais sans argent : le paiement est confirmé au bout de quelques secondes,
 *                                  refusé si le numéro se termine par 0000 (SOKOYETU_SIMULATION_DELAI en secondes).
 * Sans fournisseur prêt, la boutique n'encaisse pas.
 *
 * demarrer() et verifier() renvoient { etat: 'en_attente' | 'paye' | 'echec', id, reference, message }.
 * Une notification du fournisseur n'est jamais crue sur parole : le serveur revérifie toujours le statut auprès de lui.
 */
const env = (k) => String($os.getenv(k) || '').trim();

function fournisseur() {
  const f = env('SOKOYETU_PAIEMENT').toLowerCase();
  return f === 'flexpay' || f === 'simulation' ? f : '';
}
function pret() {
  const f = fournisseur();
  if (f === 'simulation') return true;
  if (f === 'flexpay') return !!(env('FLEXPAY_MARCHAND') && env('FLEXPAY_JETON'));
  return false;
}
/*
 * Disjoncteur : si le fournisseur ne répond plus (réseau coupé, panne chez lui), le serveur arrête de l'appeler
 * pendant PAUSE ms après ECHECS échecs de suite, au lieu de faire attendre chaque client et de bloquer le serveur.
 * L'état est partagé par tout le serveur (mémoire, $app.store()) et revient à la normale au premier appel réussi.
 */
const ECHECS = 3;
const PAUSE = 60000;
function enPanne(detail) {
  const st = $app.store();
  const n = (Number(st.get('paiement:echecs')) || 0) + 1;
  st.set('paiement:echecs', n);
  if (!st.get('paiement:panne')) st.set('paiement:panne', Date.now());
  if (n >= ECHECS) {
    st.set('paiement:coupe', Date.now() + PAUSE);
    if (n === ECHECS) require(`${__hooks}/lib/serveur.js`).trace('error', 'Le service de paiement ne répond pas : appels suspendus une minute', { module: 'paiement', fournisseur: fournisseur(), detail });
  }
}
function retabli() {
  const st = $app.store();
  if (st.get('paiement:panne')) require(`${__hooks}/lib/serveur.js`).trace('warn', 'Le service de paiement répond de nouveau', { module: 'paiement', fournisseur: fournisseur(), duree: Math.round((Date.now() - Number(st.get('paiement:panne'))) / 1000) + ' s' });
  ['paiement:echecs', 'paiement:panne', 'paiement:coupe'].forEach((k) => st.remove(k));
}
const coupe = () => (Number($app.store().get('paiement:coupe')) || 0) > Date.now();

/* Ce que l'administration et la boutique ont le droit de savoir (aucune clé). panne : depuis quand le fournisseur ne répond plus. */
const etat = () => ({ fournisseur: fournisseur(), pret: pret(), test: fournisseur() === 'simulation', panne: Number($app.store().get('paiement:panne')) || 0 });

/* ---------- Simulation ---------- */

const simulation = {
  demarrer(o) {
    return { etat: 'en_attente', id: `SIM-${o.number}-${(o.payment.attempts || 0) + 1}`, message: '' };
  },
  verifier(o) {
    const delai = (Number(env('SOKOYETU_SIMULATION_DELAI')) || 8) * 1000;
    if (Date.now() - Number(o.payment.startedAt || 0) < delai) return { etat: 'en_attente' };
    if (/0000$/.test(String(o.payment.phone || ''))) return { etat: 'echec', message: 'Solde insuffisant (simulation).' };
    return { etat: 'paye', reference: 'TEST' + String(Date.now()).slice(-8) };
  },
  /* Notifications d'essai (même forme que FlexPay) : pour tester la revérification et les doubles paiements. */
  commandeConcernee(corps) {
    return { providerId: String(corps.orderNumber || ''), numero: String(corps.reference || '').split('-')[0] };
  }
};

/* ---------- FlexPay (RDC : M-Pesa, Airtel Money, Orange Money, Afrimoney) ---------- */

const flexpay = {
  base: () => (env('FLEXPAY_URL') || 'https://backend.flexpay.cd/api/rest/v1').replace(/\/+$/, ''),
  // delai : secondes d'attente au plus (une demande de paiement peut être lente à partir, une vérification non).
  appel(chemin, methode, corps, delai) {
    if (coupe()) return { erreurReseau: true, coupe: true };
    let res;
    try {
      res = $http.send({
        url: flexpay.base() + chemin, method: methode, timeout: delai || 30,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + env('FLEXPAY_JETON') },
        body: corps ? JSON.stringify(corps) : ''
      });
    } catch (err) { enPanne(String(err).slice(0, 200)); return { erreurReseau: true }; }
    if (res.statusCode >= 500) enPanne('HTTP ' + res.statusCode); else retabli();
    return { statut: res.statusCode, j: res.json || {} };
  },
  demarrer(o, opts) {
    const r = flexpay.appel('/paymentService', 'POST', {
      merchant: env('FLEXPAY_MARCHAND'), type: '1',
      phone: '243' + String(o.payment.phone).replace(/^0/, ''),
      reference: `${o.number}-${(o.payment.attempts || 0) + 1}`,
      amount: Number(o.total).toFixed(2), currency: 'USD', callbackUrl: opts.callbackUrl
    });
    if (r.erreurReseau) return { etat: 'echec', message: r.coupe ? 'Le service de paiement ne répond pas pour le moment. Réessayez dans une minute.' : 'Le service de paiement ne répond pas. Réessayez dans un instant.' };
    if (r.statut === 401 || r.statut === 403) {
      require(`${__hooks}/lib/serveur.js`).trace('error', 'FlexPay refuse le jeton du marchand (paiement.sh)', { module: 'paiement', statut: r.statut });
      return { etat: 'echec', message: 'Paiement momentanément indisponible (configuration du service de paiement).' };
    }
    if (String(r.j.code) === '0' && r.j.orderNumber) return { etat: 'en_attente', id: String(r.j.orderNumber) };
    return { etat: 'echec', message: String(r.j.message || 'La demande de paiement a été refusée.').slice(0, 160) };
  },
  verifier(o) {
    if (!o.payment.providerId) return { etat: 'en_attente' };
    const r = flexpay.appel('/check/' + encodeURIComponent(o.payment.providerId), 'GET', null, 15);
    if (r.erreurReseau || r.statut >= 500) return { etat: 'en_attente' };
    const t = r.j.transaction || {};
    if (String(r.j.code) !== '0' || r.j.transaction === undefined) return { etat: 'en_attente' };
    const s = String(t.status);
    if (s === '0') return { etat: 'paye', reference: String(t.provider_reference || t.reference || o.payment.providerId) };
    if (s === '1') return { etat: 'echec', message: 'Paiement refusé ou annulé sur le téléphone.' };
    return { etat: 'en_attente' };
  },
  /* Notification envoyée par FlexPay : seulement pour savoir quelle commande revérifier. */
  commandeConcernee(corps) {
    return { providerId: String(corps.orderNumber || ''), numero: String(corps.reference || '').split('-')[0] };
  }
};

const FOURNISSEURS = { simulation, flexpay };
const actif = () => (pret() ? FOURNISSEURS[fournisseur()] : null);

function demarrer(o, opts) {
  const f = actif();
  if (!f) return { etat: 'echec', message: 'Le paiement en ligne n’est pas encore ouvert.' };
  try { return f.demarrer(o, opts || {}); } catch (err) { return { etat: 'echec', message: 'Le service de paiement ne répond pas. Réessayez dans un instant.' }; }
}
function verifier(o) {
  const f = FOURNISSEURS[(o.payment && o.payment.provider) || ''];
  if (!f) return { etat: 'en_attente' };
  try { return f.verifier(o); } catch (err) { return { etat: 'en_attente' }; }
}
function commandeConcernee(nom, corps) {
  const f = FOURNISSEURS[nom];
  return f && f.commandeConcernee ? f.commandeConcernee(corps || {}) : null;
}

module.exports = { fournisseur, pret, etat, demarrer, verifier, commandeConcernee };
