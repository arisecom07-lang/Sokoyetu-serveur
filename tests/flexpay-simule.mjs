// Faux serveur FlexPay pour les tests (mêmes adresses et réponses que l'API FlexPay) :
//   POST /api/rest/v1/paymentService  → { code: '0', orderNumber }
//   GET  /api/rest/v1/check/{orderNumber} → { code: '0', transaction: { status: '2' (en attente) | '0' (payé) | '1' (refusé) } }
// Un numéro finissant par 0000 est refusé ; les autres sont payés à la 2e vérification. PORT=8099 node tests/flexpay-simule.mjs
import http from 'node:http';
const PORT = Number(process.env.PORT || 8099);
const tx = new Map();
http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const r = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer jeton-de-test-flexpay-0123456789') return r(401, { message: 'Unauthorized' });
    if (req.method === 'POST' && req.url === '/api/rest/v1/paymentService') {
      const b = JSON.parse(corps || '{}');
      if (!/^243\d{9}$/.test(b.phone) || b.merchant !== 'SOKOYETU' || b.currency !== 'USD' || !b.callbackUrl) return r(200, { code: '1', message: 'Requête invalide' });
      const n = 'FP' + Date.now() + Math.floor(Math.random() * 1000);
      tx.set(n, { b, vues: 0 });
      console.log('demande', b.reference, b.phone, b.amount, b.callbackUrl);
      return r(200, { code: '0', message: 'Transaction envoyée', orderNumber: n });
    }
    const m = req.url.match(/^\/api\/rest\/v1\/check\/(.+)$/);
    if (req.method === 'GET' && m) {
      const t = tx.get(decodeURIComponent(m[1]));
      if (!t) return r(200, { code: '1', message: 'Transaction introuvable' });
      t.vues++;
      const status = /0000$/.test(t.b.phone) ? '1' : t.vues >= 2 ? '0' : '2';
      return r(200, { code: '0', message: 'ok', transaction: { reference: t.b.reference, orderNumber: m[1], status, amount: t.b.amount, currency: 'USD', provider_reference: status === '0' ? 'MP' + m[1].slice(-6) : '' } });
    }
    r(404, { message: 'introuvable' });
  });
}).listen(PORT, '127.0.0.1', () => console.log('Faux FlexPay sur http://127.0.0.1:' + PORT));
