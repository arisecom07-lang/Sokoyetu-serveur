/*
 * Sokoyetu — envoi des codes de connexion des comptes clients : par WhatsApp d'abord, par SMS en secours.
 *
 * Les services se choisissent sur le serveur, jamais dans le navigateur (fichier /opt/sokoyetu/sokoyetu.env, script codes.sh) :
 *   SOKOYETU_WHATSAPP=meta    WHATSAPP_NUMERO=<identifiant du numéro chez Meta>  WHATSAPP_JETON=…
 *                             WHATSAPP_MODELE=<modèle « authentification » validé par Meta> (code_connexion par défaut)
 *                             WHATSAPP_LANGUE=fr (langue du modèle)
 *   SOKOYETU_SMS=twilio       TWILIO_COMPTE=AC…  TWILIO_JETON=…  TWILIO_EXPEDITEUR=+1… (ou un nom, ex. Sokoyetu)
 *   SOKOYETU_SMS=plivo        PLIVO_COMPTE=MA…   PLIVO_JETON=…   PLIVO_EXPEDITEUR=+1… (ou un nom)
 *   SOKOYETU_WHATSAPP=simulation / SOKOYETU_SMS=simulation
 *                             essais : rien n'est envoyé, le code s'affiche à l'écran. Jamais sur la vraie boutique.
 *   SOKOYETU_SMS_MAX_JOUR     plafond de codes envoyés par jour pour toute la boutique (200 par défaut), contre les abus.
 *   WHATSAPP_URL, SOKOYETU_SMS_URL   essais seulement : adresse d'un faux service (tests/codes-simule.mjs).
 * Sans aucun service prêt, la boutique ne propose pas de compte : on commande sans compte, comme avant.
 *
 * Un message WhatsApp accepté par Meta peut ne jamais arriver (numéro sans WhatsApp) : la boutique propose alors
 * « Recevoir le code par SMS » si le SMS est prêt. envoyer() renvoie { ok: true } ou { ok: false, message }.
 */
const env = (k) => String($os.getenv(k) || '').trim();
const CANAUX = ['whatsapp', 'sms'];

function fournisseur(canal) {
  const f = env(canal === 'whatsapp' ? 'SOKOYETU_WHATSAPP' : 'SOKOYETU_SMS').toLowerCase();
  const permis = canal === 'whatsapp' ? ['meta', 'simulation'] : ['twilio', 'plivo', 'simulation'];
  return permis.indexOf(f) >= 0 ? f : '';
}
function pret(canal) {
  if (!canal) return CANAUX.some(pret);
  const f = fournisseur(canal);
  if (f === 'simulation') return true;
  if (f === 'meta') return !!(env('WHATSAPP_NUMERO') && env('WHATSAPP_JETON'));
  if (f === 'twilio') return !!(env('TWILIO_COMPTE') && env('TWILIO_JETON') && env('TWILIO_EXPEDITEUR'));
  if (f === 'plivo') return !!(env('PLIVO_COMPTE') && env('PLIVO_JETON') && env('PLIVO_EXPEDITEUR'));
  return false;
}
/* Canaux ouverts, WhatsApp en premier. */
const canaux = () => CANAUX.filter(pret);
const enTest = (canal) => fournisseur(canal) === 'simulation';
/* Ce que l'administration et la boutique ont le droit de savoir (aucune clé). */
const etat = () => ({
  pret: pret(), canaux: canaux(), test: canaux().some(enTest),
  whatsapp: { fournisseur: fournisseur('whatsapp'), pret: pret('whatsapp') }, sms: { fournisseur: fournisseur('sms'), pret: pret('sms') }
});
const maxParJour = () => Math.max(1, parseInt(env('SOKOYETU_SMS_MAX_JOUR'), 10) || 200);

