// Tests d'intégration du serveur. Nécessite le serveur local, paiement en mode test (base vide) :
//   npm run build && SOKOYETU_SIMULATION_DELAI=1 DATA=.local/essai bash outils/serveur-local.sh
//   BASE=http://127.0.0.1:8090 node --test tests/serveur.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let jeton = '', technique = '';

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
  const t = await api('/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: 'technique@sokoyetu.test', password: 'Technique-2026' } });
  assert.equal(t.status, 200);
  technique = t.json.token;
});

test('préparation du catalogue de test', async () => {
  const cfg = { name: 'Sokoyetu', city: 'Bukavu', payments: { mpesa: { enabled: true }, airtel: { enabled: true }, orange: { enabled: false } }, freeShippingOver: 0 };
  assert.equal((await ecrire('config', 'store', cfg)).status, 200);
  assert.equal((await ecrire('collections', 'col-test', { name: 'Test', visible: true, order: 1 })).status, 200);
  assert.equal((await ecrire('products', 't-robe', { title: 'Robe d’essai', price: 20, cost: 8, status: 'active', source: 'local', collectionIds: ['col-test'], options: { colors: [{ name: 'Noir', hex: '#111111' }], sizes: ['M'] }, variants: { 'Noir|M': 3 }, sold: 0, images: [] })).status, 200);
  assert.equal((await ecrire('products', 't-montre', { title: 'Montre d’essai', price: 15, cost: 5, status: 'active', source: 'import', images: [] })).status, 200);
  assert.equal((await ecrire('products', 't-cache', { title: 'Brouillon', price: 9, status: 'draft', stock: 4 })).status, 200);
  assert.equal((await ecrire('discounts', 'd-test', { code: 'essai10', type: 'percent', value: 10, minSubtotal: 10, active: true })).status, 200);
});

test('catalogue public : brouillons et coûts cachés, cache validé, paiement en mode test', async () => {
  const r = await api('/api/sokoyetu/catalogue');
  assert.equal(r.status, 200);
  const ids = r.json.products.map((p) => p.id);
  assert.ok(ids.includes('t-robe') && !ids.includes('t-cache'));
  assert.equal(r.json.products.find((p) => p.id === 't-robe').cost, undefined);
  assert.deepEqual(r.json.config.payment, { provider: 'simulation', holdMinutes: 30, test: true });
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

test('devis : totaux, frais de service de 2 % et problèmes', async () => {
  const r = await api('/api/sokoyetu/devis', { method: 'POST', body: { items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 't-montre', qty: 1 }], zoneId: 'bukavu', discountCode: 'ESSAI10' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.sousTotal, r.json.remise.amount, r.json.livraison, r.json.frais, r.json.fraisPct, r.json.total, r.json.problemes.length], [55, 5.5, 2, 0.99, 2, 52.49, 0]);
  assert.equal(r.json.lignes[0].cost, undefined);
  const trop = await api('/api/sokoyetu/devis', { method: 'POST', body: { items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 9 }, { productId: 't-cache', qty: 1 }], zoneId: 'goma' } });
  assert.deepEqual(trop.json.problemes.map((p) => p.code), ['stock', 'article']);
});

let commandeId = '', commandeJeton = '', commandeNumero = '';
const saisie = (extra = {}) => ({
  token: commandeJeton, termsAccepted: true, customer: { name: 'Grâce Mapendo', phone: '099 123 4567' },
  shipping: { zoneId: 'bukavu', address: 'Nyawera, av. Lumumba 12' },
  items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 't-montre', qty: 1 }],
  discountCode: 'ESSAI10', payment: { method: 'mpesa', phone: '0991234567' }, total: 52.49, ...extra
});
const etatPaiement = (id, t) => api(`/api/sokoyetu/paiement/${id}?t=${t}`);
async function attendre(id, t, etat) {
  for (let i = 0; i < 40; i++) {
    const r = await etatPaiement(id, t);
    if (r.json && r.json.paiement && r.json.paiement.etat === etat) return r;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`Paiement jamais passé à « ${etat} »`);
}
const enregistrement = async (id) => (await api(`/api/collections/orders/records/${id}`, { auth: true })).json;

test('création directe de commande refusée (seule la route sécurisée crée des commandes)', async () => {
  const r = await api('/api/collections/orders/records', { method: 'POST', body: { doc: { total: 1 }, token: secret() } });
  assert.notEqual(r.status, 200);
});

