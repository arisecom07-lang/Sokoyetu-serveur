/*
 * Sokoyetu — paiement automatique par Mobile Money, et par carte Visa / Mastercard.
 *
 * Le fournisseur se choisit sur le serveur, jamais dans le navigateur (fichier /opt/sokoyetu/sokoyetu.env, script paiement.sh) :
 *   SOKOYETU_PAIEMENT=flexpay      FLEXPAY_MARCHAND=…  FLEXPAY_JETON=…  (FLEXPAY_URL pour l'environnement de test de FlexPay ;
 *                                  FLEXPAY_CARTE_URL si FlexPay donne une autre adresse pour le paiement par carte)
 *   SOKOYETU_PAIEMENT=simulation   essais sans argent : le paiement est confirmé au bout de quelques secondes,
 *                                  refusé si le numéro se termine par 0000 (SOKOYETU_SIMULATION_DELAI en secondes) ;
 *                                  par carte, une page de test de la boutique tient lieu de page sécurisée.
 * Sans fournisseur prêt, la boutique n'encaisse pas.
 *
 * demarrer() et verifier() renvoient { etat: 'en_attente' | 'paye' | 'echec', id, reference, message } ; pour la carte,
 * demarrer() renvoie aussi url : la page sécurisée du fournisseur, où le client saisit sa carte (jamais dans la boutique).
 * Une notification du fournisseur n'est jamais crue sur parole : le serveur revérifie toujours le statut auprès de lui,
 * et un paiement n'est reconnu que s'il porte la référence et le montant de la commande.
 */
