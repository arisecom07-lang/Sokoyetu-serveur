// Faux serveur FlexPay pour les tests (mêmes adresses et réponses que l'API FlexPay) :
//   POST /api/rest/v1/paymentService  → { code: '0', orderNumber }
//   POST /v1.1/pay (carte, jeton aussi dans le corps) → { code: '0', orderNumber, url } : la page « sécurisée » GET /vpos/{orderNumber}
//   GET  /api/rest/v1/check/{orderNumber} → { code: '0', transaction: { status: '2' (en attente) | '0' (payé) | '1' (refusé) } }
// Un numéro finissant par 0000 est refusé ; les autres sont payés à la 2e vérification. Par carte, le client choisit sur la page
// (GET /vpos/{orderNumber}/ok, /refus ou /annule), puis revient à la boutique. PORT=8099 node tests/flexpay-simule.mjs
import http from 'node:http';
const PORT = Number(process.env.PORT || 8099);
const JETON = 'Bearer jeton-de-test-flexpay-0123456789';
const tx = new Map();
const numero = (prefixe) => prefixe + Date.now() + Math.floor(Math.random() * 1000);
http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const r = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    // Page de paiement par carte : ouverte par le navigateur du client, donc sans jeton.
    const v = req.url.match(/^\/vpos\/([^/?]+)(?:\/(ok|refus|annule))?$/);
    if (req.method === 'GET' && v) {
      const t = tx.get(decodeURIComponent(v[1]));
      if (!t || !t.carte) return r(404, { message: 'introuvable' });
      if (!v[2]) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<h1>Faux FlexPay : ${t.b.amount} ${t.b.currency}</h1>` + ['ok', 'refus', 'annule'].map((x) => `<p><a href="/vpos/${v[1]}/${x}">${x}</a></p>`).join(''));
      }
      t.issue = v[2];
      console.log('carte', t.b.reference, t.issue);
      res.writeHead(302, { Location: { ok: t.b.approve_url, refus: t.b.decline_url, annule: t.b.cancel_url }[t.issue] });
      return res.end();
    }
    if (req.headers.authorization !== JETON) return r(401, { message: 'Unauthorized' });
    if (req.method === 'POST' && req.url === '/api/rest/v1/paymentService') {
      const b = JSON.parse(corps || '{}');
      if (!/^243\d{9}$/.test(b.phone) || b.merchant !== 'SOKOYETU' || b.currency !== 'USD' || !b.callbackUrl) return r(200, { code: '1', message: 'Requête invalide' });
      const n = numero('FP');
      tx.set(n, { b, vues: 0 });
      console.log('demande', b.reference, b.phone, b.amount, b.callbackUrl);
      return r(200, { code: '0', message: 'Transaction envoyée', orderNumber: n });
    }
    if (req.method === 'POST' && req.url === '/v1.1/pay') {
      const b = JSON.parse(corps || '{}');
      if (b.authorization !== JETON || b.merchant !== 'SOKOYETU' || b.currency !== 'USD' || !b.reference || ![b.callback_url, b.approve_url, b.cancel_url, b.decline_url, b.home_url].every(Boolean)) return r(200, { code: '1', message: 'Requête invalide' });
      const n = numero('FC');
      tx.set(n, { b, carte: true, issue: '' });
      console.log('carte demandée', b.reference, b.amount, b.approve_url);
      return r(200, { code: '0', message: 'Redirection en cours', orderNumber: n, url: `http://127.0.0.1:${PORT}/vpos/${n}` });
    }
    const m = req.url.match(/^\/api\/rest\/v1\/check\/(.+)$/);
    if (req.method === 'GET' && m) {
      const t = tx.get(decodeURIComponent(m[1]));
      if (!t) return r(200, { code: '1', message: 'Transaction introuvable' });
      t.vues = (t.vues || 0) + 1;
      const status = t.carte ? ({ ok: '0', refus: '1', annule: '1' }[t.issue] || '2') : /0000$/.test(t.b.phone) ? '1' : t.vues >= 2 ? '0' : '2';
      return r(200, { code: '0', message: 'ok', transaction: { reference: t.b.reference, orderNumber: m[1], status, amount: t.b.amount, currency: 'USD', provider_reference: status === '0' ? (t.carte ? 'VPOS' : 'MP') + m[1].slice(-6) : '' } });
    }
    r(404, { message: 'introuvable' });
  });
}).listen(PORT, '127.0.0.1', () => console.log('Faux FlexPay sur http://127.0.0.1:' + PORT));