test('commande : erreurs de saisie', async () => {
  commandeJeton = secret();
  const methode = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ payment: { method: 'cod' } }) });
  assert.equal(methode.status, 400);
  assert.match(methode.json.message, /mode de paiement/);
  assert.equal(methode.json.champ, 'method');
  const eteint = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ payment: { method: 'orange', phone: '0891234567' } }) });
  assert.equal(eteint.json.champ, 'method');
  const numero = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ payment: { method: 'mpesa', phone: '0123' } }) });
  assert.deepEqual([numero.status, numero.json.champ], [400, 'payphone']);
  const montant = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ total: 51.5 }) });
  assert.deepEqual([montant.status, montant.json.champ], [400, 'total']);
  assert.match(montant.json.message, /52[.,]49/);
  const rupture = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 4 }], discountCode: '', total: 83.6 }) });
  assert.deepEqual([rupture.status, rupture.json.champ], [400, 'panier']);
  assert.match(rupture.json.message, /Plus que 3 exemplaires/);
});

test('commande en attente du paiement, stock réservé, idempotente', async () => {
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie() });
  assert.equal(r.status, 200, r.texte);
  commandeId = r.json.id; commandeNumero = r.json.order.number;
  assert.match(commandeNumero, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.deepEqual([r.json.paiement.etat, r.json.paiement.tentatives, r.json.paiement.test], ['pending', 1, true]);
  assert.ok(r.json.paiement.expireA > Date.now() + 29 * 60000);
  assert.deepEqual([r.json.order.total, r.json.order.serviceFee, r.json.order.status], [52.49, 0.99, 'open']);
  assert.equal(r.json.order.items[0].cost, undefined);
  assert.equal(r.json.order.payment.providerId, undefined);
  assert.ok(r.json.order.delivery.at > Date.now());
  const robe = await produit('t-robe');
  assert.deepEqual([robe.variants['Noir|M'], robe.sold], [1, 2]);
  const bis = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie() });
  assert.equal(bis.json.id, commandeId);
  assert.equal((await produit('t-robe')).variants['Noir|M'], 1);
  const rec = await enregistrement(commandeId);
  assert.deepEqual([rec.number, rec.pay_status, rec.status], [commandeNumero, 'pending', 'open']);
});

test('paiement confirmé par le fournisseur : la commande est validée', async () => {
  assert.equal((await api(`/api/sokoyetu/paiement/${commandeId}`)).status, 404);
  assert.equal((await etatPaiement(commandeId, secret())).status, 404);
  const r = await attendre(commandeId, commandeJeton, 'paid');
  assert.match(r.json.order.payment.reference, /^TEST\d{8}$/);
  assert.equal(r.json.paiement.relance, false);
  const rec = await enregistrement(commandeId);
  assert.equal(rec.pay_status, 'paid');
  assert.match(rec.doc.timeline.map((e) => e.text).join(' | '), /Paiement M-Pesa confirmé/);
  const bis = await api(`/api/sokoyetu/paiement/${commandeId}/relancer?t=${commandeJeton}`, { method: 'POST', body: {} });
  assert.equal(bis.status, 400);
});

test('suivi client : lecture avec le jeton seulement, sans données internes', async () => {
  assert.equal((await api(`/api/collections/orders/records/${commandeId}`)).status, 404);
  const r = await api(`/api/collections/orders/records/${commandeId}?t=${commandeJeton}`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.token, r.json.pay_ref], [undefined, undefined]);
  assert.equal(r.json.doc.reserved, undefined);
  assert.equal(r.json.doc.items[0].cost, undefined);
  const admin = await enregistrement(commandeId);
  assert.equal(admin.doc.items[0].cost, 8);
});

test('commande retrouvée avec son numéro et le téléphone du client', async () => {
  const r = await api('/api/sokoyetu/retrouver', { method: 'POST', body: { numero: '#' + commandeNumero.toLowerCase(), telephone: '099-123-4567' } });
  assert.equal(r.status, 200, r.texte);
  assert.deepEqual([r.json.id, r.json.token], [commandeId, commandeJeton]);
  const autre = await api('/api/sokoyetu/retrouver', { method: 'POST', body: { numero: commandeNumero, telephone: '0977777777' } });
  assert.equal(autre.status, 404);
  assert.equal((await api('/api/sokoyetu/retrouver', { method: 'POST', body: { numero: '12', telephone: '' } })).status, 400);
});

test('paiement refusé sur le téléphone, puis relancé avec un autre numéro', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ token: t, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'airtel', phone: '0970000000' } }) });
  assert.equal(r.status, 200, r.texte);
  const echec = await attendre(r.json.id, t, 'failed');
  assert.match(echec.json.paiement.message, /Solde insuffisant/);
  assert.equal(echec.json.paiement.relance, true);
  assert.equal(echec.json.order.status, 'open');
  const mauvais = await api(`/api/sokoyetu/paiement/${r.json.id}/relancer?t=${t}`, { method: 'POST', body: { method: 'mpesa', phone: '12' } });
  assert.deepEqual([mauvais.status, mauvais.json.champ], [400, 'payphone']);
  const relance = await api(`/api/sokoyetu/paiement/${r.json.id}/relancer?t=${t}`, { method: 'POST', body: { method: 'mpesa', phone: '0991112233' } });
  assert.equal(relance.status, 200, relance.texte);
  assert.deepEqual([relance.json.paiement.etat, relance.json.paiement.tentatives, relance.json.order.payment.method], ['pending', 2, 'mpesa']);
  const tropTot = await api(`/api/sokoyetu/paiement/${r.json.id}/relancer?t=${t}`, { method: 'POST', body: {} });
  assert.equal(tropTot.status, 400);
  const paye = await attendre(r.json.id, t, 'paid');
  assert.deepEqual([paye.json.order.payment.phone, paye.json.order.payment.label], ['0991112233', 'M-Pesa']);
});

