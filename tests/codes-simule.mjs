// Faux services d'envoi des codes pour les tests (mêmes adresses et réponses que Meta, Twilio et Plivo), sur un seul port :
//   POST /{ID_NUMERO}/messages                       JSON modèle WhatsApp (corps + bouton « Copier le code ») → 200 { messages: [{ id }] }
//   POST /2010-04-01/Accounts/{SID}/Messages.json   formulaire To, From, Body → 201 { sid }
//   POST /v1/Account/{AUTH_ID}/Message/             JSON { src, dst, text }   → 202 { message_uuid }
// Identifiants acceptés : numéro 1234567890, comptes ACessai0123456789 / MAessai0123456789, jeton jeton-sms-essai-0123456789
// (WhatsApp : Bearer jeton-whatsapp-essai-…, 40 caractères). Chaque message reçu est affiché.
//   PORT=8098 node tests/codes-simule.mjs
//   SOKOYETU_WHATSAPP=meta WHATSAPP_NUMERO=1234567890 WHATSAPP_JETON=jeton-whatsapp-essai-0123456789abcdefghij WHATSAPP_URL=http://127.0.0.1:8098 \
//   SOKOYETU_SMS=twilio TWILIO_COMPTE=ACessai0123456789 TWILIO_JETON=jeton-sms-essai-0123456789 TWILIO_EXPEDITEUR=Sokoyetu SOKOYETU_SMS_URL=http://127.0.0.1:8098 bash outils/serveur-local.sh
import http from 'node:http';
const PORT = Number(process.env.PORT || 8098);
const JETON = 'jeton-sms-essai-0123456789';
const JETON_WHATSAPP = 'jeton-whatsapp-essai-0123456789abcdefghij';
const autorise = (req, compte) => req.headers.authorization === 'Basic ' + Buffer.from(compte + ':' + JETON).toString('base64');
http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const r = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    let m;
    if (req.method === 'POST' && (m = req.url.match(/^\/(\d+)\/messages$/))) {
      if (req.headers.authorization !== 'Bearer ' + JETON_WHATSAPP) return r(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
      const b = JSON.parse(corps || '{}'); const t = b.template || {};
      const code = ((((t.components || [])[0] || {}).parameters || [])[0] || {}).text;
      const bouton = ((((t.components || [])[1] || {}).parameters || [])[0] || {}).text;
      if (b.messaging_product !== 'whatsapp' || !/^\d{8,15}$/.test(b.to || '') || b.type !== 'template' || !t.name || !(t.language || {}).code || !code || code !== bouton) return r(400, { error: { message: 'Invalid parameter', code: 100 } });
      console.log(`whatsapp → ${b.to} (numéro ${m[1]}, modèle ${t.name}/${t.language.code}) : code ${code}`);
      return r(200, { messaging_product: 'whatsapp', contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id: 'wamid.essai' + Date.now() }] });
    }
    if (req.method === 'POST' && (m = req.url.match(/^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/))) {
      if (!autorise(req, decodeURIComponent(m[1]))) return r(401, { code: 20003, message: 'Authenticate' });
      const b = new URLSearchParams(corps);
      if (!/^\+\d{8,15}$/.test(b.get('To') || '') || !b.get('From') || !b.get('Body')) return r(400, { code: 21211, message: 'Invalid parameters' });
      console.log(`twilio → ${b.get('To')} (de ${b.get('From')}) : ${b.get('Body')}`);
      return r(201, { sid: 'SM' + Date.now(), status: 'queued' });
    }
    if (req.method === 'POST' && (m = req.url.match(/^\/v1\/Account\/([^/]+)\/Message\/$/))) {
      if (!autorise(req, decodeURIComponent(m[1]))) return r(401, { error: 'authentication failed' });
      const b = JSON.parse(corps || '{}');
      if (!/^\d{8,15}$/.test(b.dst || '') || !b.src || !b.text) return r(400, { error: 'invalid parameters' });
      console.log(`plivo → ${b.dst} (de ${b.src}) : ${b.text}`);
      return r(202, { message: 'message(s) queued', message_uuid: ['essai-' + Date.now()] });
    }
    r(404, { message: 'introuvable' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Faux services d'envoi des codes sur http://127.0.0.1:${PORT}`));
