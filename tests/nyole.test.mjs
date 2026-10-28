// Paiement par nyole (page de paiement hébergée), contre le faux nyole :
//   node tests/nyole-simule.mjs
//   SOKOYETU_PAIEMENT=nyole NYOLE_URL=http://127.0.0.1:8098/api/v1 NYOLE_CLE=af_test_sec_essai0123456789 PORT=8091 DATA=.local/pb_nyole bash outils/serveur-local.sh
//   BASE=http://127.0.0.1:8091 node --test tests/nyole.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8091';
let jeton = '';
async function api(chemin, { method = 'GET', body, auth = false } = {}) {
  const h = {};
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) h.Authorization = jeton;
  const r = await fetch(BASE + chemin, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const texte = await r.text();
  let json = null; try { json = JSON.parse(texte); } catch (e) { }
  return { status: r.status, json, texte };
}
const secret = () => Array.from({ length: 32 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 57)]).join('');
const ecrire = (col, id, doc) => api(`/api/collections/${col}/records/${id}`, { method: 'PATCH', auth: true, body: { doc } })
  .then((r) => (r.status === 404 ? api(`/api/collections/${col}/records`, { method: 'POST', auth: true, body: { id, doc } }) : r));
const saisie = (t, tel) => ({
  token: t, termsAccepted: true, customer: { name: 'Grâce Mapendo', phone: '099 123 4567' },
  shipping: { zoneId: 'bukavu', address: 'Nyawera, av. Lumumba 12' },
  items: [{ productId: 'n-sac', qty: 1 }], payment: { method: 'mpesa', phone: tel }, total: 22.4
});

test('préparation', async () => {
  const r = await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' } });
  jeton = r.json.token;
  assert.equal((await ecrire('config', 'store', { name: 'Sokoyetu', payments: { mpesa: { enabled: true }, afrimoney: { enabled: true } }, freeShippingOver: 0 })).status, 200);
  assert.equal((await ecrire('products', 'n-sac', { title: 'Sac d’essai', price: 20, status: 'active', source: 'local', stock: 5, images: [] })).status, 200);
});

test('catalogue : nyole à redirection, en mode essai', async () => {
  const r = await api('/api/sokoyetu/catalogue');
  assert.deepEqual(r.json.config.payment, { provider: 'nyole', holdMinutes: 30, test: true, redirection: true });
  const e = await api('/api/sokoyetu/etat', { auth: true });
  assert.deepEqual(e.json.paiement, { fournisseur: 'nyole', pret: true, test: true });
});

test('commande : session nyole, page de paiement, confirmation par le statut', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie(t, '0991234567') });
  assert.equal(r.status, 200, r.texte);
  assert.equal(r.json.paiement.etat, 'pending');
  assert.equal(r.json.paiement.test, true);
  assert.match(r.json.paiement.url, /^http:\/\/127\.0\.0\.1:8098\/checkout\/cs\d+$/);
  // Le client ouvre la page nyole, puis revient sur la page de paiement de la boutique.
  const page = await fetch(r.json.paiement.url, { redirect: 'manual' });
  assert.equal(page.headers.get('location'), `${process.env.RETOUR || 'http://localhost:8091'}/paiement/${r.json.id}`);
  let p;
  for (let i = 0; i < 10; i++) { p = await api(`/api/sokoyetu/paiement/${r.json.id}?t=${t}`); if (p.json.paiement.etat === 'paid') break; await new Promise((ok) => setTimeout(ok, 3200)); }
  assert.equal(p.json.paiement.etat, 'paid');
  assert.equal(p.json.paiement.url, '');
  assert.match(p.json.order.payment.reference, /^NY/);
});

test('paiement refusé chez nyole, puis nouvelle page de paiement', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie(t, '0991230000') });
  let p;
  for (let i = 0; i < 10; i++) { p = await api(`/api/sokoyetu/paiement/${r.json.id}?t=${t}`); if (p.json.paiement.etat === 'failed') break; await new Promise((ok) => setTimeout(ok, 3200)); }
  assert.equal(p.json.paiement.etat, 'failed');
  assert.match(p.json.paiement.message, /refusé/);
  const b = await api(`/api/sokoyetu/paiement/${r.json.id}/relancer?t=${t}`, { method: 'POST', body: { method: 'mpesa', phone: '0991234567' } });
  assert.equal(b.status, 200, b.texte);
  assert.equal(b.json.paiement.tentatives, 2);
  assert.ok(b.json.paiement.url && b.json.paiement.url !== r.json.paiement.url);
});

test('webhook nyole : toujours 200, revérifié chez nyole', async () => {
  const n = await api('/api/sokoyetu/notification/nyole', { method: 'POST', body: { event: 'payment.completed', data: { id: 'INVENTE', status: 'SUCCESS', metadata: { order_id: 'ZZZZZZ' } } } });
  assert.equal(n.status, 200);
});