test('paiement jamais reçu : commande annulée à l’échéance, stock rendu', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ token: t, items: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 1 }], discountCode: '', total: 22.4, payment: { method: 'mpesa', phone: '0990000000' } }) });
  assert.equal(r.status, 200, r.texte);
  assert.equal((await produit('t-robe')).variants['Noir|M'], 0);
  // Les commandes ne se retouchent plus par l'API publique, même pour l'administration.
  assert.equal((await api(`/api/collections/orders/records/${r.json.id}`, { method: 'PATCH', auth: true, body: { doc: {} } })).status, 403);
  const rec = await enregistrement(r.json.id);
  const echu = { ...rec.doc, expiresAt: Date.now() - 1000 };
  const p = await api(`/api/collections/orders/records/${r.json.id}`, { method: 'PATCH', headers: { Authorization: technique }, body: { doc: echu } });
  assert.equal(p.status, 200, p.texte);
  assert.equal(p.json.expires, echu.expiresAt);
  const fin = await etatPaiement(r.json.id, t);
  assert.deepEqual([fin.json.order.status, fin.json.paiement.etat, fin.json.paiement.relance], ['cancelled', 'expired', false]);
  assert.equal((await produit('t-robe')).variants['Noir|M'], 1);
  assert.equal((await enregistrement(r.json.id)).pay_status, 'expired');
  const relance = await api(`/api/sokoyetu/paiement/${r.json.id}/relancer?t=${t}`, { method: 'POST', body: {} });
  assert.equal(relance.status, 400);
  const rouvrir = await api(`/api/sokoyetu/commandes/${r.json.id}`, { method: 'POST', auth: true, body: { action: 'reopen' } });
  assert.equal(rouvrir.status, 400);
});

test('notification du fournisseur jamais crue sur parole', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ token: t, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0990000000' } }) });
  const n = await api('/api/sokoyetu/notification/flexpay', { method: 'POST', body: { code: '0', reference: `${r.json.order.number}-1`, orderNumber: 'INVENTE', provider_reference: 'FAUX' } });
  assert.deepEqual([n.status, n.json.ok], [200, true]);
  assert.equal((await api('/api/sokoyetu/notification/inconnu', { method: 'POST', body: {} })).status, 200);
  assert.notEqual((await enregistrement(r.json.id)).pay_status, 'paid');
});

test('étapes de commande côté serveur, stock restitué à l’annulation', async () => {
  const etape = (action, extra = {}) => api(`/api/sokoyetu/commandes/${commandeId}`, { method: 'POST', auth: true, body: { action, ...extra } });
  assert.equal((await api(`/api/sokoyetu/commandes/${commandeId}`, { method: 'POST', body: { action: 'preparing' } })).status, 403);
  assert.equal((await etape('paid')).status, 400);
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

test('paiement confirmé à la main par la boutique (secours)', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ token: t, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0990000000' } }) });
  const m = await api(`/api/sokoyetu/commandes/${r.json.id}`, { method: 'POST', auth: true, body: { action: 'paid' } });
  assert.deepEqual([m.json.doc.payment.status, m.json.doc.payment.manual], ['paid', true]);
  assert.equal((await enregistrement(r.json.id)).pay_status, 'paid');
});

test('effacement des données d’un client', async () => {
  const r = await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0991234567' } });
  assert.equal(r.json.effacees, 5);
  const o = await enregistrement(commandeId);
  assert.deepEqual([o.doc.customer.name, o.doc.payment.phone], ['Client effacé', '']);
  assert.equal((await api('/api/sokoyetu/retrouver', { method: 'POST', body: { numero: commandeNumero, telephone: '0991234567' } })).status, 404);
});

test('assistant IA : réservé à l’administration, clé absente signalée', async () => {
  assert.equal((await api('/api/sokoyetu/ia/produit', { method: 'POST', body: {} })).status, 403);
  const r = await api('/api/sokoyetu/ia/produit', { method: 'POST', auth: true, body: { image: 'AAAA', mediaType: 'image/jpeg' } });
  assert.equal(r.json.code, process.env.ANTHROPIC_API_KEY ? r.json.code : 'no_key');
  const etat = await api('/api/sokoyetu/etat', { auth: true });
  assert.equal(typeof etat.json.version, 'string');
  assert.deepEqual(etat.json.paiement, { fournisseur: 'simulation', pret: true, test: true });
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
