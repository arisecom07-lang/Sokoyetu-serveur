// Tests d'intégration du serveur. Nécessite le serveur local : npm run build && bash outils/serveur-local.sh
//   BASE=http://127.0.0.1:8090 node --test tests/serveur.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let jeton = '';

async function api(chemin, { method = 'GET', body, auth = false, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth && jeton) h.Authorization = jeton;
  const r = await fetch(BASE + chemin, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const texte = await r.text();
  let json = null; try { json = JSON.parse(texte); } catch (e) { }
  return { status: r.status, json, texte, headers: r.headers };
}
const secret = () => Array.from({ length: 32 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 57)]).join('');
const ecrire = (col, id, doc) => api(`/api/collections/${col}/records/${id}`, { method: 'PATCH', auth: true, body: { doc } })
  .then((r) => (r.status === 404 ? api(`/api/collections/${col}/records`, { method: 'POST', auth: true, body: { id, doc } }) : r));
const produit = async (id) => (await api(`/api/collections/products/records/${id}`, { auth: true })).json.doc;

test('connexion administrateur', async () => {
  const r = await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' } });
  assert.equal(r.status, 200);
  jeton = r.json.token;
});

test('préparation du catalogue de test', async () => {
  const cfg = { name: 'Sokoyetu', city: 'Bukavu', payments: { mpesa: { enabled: true, number: '0991234567', accountName: 'Sokoyetu' }, airtel: { enabled: true, number: '' } }, freeShippingOver: 0 };
  assert.equal((await ecrire('config', 'store', cfg)).status, 200);
  assert.equal((await ecrire('collections', 'col-test', { name: 'Test', visible: true, order: 1 })).status, 200);
  assert.equal((await ecrire('products', 't-robe', { title: 'Robe d’essai', price: 20, cost: 8, status: 'active', source: 'local', collectionIds: ['col-test'], options: { colors: [{ name: 'Noir', hex: '#111111' }], sizes: ['M'] }, variants: { 'Noir|M': 3 }, sold: 0, images: [] })).status, 200);
  assert.equal((await ecrire('products', 't-montre', { title: 'Montre d’essai', price: 15, cost: 5, status: 'active', source: 'import', images: [] })).status, 200);
  assert.equal((await ecrire('products', 't-cache', { title: 'Brouillon', price: 9, status: 'draft', stock: 4 })).status, 200);
  assert.equal((await ecrire('discounts', 'd-test', { code: 'essai10', type: 'percent', value: 10, minSubtotal: 10, active: true })).status, 200);
});

test('catalogue public : brouillons et coûts cachés, cache validé', async () => {
  const r = await api('/api/sokoyetu/catalogue');
  assert.equal(r.status, 200);
  const ids = r.json.products.map((p) => p.id);
  assert.ok(ids.includes('t-robe') && !ids.includes('t-cache'));
  assert.equal(r.json.products.find((p) => p.id === 't-robe').cost, undefined);
  const etag = r.headers.get('etag');
  const r2 = await api('/api/sokoyetu/catalogue', { headers: { 'If-None-Match': etag } });
  assert.equal(r2.status, 304);
  const direct = await api('/api/collections/products/records/t-robe');
  assert.equal(direct.json.doc.cost, undefined);
  assert.equal((await api('/api/collections/discounts/records')).json.items.length, 0);
});

test('code promo vérifié par le serveur', async () => {
  assert.equal((await api('/api/sokoyetu/discount?code=ESSAI10&subtotal=5')).json.ok, false);
  const ok = (await api('/api/sokoyetu/discount?code=essai10&subtotal=20')).json;
  assert.deepEqual([ok.ok, ok.amount], [true, 2]);
});

test('devis : totaux et problèmes', async () => {
  const r = await api('/api/sokoyetu/devis', { method: 'POST', body: { items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 't-montre', qty: 1 }], zoneId: 'bukavu', discountCode: 'ESSAI10' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.sousTotal, r.json.remise.amount, r.json.livraison, r.json.total, r.json.problemes.length], [55, 5.5, 2, 51.5, 0]);
  assert.equal(r.json.lignes[0].cost, undefined);
  const trop = await api('/api/sokoyetu/devis', { method: 'POST', body: { items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 9 }, { productId: 't-cache', qty: 1 }], zoneId: 'goma' } });
  assert.deepEqual(trop.json.problemes.map((p) => p.code), ['stock', 'article']);
});

let commandeId = '', commandeJeton = '';
const saisie = (extra = {}) => ({
  token: commandeJeton, termsAccepted: true, customer: { name: 'Grâce Mapendo', phone: '099 123 4567' },
  shipping: { zoneId: 'bukavu', address: 'Nyawera, av. Lumumba 12' },
  items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 't-montre', qty: 1 }],
  discountCode: 'ESSAI10', payment: { method: 'mpesa', ref: 'pp231024.ab12' }, total: 51.5, ...extra
});

test('création directe de commande refusée (seule la route sécurisée crée des commandes)', async () => {
  const r = await api('/api/collections/orders/records', { method: 'POST', body: { doc: { total: 1 }, token: secret() } });
  assert.notEqual(r.status, 200);
});

test('commande : erreurs de saisie', async () => {
  commandeJeton = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ payment: { method: 'cod' } }) });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /mode de paiement/);
  assert.equal(r.json.champ, 'method');
});