/* Base64 pour l'authentification HTTP (le moteur JavaScript du serveur n'a pas btoa). */
function base64(texte) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const o = unescape(encodeURIComponent(texte)); let s = '';
  for (let i = 0; i < o.length; i += 3) {
    const n = (o.charCodeAt(i) << 16) | ((o.charCodeAt(i + 1) || 0) << 8) | (o.charCodeAt(i + 2) || 0);
    s += a[(n >> 18) & 63] + a[(n >> 12) & 63] + (i + 1 < o.length ? a[(n >> 6) & 63] : '=') + (i + 2 < o.length ? a[n & 63] : '=');
  }
  return s;
}
function appel(url, autorisation, type, corps) {
  try {
    const res = $http.send({ url, method: 'POST', timeout: 20, body: corps, headers: { 'Content-Type': type, Accept: 'application/json', Authorization: autorisation } });
    return { statut: res.statusCode, j: res.json || {} };
  } catch (err) { console.log('sokoyetu envoi réseau', String(err)); return { statut: 0, j: {} }; }
}
const ECHEC = 'Le code n’a pas pu être envoyé. Vérifiez le numéro, puis réessayez dans un instant.';
const base = (variable, vraie) => (env(variable) || vraie).replace(/\/+$/, '');
const basic = (compte, jeton) => 'Basic ' + base64(compte + ':' + jeton);
const enc = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

const FOURNISSEURS = {
  simulation: { envoyer: () => ({ ok: true }) },
  // Modèle « authentification » avec bouton « Copier le code » :
  // https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/copy-code-button-authentication-templates
  meta: {
    envoyer(tel, code) {
      const r = appel(`${base('WHATSAPP_URL', 'https://graph.facebook.com/v26.0')}/${encodeURIComponent(env('WHATSAPP_NUMERO'))}/messages`, 'Bearer ' + env('WHATSAPP_JETON'), 'application/json', JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: tel.replace(/^\+/, ''), type: 'template',
        template: {
          name: env('WHATSAPP_MODELE') || 'code_connexion', language: { code: env('WHATSAPP_LANGUE') || 'fr' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }]
        }
      }));
      const ok = r.statut === 200 && r.j.messages && r.j.messages.length;
      return ok ? { ok: true } : { ok: false, message: ECHEC, detail: String((r.j.error && r.j.error.message) || r.statut) };
    }
  },
  // https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
  twilio: {
    envoyer(tel, code, texte) {
      const c = env('TWILIO_COMPTE');
      const r = appel(`${base('SOKOYETU_SMS_URL', 'https://api.twilio.com')}/2010-04-01/Accounts/${encodeURIComponent(c)}/Messages.json`, basic(c, env('TWILIO_JETON')), 'application/x-www-form-urlencoded', enc({ To: tel, From: env('TWILIO_EXPEDITEUR'), Body: texte }));
      return r.statut === 201 || r.statut === 200 ? { ok: true } : { ok: false, message: ECHEC, detail: String(r.j.message || r.statut) };
    }
  },
  // https://www.plivo.com/docs/messaging/api/message#send-a-message
  plivo: {
    envoyer(tel, code, texte) {
      const c = env('PLIVO_COMPTE');
      const r = appel(`${base('SOKOYETU_SMS_URL', 'https://api.plivo.com')}/v1/Account/${encodeURIComponent(c)}/Message/`, basic(c, env('PLIVO_JETON')), 'application/json', JSON.stringify({ src: env('PLIVO_EXPEDITEUR'), dst: tel.replace(/^\+/, ''), text: texte }));
      return r.statut === 202 || r.statut === 200 ? { ok: true } : { ok: false, message: ECHEC, detail: String(r.j.error || r.statut) };
    }
  }
};

/* Envoie le code sur ce canal (numéro au format international +243…) ; texte : le SMS complet. */
function envoyer(canal, tel, code, texte) {
  const f = pret(canal) ? FOURNISSEURS[fournisseur(canal)] : null;
  if (!f) return { ok: false, message: canal === 'whatsapp' ? 'L’envoi du code par WhatsApp n’est pas ouvert.' : 'L’envoi du code par SMS n’est pas ouvert.' };
  try {
    const r = f.envoyer(tel, code, texte);
    if (!r.ok) console.log('sokoyetu envoi', canal, fournisseur(canal), r.detail || '');
    return r;
  } catch (err) { return { ok: false, message: ECHEC }; }
}

module.exports = { CANAUX, fournisseur, pret, canaux, enTest, etat, envoyer, maxParJour, base64 };
