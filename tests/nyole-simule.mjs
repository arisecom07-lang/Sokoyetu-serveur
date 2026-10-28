// Faux serveur nyole pour les tests (mêmes adresses et réponses que l'API nyole, https://nyole.com/docs/) :
//   POST /api/v1/checkout/sessions            → 201 { id, object: 'checkout.session', url, order_id, amount, currency, status: 'pending', livemode }
//   GET  /api/v1/checkout/sessions/{id}/status → { id, status: PENDING | SUCCESS | FAILED, paid, amount, currency, order_id, provider, provider_reference }
//   GET  /checkout/{id}                        → fausse page de paiement : « payée » dès qu'elle est ouverte, puis retour vers success_url
// Un numéro finissant par 0000 est refusé ; les autres sont payés à la 2e vérification. PORT=8098 node tests/nyole-simule.mjs
import http from 'node:http';
const PORT = Number(process.env.PORT || 8098);
const CLE = 'af_test_sec_essai0123456789';
const sessions = new Map();
const cles = new Map(); // Idempotency-Key → id
http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const r = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const page = req.url.match(/^\/checkout\/([^/?]+)$/);
    if (req.method === 'GET' && page) {
      const s = sessions.get(decodeURIComponent(page[1]));
      if (!s) return r(404, { message: 'introuvable' });
      s.vues = Math.max(s.vues, 1);
      res.writeHead(302, { Location: s.b.success_url || '/' }); return res.end();
    }
    if (req.headers.authorization !== 'Bearer ' + CLE) return r(401, { error: { message: 'Clé API invalide' } });
    if (req.method === 'POST' && req.url === '/api/v1/checkout/sessions') {
      const b = JSON.parse(corps || '{}');
      const k = req.headers['idempotency-key'];
      if (k && cles.has(k)) { const s = sessions.get(cles.get(k)); res.setHeader('Idempotent-Replayed', 'true'); return r(200, s.reponse); }
      if (!Number.isInteger(b.amount) || b.amount <= 0 || b.currency !== 'USD' || !/^\+243\d{9}$/.test(b.customer_phone || '') || !b.metadata || !b.metadata.order_id) return r(400, { error: { message: 'Requête invalide' } });
      const id = 'cs' + Date.now() + Math.floor(Math.random() * 1000);
      const reponse = { id, object: 'checkout.session', url: `http://127.0.0.1:${PORT}/checkout/${id}`, order_id: 'CS-' + id.slice(-8).toUpperCase(), amount: b.amount, currency: b.currency, status: 'pending', livemode: false, created: new Date().toISOString() };
      sessions.set(id, { b, vues: 0, reponse });
      if (k) cles.set(k, id);
      console.log('session', b.metadata.reference, b.customer_phone, b.amount, b.success_url);
      return r(201, reponse);
    }
    const m = req.url.match(/^\/api\/v1\/checkout\/sessions\/([^/]+)\/status$/);
    if (req.method === 'GET' && m) {
      const s = sessions.get(decodeURIComponent(m[1]));
      if (!s) return r(404, { error: { message: 'Session introuvable' } });
      s.vues++;
      const status = /0000$/.test(s.b.customer_phone) ? 'FAILED' : s.vues >= 2 ? 'SUCCESS' : 'PENDING';
      return r(200, { id: m[1], status, paid: status === 'SUCCESS', amount: s.b.amount, currency: s.b.currency, order_id: s.reponse.order_id, provider: 'Essai', provider_reference: status === 'SUCCESS' ? 'NY' + m[1].slice(-6) : '' });
    }
    r(404, { message: 'introuvable' });
  });
}).listen(PORT, '127.0.0.1', () => console.log('Faux nyole sur http://127.0.0.1:' + PORT));