const env = (k) => String($os.getenv(k) || '').trim();
const parCarte = (o) => require(`${__hooks}/lib/serveur.js`).R.estCarte(o.payment && o.payment.method);
// Page de paiement par carte du fournisseur : toujours en https (http seulement pour un faux FlexPay sur cet ordinateur, en test).
const pageSure = (u) => /^https:\/\/[^\s"'<>]+$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)[:/][^\s"'<>]*$/.test(u);

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
  // Carte : la page de test de la boutique (opts.pageTest) tient lieu de page sécurisée ; on y choisit l'issue du paiement.
  demarrer(o, opts) {
    return { etat: 'en_attente', id: `SIM-${o.number}-${(o.payment.attempts || 0) + 1}`, message: '', url: parCarte(o) ? opts.pageTest || '' : '' };
  },
  verifier(o) {
    if (parCarte(o)) {
      const x = o.payment.simulation;
      if (!x || x.id !== o.payment.providerId) return { etat: 'en_attente' };
      if (x.issue === 'ok') return { etat: 'paye', reference: 'TEST' + String(Date.now()).slice(-8) };
      return { etat: 'echec', message: x.issue === 'refus' ? 'Carte refusée (simulation).' : 'Paiement par carte annulé.' };
    }
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
  // Paiement par carte (VPOS) : FlexPay ouvre une page sécurisée et renvoie le client vers la boutique.
  carte: () => env('FLEXPAY_CARTE_URL') || 'https://cardpayment.flexpay.cd/v1.1/pay',
  // delai : secondes d'attente au plus (une demande de paiement peut être lente à partir, une vérification non).
  appel(chemin, methode, corps, delai) { return flexpay.envoyer(flexpay.base() + chemin, methode, corps, delai); },
  envoyer(url, methode, corps, delai) {
    if (coupe()) return { erreurReseau: true, coupe: true };
    let res;
    try {
      res = $http.send({
        url, method: methode, timeout: delai || 30,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + env('FLEXPAY_JETON') },
        body: corps ? JSON.stringify(corps) : ''
      });
    } catch (err) { enPanne(String(err).slice(0, 200)); return { erreurReseau: true }; }
    if (res.statusCode >= 500) enPanne('HTTP ' + res.statusCode); else retabli();
    return { statut: res.statusCode, j: res.json || {} };
  },
  /* Réponse d'erreur commune (réseau, jeton refusé) ; null si FlexPay a répondu. */
  refus(r) {
    if (r.erreurReseau) return { etat: 'echec', message: r.coupe ? 'Le service de paiement ne répond pas pour le moment. Réessayez dans une minute.' : 'Le service de paiement ne répond pas. Réessayez dans un instant.' };
    if (r.statut === 401 || r.statut === 403) {
      require(`${__hooks}/lib/serveur.js`).trace('error', 'FlexPay refuse le jeton du marchand (paiement.sh)', { module: 'paiement', statut: r.statut });
      return { etat: 'echec', message: 'Paiement momentanément indisponible (configuration du service de paiement).' };
    }
    return null;
  },
  demarrer(o, opts) {
    const reference = `${o.number}-${(o.payment.attempts || 0) + 1}`;
    if (parCarte(o)) {
      // Le jeton part aussi dans le corps : c'est ainsi que l'API carte de FlexPay l'attend.
      const r = flexpay.envoyer(flexpay.carte(), 'POST', {
        authorization: 'Bearer ' + env('FLEXPAY_JETON'), merchant: env('FLEXPAY_MARCHAND'), reference,
        amount: Number(o.total).toFixed(2), currency: 'USD', description: `Commande ${o.number}`, callback_url: opts.callbackUrl,
        approve_url: opts.retour.ok, cancel_url: opts.retour.annule, decline_url: opts.retour.refuse, home_url: opts.retour.accueil
      });
      const x = flexpay.refus(r);
      if (x) return x;
      if (String(r.j.code) === '0' && pageSure(String(r.j.url || ''))) return { etat: 'en_attente', id: String(r.j.orderNumber || ''), url: String(r.j.url) };
      return { etat: 'echec', message: String(r.j.message || 'Le paiement par carte n’a pas pu s’ouvrir.').slice(0, 160) };
    }
    const r = flexpay.appel('/paymentService', 'POST', {
      merchant: env('FLEXPAY_MARCHAND'), type: '1',
      phone: '243' + String(o.payment.phone).replace(/^0/, ''),
      reference, amount: Number(o.total).toFixed(2), currency: 'USD', callbackUrl: opts.callbackUrl
    });
    const x = flexpay.refus(r);
    if (x) return x;
    if (String(r.j.code) === '0' && r.j.orderNumber) return { etat: 'en_attente', id: String(r.j.orderNumber) };
    return { etat: 'echec', message: String(r.j.message || 'La demande de paiement a été refusée.').slice(0, 160) };
  },
  verifier(o) {
    if (!o.payment.providerId) return { etat: 'en_attente' };
    const r = flexpay.appel('/check/' + encodeURIComponent(o.payment.providerId), 'GET', null, 15);
    if (r.erreurReseau || r.statut >= 500) return { etat: 'en_attente' };
    const t = r.j.transaction || {};
    if (String(r.j.code) !== '0' || r.j.transaction === undefined) return { etat: 'en_attente' };
    // La transaction doit être celle de cette commande (sa référence), en dollars, d'au moins son montant : une notification
    // ne peut pas faire passer pour payée une commande avec le paiement d'une autre, plus petite.
    const ref = String(t.reference || '');
    const montant = t.amount === undefined || t.amount === null || t.amount === '' ? null : Number(t.amount);
    if ((ref && ref.split('-')[0] !== String(o.number)) || (montant !== null && !(montant + 0.01 >= Number(o.total))) || String(t.currency || '').toUpperCase() === 'CDF') {
      require(`${__hooks}/lib/serveur.js`).trace('warn', 'Transaction FlexPay qui ne correspond pas à la commande : ignorée', { module: 'paiement', commande: o.number, transaction: o.payment.providerId, reference: ref, montant: t.amount, devise: t.currency });
      return { etat: 'en_attente' };
    }
    const s = String(t.status);
    if (s === '0') return { etat: 'paye', reference: String(t.provider_reference || t.reference || o.payment.providerId) };
    if (s === '1') return { etat: 'echec', message: parCarte(o) ? 'Carte refusée ou paiement annulé.' : 'Paiement refusé ou annulé sur le téléphone.' };
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
