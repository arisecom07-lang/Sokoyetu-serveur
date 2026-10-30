// Tests d'intégration du serveur. Nécessite le serveur local, paiement en mode test (base vide) :
//   npm run build && SOKOYETU_SIMULATION_DELAI=1 DATA=.local/essai bash outils/serveur-local.sh   (codes WhatsApp et SMS en mode test)
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

let compteJeton = '', compteId = '';
let doublon = null;
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('double appui sur « Payer » : une seule commande, stock réservé une seule fois', async () => {
  const t = secret();
  const avant = (await produit('t-montre')).sold;
  const corps = saisie({ token: t, customer: { name: 'Client Doublon', phone: '0812345678' }, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0812345678' } });
  const rs = await Promise.all([1, 2, 3].map(() => api('/api/sokoyetu/commander', { method: 'POST', body: corps })));
  rs.forEach((r) => assert.equal(r.status, 200, r.texte));
  assert.equal(new Set(rs.map((r) => r.json.id)).size, 1, 'une seule commande pour trois envois simultanés');
  assert.equal((await produit('t-montre')).sold, avant + 1);
  const liste = await api(`/api/collections/orders/records?filter=${encodeURIComponent(`token="${t}"`)}`, { auth: true });
  assert.equal(liste.json.totalItems, 1);
  doublon = { id: rs[0].json.id, t, numero: rs[0].json.order.number };
});

test('paiement reçu deux fois pour la même commande : signalé à rembourser, puis noté remboursé', async () => {
  const { id, t, numero } = doublon;
  await attendre(id, t, 'paid');
  const notifier = () => api('/api/sokoyetu/notification/simulation', { method: 'POST', body: { orderNumber: `SIM-${numero}-9`, reference: `${numero}-9` } });
  assert.equal((await notifier()).status, 200);
  const rec = await enregistrement(id);
  assert.equal(rec.doc.payment.duplicates.length, 1);
  assert.match(rec.doc.issues.join(' '), /Paiement reçu deux fois/);
  assert.match(rec.doc.timeline.map((e) => e.text).join(' | '), /à rembourser/);
  await notifier();
  assert.equal((await enregistrement(id)).doc.payment.duplicates.length, 1, 'la même notification ne compte qu’une fois');
  const client = await etatPaiement(id, t);
  assert.deepEqual([client.json.order.payment.duplicates, client.json.order.payment.previous, client.json.order.issues], [undefined, undefined, undefined]);
  const r = await api(`/api/sokoyetu/commandes/${id}`, { method: 'POST', auth: true, body: { action: 'doublon' } });
  assert.equal(r.status, 200, r.texte);
  assert.ok(r.json.doc.payment.duplicatesRefundedAt > 0);
  assert.doesNotMatch((r.json.doc.issues || []).join(' '), /deux fois/);
  assert.equal((await api(`/api/sokoyetu/commandes/${id}`, { method: 'POST', auth: true, body: { action: 'doublon' } })).status, 400);
});

test('nouvelle demande de paiement : une seule à la fois, même avec deux appuis', async () => {
  const t = secret();
  const r = await api('/api/sokoyetu/commander', { method: 'POST', body: saisie({ token: t, customer: { name: 'Client Relance', phone: '0812345679' }, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'airtel', phone: '0970000000' } }) });
  assert.equal(r.status, 200, r.texte);
  await attendre(r.json.id, t, 'failed');
  const rs = await Promise.all([1, 2].map(() => api(`/api/sokoyetu/paiement/${r.json.id}/relancer?t=${t}`, { method: 'POST', body: { method: 'mpesa', phone: '0991112233' } })));
  const statuts = rs.map((x) => x.status);
  assert.equal(statuts.filter((x) => x === 200).length, 1, statuts.join(', '));
  assert.ok(statuts.every((x) => [200, 400, 409].includes(x)), statuts.join(', '));
  assert.equal((await etatPaiement(r.json.id, t)).json.paiement.tentatives, 2, 'une seule nouvelle demande envoyée');
});

test('surveillance : état du serveur, erreurs des navigateurs gardées au journal', async () => {
  const s = await api('/api/sokoyetu/sante');
  assert.deepEqual([s.status, s.json.ok, s.json.details], [200, true, undefined]);
  assert.equal(s.headers.get('cache-control'), 'no-store');
  const d = await api('/api/sokoyetu/sante', { auth: true });
  assert.ok(Array.isArray(d.json.details.problemes) && d.json.details.erreurs.jour >= 0);
  const marque = 'essai-' + secret().slice(0, 8);
  assert.equal((await api('/api/sokoyetu/erreur', { method: 'POST', body: { app: 'boutique', genre: 'erreur', message: 'TypeError ' + marque, page: '/suivi/abc?t=SECRET123', pile: 'at x (/assets/b.js:1:2)', version: '2.3.0' } })).status, 204);
  assert.equal((await api('/api/sokoyetu/erreur', { method: 'POST', body: { message: 'ResizeObserver loop completed with undelivered notifications.' } })).status, 204);
  assert.equal((await api('/api/sokoyetu/journal')).status, 403);
  // Le journal du serveur est écrit par lots, environ 3 secondes après la dernière entrée.
  let trouve = null, dernier = null;
  for (let i = 0; i < 6 && !trouve; i++) { await pause(3500); dernier = await api('/api/sokoyetu/journal?jours=1', { auth: true }); trouve = ((dernier.json && dernier.json.erreurs) || []).find((x) => x.message.includes(marque)); }
  assert.ok(trouve, 'erreur du navigateur visible dans le journal : ' + dernier.status + ' ' + dernier.texte.slice(0, 300));
  assert.deepEqual([trouve.details.page, trouve.details.app, trouve.niveau], ['/suivi/abc', 'boutique', 'alerte']);
  const journal = (await api('/api/sokoyetu/journal?jours=1', { auth: true })).json.erreurs;
  assert.ok(!journal.some((x) => /ResizeObserver/.test(x.message)), 'bruit des navigateurs ignoré');
});

test('limites : requête trop lourde refusée, photo de plus de 10 Mo refusée', async () => {
  const gros = await api('/api/sokoyetu/retrouver', { method: 'POST', body: { numero: 'x'.repeat(20000), telephone: '' } });
  assert.equal(gros.status, 413);
  const { readFile } = await import('node:fs/promises');
  const photo = await readFile(new URL('../medias/photos/' + (await import('node:fs')).readdirSync(new URL('../medias/photos/', import.meta.url)).find((f) => /\.webp$/.test(f)), import.meta.url));
  const fd = new FormData();
  fd.append('file', new Blob([photo, new Uint8Array(11 * 1048576)], { type: 'image/webp' }), 'tres-grande.webp');
  const r = await fetch(BASE + '/api/collections/media/records', { method: 'POST', headers: { Authorization: jeton }, body: fd });
  const j = await r.json();
  assert.equal(r.status, 400);
  assert.match(j.message, /trop lourde/);
  const fd2 = new FormData(); fd2.append('file', new Blob([photo], { type: 'image/webp' }), 'normale.webp');
  const ok = await fetch(BASE + '/api/collections/media/records', { method: 'POST', headers: { Authorization: jeton }, body: fd2 });
  assert.equal(ok.status, 200);
});

test('compte client : code sur WhatsApp ou par SMS (mode test), connexion, panier et favoris gardés, commandes retrouvées', async () => {
  const cat = await api('/api/sokoyetu/catalogue');
  assert.deepEqual(cat.json.config.accounts, { open: true, test: true, channels: ['whatsapp', 'sms'] });
  assert.equal((await api('/api/sokoyetu/compte/code', { method: 'POST', body: { telephone: '12' } })).json.champ, 'telephone');
  const c = await api('/api/sokoyetu/compte/code', { method: 'POST', body: { telephone: '099 123 4567' } });
  assert.equal(c.status, 200, c.texte);
  assert.match(c.json.code, /^\d{6}$/);
  assert.deepEqual([c.json.telephone, c.json.canal, c.json.renvoi, c.json.test], ['0991234567', 'whatsapp', 60, true]);
  const bis = await api('/api/sokoyetu/compte/code', { method: 'POST', body: { telephone: '0991234567', canal: 'sms' } });
  assert.deepEqual([bis.json.deja, bis.json.code, bis.json.canal], [true, undefined, 'sms']);
  // Code de secours par SMS (WhatsApp absent du téléphone) : un autre numéro, tout de suite.
  const sms = await api('/api/sokoyetu/compte/code', { method: 'POST', body: { telephone: '0821234567', canal: 'sms' } });
  assert.deepEqual([sms.json.canal, sms.json.canaux], ['sms', ['whatsapp', 'sms']]);
  const faux = await api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone: '0991234567', code: c.json.code === '000000' ? '111111' : '000000' } });
  assert.deepEqual([faux.status, faux.json.champ], [400, 'code']);
  assert.match(faux.json.message, /Encore 4 essais/);
  const r = await api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone: '+243 99 123 4567', code: c.json.code, name: 'Grâce Mapendo', panier: [{ productId: 't-montre', qty: 1 }], favoris: ['t-robe'], profil: { zoneId: 'bukavu' } } });
  assert.equal(r.status, 200, r.texte);
  compteJeton = r.json.token; compteId = r.json.record.id;
  assert.deepEqual([r.json.meta.compte.name, r.json.meta.compte.phone, r.json.meta.compte.doc.favoris, r.json.meta.compte.doc.profil.zoneId], ['Grâce Mapendo', '0991234567', ['t-robe'], 'bukavu']);
  assert.ok(r.json.meta.compte.doc.dates['panier:t-montre'] > 0);
  // Commandes passées sans compte avec le même téléphone : elles rejoignent le compte (le SMS prouve que c'est bien lui).
  assert.ok(r.json.meta.commandes.some((x) => x.id === commandeId && x.t === commandeJeton));
  const reutilise = await api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone: '0991234567', code: c.json.code } });
  assert.deepEqual([reutilise.status, reutilise.json.expire], [400, true]);

  const moi = { Authorization: compteJeton };
  assert.equal((await api('/api/sokoyetu/compte')).status, 401);
  const lu = await api('/api/sokoyetu/compte', { headers: moi });
  assert.equal(lu.json.compte.id, compteId);
  const maj = await api('/api/sokoyetu/compte', { method: 'POST', headers: moi, body: { panier: [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 30 }, { productId: '../x', qty: 1 }], favoris: ['t-robe', 't-robe', 't-montre'] } });
  assert.deepEqual(maj.json.compte.doc.panier, [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 20 }]);
  assert.deepEqual(maj.json.compte.doc.favoris, ['t-robe', 't-montre']);
  assert.equal(maj.json.compte.doc.dates['panier:t-montre'], undefined);
  // Le jeton d'un client n'ouvre rien de l'administration ; l'administration voit les comptes.
  assert.equal((await api('/api/collections/clients/records', { headers: moi })).json.items.length, 0);
  assert.equal((await api('/api/sokoyetu/audience', { headers: moi })).status, 403);
  assert.equal((await api('/api/collections/orders/records', { headers: moi })).json.items.length, 0);
  const vus = await api('/api/collections/clients/records', { auth: true });
  assert.deepEqual(vus.json.items.map((x) => x.phone), ['0991234567']);
  assert.equal((await api('/api/collections/clients/auth-with-password', { method: 'POST', body: { identity: 'x@y.cd', password: 'abcdefghij' } })).status, 403);

  // Commande passée connecté (autre téléphone de contact) : rattachée au compte.
  const t = secret();
  const o = await api('/api/sokoyetu/commander', { method: 'POST', headers: moi, body: saisie({ token: t, customer: { name: 'Grâce Mapendo', phone: '0977777777' }, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0977777777' } }) });
  assert.equal(o.status, 200, o.texte);
  assert.equal((await enregistrement(o.json.id)).client, compteId);
  assert.ok((await api('/api/sokoyetu/compte', { headers: moi })).json.commandes.some((x) => x.id === o.json.id && x.t === t));
  const renouvele = await api('/api/collections/clients/auth-refresh', { method: 'POST', headers: moi });
  assert.equal(renouvele.status, 200);
});

test('effacement des données d’un client', async () => {
  const r = await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0991234567' } });
  assert.equal(r.json.effacees, 5);
  assert.equal(r.json.comptes, 1);
  assert.equal((await api('/api/sokoyetu/compte', { headers: { Authorization: compteJeton } })).status, 401);
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
  assert.deepEqual(etat.json.paiement, { fournisseur: 'simulation', pret: true, test: true, panne: 0 });
  assert.equal(etat.json.iaQuota.max > 0, true);
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

test('liens partagés : image d’aperçu avec le logo, panier partagé, rien de plus dans le catalogue public', async () => {
  const meta = (html, p) => ((new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`)).exec(html) || [])[1];
  // L'administration envoie l'image d'aperçu comme une photo, puis la note sur l'article.
  const { readFile } = await import('node:fs/promises');
  const fd = new FormData();
  fd.append('file', new Blob([await readFile(new URL('../medias/photos/p03-1-s.webp', import.meta.url))], { type: 'image/webp' }), 'carte.webp');
  const m = await (await fetch(BASE + '/api/collections/media/records', { method: 'POST', headers: { Authorization: jeton }, body: fd })).json();
  const robe = await produit('t-robe');
  // Stock connu (les commandes des essais précédents en ont pris) : 5 robes noires en M.
  assert.equal((await ecrire('products', 't-robe', { ...robe, variants: { ...robe.variants, 'Noir|M': 5 }, share: { type: 'pb', id: m.id, f: m.file, w: 1200, h: 630, sig: 'essai' } })).status, 200);
  const page = (await api('/p/t-robe/robe-d-essai')).texte;
  assert.ok(meta(page, 'og:image').endsWith(`/api/files/media/${m.id}/${m.file}`));
  assert.deepEqual([meta(page, 'og:image:width'), meta(page, 'og:image:height')], ['1200', '630']);
  assert.equal((page.match(/og:image:width/g) || []).length, 1, 'une seule taille d’image annoncée');
  // L'image d'aperçu reste côté serveur : ni dans le catalogue ni dans la lecture publique de l'article.
  assert.equal((await api('/api/sokoyetu/catalogue')).json.products.find((p) => p.id === 't-robe').share, undefined);
  assert.equal((await api('/api/collections/products/records/t-robe')).json.doc.share, undefined);

  // Panier partagé : articles disponibles et total estimé du jour (2 × $20 + $15, frais de service 2 %) ; brouillon et article
  // inconnu écartés ; quantité ramenée au stock ; jamais référencé.
  const r = await api('/panier/partage?a=t-robe:2:Noir:M&a=t-montre&a=t-cache&a=inconnu');
  assert.equal(r.status, 200);
  assert.equal(meta(r.texte, 'og:title'), 'Panier partagé · 3 articles · $56.10');
  assert.match(meta(await api('/panier/partage?a=t-robe:9:Noir:M').then((x) => x.texte), 'og:title'), /^Panier partagé · 5 articles · /);
  assert.match(meta(r.texte, 'og:description'), /^Robe d’essai ×2, Montre d’essai\. Livraison à Bukavu et Goma, paiement Mobile Money\.$/);
  assert.ok(meta(r.texte, 'og:image').endsWith(`/api/files/media/${m.id}/${m.file}`), 'image du premier article');
  assert.equal(meta(r.texte, 'robots'), 'noindex');
  assert.match(meta(r.texte, 'og:url'), /\/panier\/partage\?a=t-robe:2:Noir:M&amp;a=t-montre/);
  assert.match(r.texte, /<div id="app">/, 'la boutique s’ouvre sur la page du panier partagé');
  const vide = await api('/panier/partage?a=inconnu&a=t-cache');
  assert.match(meta(vide.texte, 'og:image'), /\/og-image\.png$/);
  assert.equal(meta(vide.texte, 'robots'), 'noindex');
  assert.equal((await api('/panier/partage')).status, 200);
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

test('audience : visites anonymes comptées, robots ignorés, chiffres réservés à l’administration', async () => {
  const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile' };
  const v1 = 'essai' + Date.now().toString(36) + 'aaaaaaaa', v2 = 'essai' + Date.now().toString(36) + 'bbbbbbbb';
  assert.equal((await api('/api/sokoyetu/visite', { method: 'POST', headers: UA, body: { v: v1, p: 'art-audience', a: 'vue', panier: ['art-audience'], favoris: [] } })).status, 204);
  await api('/api/sokoyetu/visite', { method: 'POST', headers: UA, body: { v: v2, p: 'art-audience', a: 'favori', panier: [], favoris: ['art-audience'] } });
  await api('/api/sokoyetu/visite', { method: 'POST', headers: { 'User-Agent': 'Googlebot/2.1' }, body: { v: 'robotrobotrobotrobot', p: 'art-audience', a: 'vue' } });
  await api('/api/sokoyetu/visite', { method: 'POST', headers: UA, body: { v: 'court', p: 'art-audience', a: 'vue' } });
  assert.equal((await api('/api/sokoyetu/audience')).status, 403);
  const r = await api('/api/sokoyetu/audience?jours=1&graphe=7', { auth: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.jours.length, 7);
  assert.ok(r.json.enLigne >= 2);
  const a = r.json.produits.find((x) => x.id === 'art-audience');
  assert.deepEqual([a.vues, a.visiteurs, a.paniers, a.favoris, a.dansPaniers, a.dansFavoris, a.enLigne], [1, 1, 0, 1, 1, 1, 2]);
  // Article retiré du panier : il n'y est plus compté.
  await api('/api/sokoyetu/visite', { method: 'POST', headers: UA, body: { v: v1, panier: [] } });
  const d = await api('/api/sokoyetu/audience/art-audience?jours=7', { auth: true });
  assert.equal(d.json.dansPaniers, 0);
  assert.equal(d.json.total.vues, 1);
});

test('recherches : comptées par appareil, populaires dès deux appareils, sans résultat pour la boutique, numéros jamais gardés', async () => {
  const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile' };
  const v1 = 'cherche' + Date.now().toString(36) + 'aaaaaaaa', v2 = 'cherche' + Date.now().toString(36) + 'bbbbbbbb';
  const chercher = (v, q, n) => api('/api/sokoyetu/visite', { method: 'POST', headers: UA, body: { v, p: '', a: 'recherche', q, n } });
  assert.equal((await chercher(v1, 'Montre Connectée', 3)).status, 204);
  await chercher(v1, 'montre connectee', 3); // le même appareil le même jour : compté une fois
  assert.ok(!(await api('/api/sokoyetu/recherches')).json.termes.includes('montre connectee'), 'un seul appareil : pas encore populaire');
  await chercher(v2, 'montre connectée', 2);
  await chercher(v1, 'tablette pliante', 0); await chercher(v2, 'Tablette  pliante', 0);
  await chercher(v1, '0991234567', 0); await chercher(v2, 'x', 1);
  await api('/api/sokoyetu/visite', { method: 'POST', headers: { 'User-Agent': 'Googlebot/2.1' }, body: { v: 'robotrobotrobotrobot', a: 'recherche', q: 'robot', n: 1 } });
  const pop = await api('/api/sokoyetu/recherches');
  assert.equal(pop.status, 200);
  assert.match(pop.headers.get('cache-control') || '', /max-age=3600/);
  assert.ok(pop.json.termes.includes('montre connectee'));
  assert.ok(!pop.json.termes.includes('tablette pliante'), 'une recherche sans résultat n’est jamais proposée');
  // Pour la boutique : ce qui est cherché, tel que tapé, et ce qui ne trouve rien.
  const r = (await api('/api/sokoyetu/audience?jours=1', { auth: true })).json.recherches;
  const montre = r.trouvees.find((x) => x.terme === 'montre connectee');
  assert.deepEqual([montre.visiteurs, montre.texte, montre.resultats], [2, 'montre connectée', 2]);
  assert.equal(r.sansResultat.find((x) => x.terme === 'tablette pliante').visiteurs, 2);
  assert.ok(![...r.trouvees, ...r.sansResultat].some((x) => /[0-9]{7}/.test(x.terme) || x.terme === 'x' || x.terme === 'robot'));
  assert.ok(r.visiteurs >= 2);
});