test('commande enregistrée, stock réservé, idempotente', async () => {
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie() });
  assert.equal(r.status, 200, r.texte);
  commandeId = r.json.id;
  assert.equal(r.json.order.total, 51.5);
  assert.equal(r.json.order.review, false);
  assert.equal(r.json.order.items[0].cost, undefined);
  assert.equal(r.json.order.payment.ref, 'PP231024.AB12');
  const robe = await produit('t-robe');
  assert.deepEqual([robe.variants['Noir|M'], robe.sold], [1, 2]);
  const bis = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie() });
  assert.equal(bis.json.id, commandeId);
  assert.equal((await produit('t-robe')).variants['Noir|M'], 1);
});

test('suivi client : lecture avec le jeton seulement, sans données internes', async () => {
  assert.equal((await api(`/api/collections/orders/records/${commandeId}`)).status, 404);
  const r = await api(`/api/collections/orders/records/${commandeId}?t=${commandeJeton}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.token, undefined);
  assert.equal(r.json.doc.reserved, undefined);
  assert.equal(r.json.doc.items[0].cost, undefined);
  const admin = await api(`/api/collections/orders/records/${commandeId}`, { auth: true });
  assert.equal(admin.json.doc.items[0].cost, 8);
});

test('commande payée après rupture : enregistrée avec un point à vérifier', async () => {
  commandeJeton = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 3 }], discountCode: '', total: 62 }) });
  assert.equal(r.status, 200, r.texte);
  assert.equal(r.json.order.review, true);
  const admin = await api(`/api/collections/orders/records/${r.json.id}`, { auth: true });
  assert.match(admin.json.doc.issues[0], /Plus que 1 exemplaire/);
  assert.equal((await produit('t-robe')).variants['Noir|M'], 1);
});

test('étapes de commande côté serveur, stock restitué à l’annulation', async () => {
  const etape = (action, extra = {}) => api(`/api/sokoyetu/commandes/${commandeId}`, { method: 'POST', auth: true, body: { action, ...extra } });
  assert.equal((await api(`/api/sokoyetu/commandes/${commandeId}`, { method: 'POST', body: { action: 'paid' } })).status, 403);
  assert.equal((await etape('shipped')).status, 400);
  assert.equal((await etape('paid')).json.doc.payment.status, 'paid');
  assert.equal((await etape('preparing')).json.doc.fulfillment, 'preparing');
  assert.equal((await etape('note', { note: 'Appeler avant 10 h' })).json.doc.adminNote, 'Appeler avant 10 h');
  const annul = await etape('cancel');
  assert.equal(annul.json.doc.status, 'cancelled');
  const robe = await produit('t-robe');
  assert.deepEqual([robe.variants['Noir|M'], robe.sold], [3, 0]);
  assert.equal((await etape('refund')).json.doc.payment.status, 'refunded');
  assert.equal((await etape('reopen')).json.doc.status, 'open');
  assert.equal((await produit('t-robe')).variants['Noir|M'], 1);
  assert.equal((await etape('inconnue')).status, 400);
});

test('effacement des données d’un client', async () => {
  const r = await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0991234567' } });
  assert.equal(r.json.effacees, 2);
  const o = await api(`/api/collections/orders/records/${commandeId}`, { auth: true });
  assert.equal(o.json.doc.customer.name, 'Client effacé');
});

test('assistant IA : réservé à l’administration, clé absente signalée', async () => {
  assert.equal((await api('/api/sokoyetu/ia/produit', { method: 'POST', body: {} })).status, 403);
  const r = await api('/api/sokoyetu/ia/produit', { method: 'POST', auth: true, body: { image: 'AAAA', mediaType: 'image/jpeg' } });
  assert.equal(r.json.code, process.env.ANTHROPIC_API_KEY ? r.json.code : 'no_key');
  const etat = await api('/api/sokoyetu/etat', { auth: true });
  assert.equal(typeof etat.json.version, 'string');
});

test('pages partageables : aperçu WhatsApp d’un article, plan du site', async () => {
  const r = await api('/p/t-robe/robe-d-essai');
  assert.match(r.texte, /<title>Robe d’essai · \$20\.00 · Sokoyetu<\/title>/);
  assert.match(r.texte, /og:type" content="product"/);
  const absent = await api('/p/t-cache/brouillon');
  assert.match(absent.texte, /noindex/);
  const plan = await api('/sitemap.xml');
  assert.match(plan.texte, /\/p\/t-robe\/robe-d-essai/);
  assert.doesNotMatch(plan.texte, /t-cache/);
});

// fetch ignore l'en-tête Host : requête HTTP brute pour simuler admin.sokoyakwetu.com
const brut = (chemin, hote) => new Promise((ok, ko) => {
  const u = new URL(BASE + chemin);
  http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: hote } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => ok({ status: res.statusCode, texte: t, headers: res.headers })); }).on('error', ko);
});

test('administration servie sur son propre sous-domaine', async () => {
  const r = await brut('/', 'admin.localhost');
  assert.match(r.texte, /<title>Sokoyetu · Gestion<\/title>/);
  assert.match(r.texte, /noindex/);
  assert.match(r.headers['content-security-policy'] || '', /connect-src 'self';/);
  const ancien = await brut('/admin.html', 'sokoyakwetu.com');
  assert.equal(ancien.status, 302);
  assert.equal(ancien.headers.location, 'http://admin.sokoyakwetu.com/');
  const www = await brut('/panier', 'www.sokoyakwetu.com');
  assert.equal(www.status, 301);
  const b = await api('/');
  assert.doesNotMatch(b.texte, /Gestion/);
  assert.match(b.headers.get('content-security-policy') || '', /default-src 'self'/);
});
