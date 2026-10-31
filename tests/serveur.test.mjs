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
/* Commande de test : la limite de 20 commandes par minute peut répondre 429 en fin de série, on patiente alors. */
async function commander(corps, headers = {}) {
  for (let i = 0; ; i++) {
    const r = await api('/api/sokoyetu/commander', { method: 'POST', headers, body: corps });
    if (r.status !== 429 || i === 15) return r;
    await pause(5000);
  }
}

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

test('paiement par carte (mode test) : page sécurisée, carte refusée puis acceptée, passage au Mobile Money', async () => {
  const cfg0 = (await api('/api/collections/config/records/store', { auth: true })).json.doc;
  const montre = { items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3 };
  const ferme = await commander(saisie({ token: secret(), ...montre, payment: { method: 'carte', phone: '' } }));
  assert.deepEqual([ferme.status, ferme.json.champ], [400, 'method'], 'carte fermée tant que la boutique ne l’a pas ouverte');
  assert.equal((await ecrire('config', 'store', { ...cfg0, payments: { ...cfg0.payments, carte: { enabled: true } } })).status, 200);
  const carteTest = (id, t, issue) => api(`/api/sokoyetu/paiement/${id}/carte-test?t=${t}`, { method: 'POST', body: { issue } });
  const relancer = (id, t, corps) => api(`/api/sokoyetu/paiement/${id}/relancer?t=${t}`, { method: 'POST', body: corps });

  // Aucun numéro à débiter : le client part sur la page sécurisée (ici, la page de test de la boutique).
  const t = secret();
  const r = await commander(saisie({ token: t, customer: { name: 'Client Carte', phone: '0812345680' }, ...montre, payment: { method: 'carte', phone: '' } }));
  assert.equal(r.status, 200, r.texte);
  const id = r.json.id;
  assert.deepEqual([r.json.paiement.etat, r.json.paiement.url, r.json.order.payment.method, r.json.order.payment.phone, r.json.order.payment.label], ['pending', `/paiement/${id}/carte-test`, 'carte', '', 'Carte bancaire']);
  await pause(1500);
  assert.equal((await etatPaiement(id, t)).json.paiement.etat, 'pending', 'rien n’est payé tant que la carte n’est pas passée');
  assert.equal((await carteTest(id, secret(), 'ok')).status, 404);
  assert.equal((await carteTest(id, t, 'peut-etre')).status, 400);

  const refus = await carteTest(id, t, 'refus');
  assert.equal(refus.status, 200, refus.texte);
  assert.deepEqual([refus.json.paiement.etat, refus.json.paiement.relance, refus.json.paiement.url], ['failed', true, '']);
  assert.match(refus.json.paiement.message, /Carte refusée/);
  // Retour de la page sécurisée : nouvel essai par carte sans attendre.
  const bis = await relancer(id, t, { method: 'carte' });
  assert.equal(bis.status, 200, bis.texte);
  assert.deepEqual([bis.json.paiement.etat, bis.json.paiement.tentatives, bis.json.paiement.url], ['pending', 2, `/paiement/${id}/carte-test`]);
  const annule = await carteTest(id, t, 'annule');
  assert.match(annule.json.paiement.message, /annulé/);
  // Puis le Mobile Money : le numéro est demandé de nouveau, la page de test ne sert plus.
  assert.deepEqual([(await relancer(id, t, { method: 'mpesa' })).json.champ, (await relancer(id, t, { method: 'mpesa', phone: '12' })).json.champ], ['payphone', 'payphone']);
  const mm = await relancer(id, t, { method: 'mpesa', phone: '0991112233' });
  assert.deepEqual([mm.status, mm.json.order.payment.method, mm.json.order.payment.phone, mm.json.paiement.url], [200, 'mpesa', '0991112233', '']);
  assert.equal((await carteTest(id, t, 'ok')).status, 404);
  assert.equal((await attendre(id, t, 'paid')).json.order.payment.label, 'M-Pesa');

  // Carte acceptée du premier coup.
  const t2 = secret();
  const o = await commander(saisie({ token: t2, customer: { name: 'Client Carte', phone: '0812345680' }, ...montre, payment: { method: 'carte', phone: '' } }));
  assert.equal(o.status, 200, o.texte);
  const ok = await carteTest(o.json.id, t2, 'ok');
  assert.deepEqual([ok.json.paiement.etat, ok.json.paiement.url, ok.json.paiement.relance], ['paid', '', false], ok.texte);
  assert.match(ok.json.order.payment.reference, /^TEST\d{8}$/);
  const rec = await enregistrement(o.json.id);
  assert.equal(rec.pay_status, 'paid');
  assert.match(rec.doc.timeline.map((e) => e.text).join(' | '), /carte bancaire ouvert sur la page sécurisée.*Paiement par carte bancaire confirmé/);
  assert.equal(rec.doc.payment.url, undefined);
  assert.equal((await carteTest(o.json.id, t2, 'refus')).json.paiement.etat, 'paid', 'une carte payée ne se refuse plus');
  assert.equal((await ecrire('config', 'store', cfg0)).status, 200);
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
  // Attaque : 8 codes faux envoyés au même instant. Jamais plus de 5 essais comptés ; le bon code est ensuite refusé.
  const faux8 = Array.from({ length: 8 }, (_, i) => String((Number(sms.json.code) + 1 + i) % 1e6).padStart(6, '0'));
  const rafale = await Promise.all(faux8.map((code) => api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone: '0821234567', code } })));
  assert.ok(rafale.every((x) => x.status === 400), rafale.map((x) => x.status).join(','));
  assert.ok(rafale.filter((x) => /Code incorrect/.test(x.json.message)).length <= 5, rafale.map((x) => x.json.message).join(' | '));
  const apresRafale = await api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone: '0821234567', code: sms.json.code } });
  assert.deepEqual([apresRafale.status, apresRafale.json.expire], [400, true], 'le bon code ne passe plus après 5 essais');
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
  assert.equal((await api(`/api/collections/orders/records/${o.json.id}?t=${t}`, { headers: moi })).status, 200, 'suivi de commande lu connecté au compte');
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

test('équipe : vendeur et livreur ajoutés par le propriétaire, chacun limité à son rôle', async () => {
  const equipe = (chemin = '', opts = {}) => api('/api/sokoyetu/equipe' + chemin, { auth: true, ...opts });
  // Connexions rapprochées : la limite de 5 essais en 15 secondes peut répondre 429, on patiente alors un peu.
  const connexion = async (email, password) => {
    for (let i = 0; ; i++) {
      const r = await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: email, password } });
      if (r.status !== 429 || i === 8) return r;
      await pause(2000);
    }
  };
  assert.equal((await api('/api/sokoyetu/equipe')).status, 403);
  const avant = (await equipe()).json.membres;
  assert.deepEqual(avant.map((m) => [m.email, m.role]), [['admin@sokoyetu.test', 'proprietaire']]);
  assert.equal((await equipe('', { method: 'POST', body: { name: 'Patrick Mulumba', email: 'livreur@sokoyetu.test', role: 'chef' } })).status, 400);
  const l = await equipe('', { method: 'POST', body: { name: 'Patrick Mulumba', email: 'Livreur@Sokoyetu.test', role: 'livreur' } });
  assert.equal(l.status, 200, l.texte);
  assert.deepEqual([l.json.membre.email, l.json.membre.role], ['livreur@sokoyetu.test', 'livreur']);
  assert.match(l.json.motDePasse, /^[A-Z]{4}-[a-z]{4}-[2-9]{4}$/);
  assert.equal((await equipe('', { method: 'POST', body: { name: 'Doublon', email: 'livreur@sokoyetu.test', role: 'vendeur' } })).status, 400);
  const v = await equipe('', { method: 'POST', body: { name: 'Neema Furaha', email: 'vendeur@sokoyetu.test', role: 'vendeur' } });
  assert.equal(v.status, 200, v.texte);

  // Trois commandes : payée à livrer, payée à retirer en boutique, paiement refusé.
  const nouvelle = async (extra = {}) => {
    const t = secret();
    const r = await commander(saisie({ token: t, customer: { name: 'Client Équipe', phone: '0851112233' }, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0851112233' }, ...extra }));
    assert.equal(r.status, 200, r.texte);
    return { id: r.json.id, t };
  };
  const aLivrer = await nouvelle();
  const aRetirer = await nouvelle({ shipping: { zoneId: 'retrait' }, total: 15.3 });
  const refusee = await nouvelle({ payment: { method: 'mpesa', phone: '0850000000' } });
  await attendre(aLivrer.id, aLivrer.t, 'paid'); await attendre(aRetirer.id, aRetirer.t, 'paid'); await attendre(refusee.id, refusee.t, 'failed');
  assert.equal((await api(`/api/sokoyetu/commandes/${aLivrer.id}`, { method: 'POST', auth: true, body: { action: 'note', note: 'Sonner deux fois' } })).status, 200);

  const cl = await connexion('livreur@sokoyetu.test', l.json.motDePasse);
  assert.deepEqual([cl.status, cl.json.record.role], [200, 'livreur']);
  const livreur = { Authorization: cl.json.token };
  // Le livreur : seulement les commandes payées à livrer, sans coûts ni jeton, avec la consigne de la boutique.
  const vues = await api('/api/collections/orders/records?perPage=500', { headers: livreur });
  assert.equal(vues.status, 200, vues.texte);
  const ids = vues.json.items.map((x) => x.id);
  assert.ok(ids.includes(aLivrer.id));
  assert.ok(!ids.includes(aRetirer.id) && !ids.includes(refusee.id), 'ni retrait en boutique, ni commande impayée');
  const vue = vues.json.items.find((x) => x.id === aLivrer.id);
  assert.deepEqual([vue.doc.items[0].cost, vue.doc.adminNote, vue.token, vue.doc.customer.phone], [undefined, 'Sonner deux fois', undefined, '0851112233']);
  assert.equal((await api(`/api/collections/orders/records/${refusee.id}`, { headers: livreur })).status, 404);
  const etape = (id, action) => api(`/api/sokoyetu/commandes/${id}`, { method: 'POST', headers: livreur, body: { action } });
  assert.equal((await etape(aLivrer.id, 'cancel')).status, 403);
  assert.equal((await etape(aLivrer.id, 'refund')).status, 403);
  assert.equal((await etape(aRetirer.id, 'shipped')).status, 404);
  const route = await etape(aLivrer.id, 'shipped');
  assert.deepEqual([route.status, route.json.doc.fulfillment, route.json.doc.items[0].cost], [200, 'shipped', undefined]);
  assert.equal((await etape(aLivrer.id, 'delivered')).json.doc.fulfillment, 'delivered');
  assert.equal((await enregistrement(aLivrer.id)).etape, 'delivered');
  // Rien d'autre : réglages, produits, réductions, comptes clients, chiffres, équipe.
  assert.notEqual((await api('/api/collections/config/records/store', { method: 'PATCH', headers: livreur, body: { doc: { name: 'Piraté' } } })).status, 200);
  assert.notEqual((await api('/api/collections/products/records/t-montre', { method: 'PATCH', headers: livreur, body: { doc: { title: 'Piraté' } } })).status, 200);
  assert.equal((await api('/api/collections/products/records/t-montre', { headers: livreur })).json.doc.cost, undefined);
  assert.equal((await api('/api/collections/discounts/records', { headers: livreur })).json.items.length, 0);
  assert.equal((await api('/api/collections/clients/records', { headers: livreur })).json.items.length, 0);
  assert.equal((await api('/api/sokoyetu/audience', { headers: livreur })).status, 403);
  assert.equal((await api('/api/sokoyetu/journal', { headers: livreur })).status, 403);
  assert.equal((await api('/api/sokoyetu/equipe', { headers: livreur })).status, 403);

  // Le vendeur : catalogue, commandes, clients et audience ; ni réglages, ni réductions, ni remboursements, ni équipe.
  const cv = await connexion('vendeur@sokoyetu.test', v.json.motDePasse);
  assert.deepEqual([cv.status, cv.json.record.role], [200, 'vendeur']);
  const vendeur = { Authorization: cv.json.token };
  const montre = (await api('/api/collections/products/records/t-montre', { headers: vendeur })).json.doc;
  assert.equal(montre.cost, 5);
  const p = await api('/api/collections/products/records/t-montre', { method: 'PATCH', headers: vendeur, body: { doc: { ...montre, title: 'Montre du vendeur' } } });
  assert.equal(p.status, 200, p.texte);
  assert.equal((await ecrire('products', 't-montre', { ...montre, title: 'Montre d’essai' })).status, 200);
  assert.notEqual((await api('/api/collections/config/records/store', { method: 'PATCH', headers: vendeur, body: { doc: { name: 'Piraté' } } })).status, 200);
  assert.equal((await api('/api/collections/config/records/store')).json.doc.name, 'Sokoyetu');
  assert.equal((await api('/api/collections/discounts/records', { headers: vendeur })).json.items.length, 0);
  assert.ok((await api('/api/collections/orders/records?perPage=500', { headers: vendeur })).json.items.some((x) => x.id === refusee.id));
  assert.equal((await api(`/api/sokoyetu/commandes/${aLivrer.id}`, { method: 'POST', headers: vendeur, body: { action: 'refund' } })).status, 403);
  assert.equal((await api('/api/sokoyetu/audience', { headers: vendeur })).status, 200);
  assert.equal((await api('/api/sokoyetu/journal', { headers: vendeur })).status, 403);
  assert.equal((await api('/api/sokoyetu/equipe', { headers: vendeur })).status, 403);
  // Attaque : le livreur et le vendeur essaient de changer leur propre rôle par l'API des collections (JSON et formulaire).
  for (const [qui, h, id] of [['livreur', livreur, l.json.membre.id], ['vendeur', vendeur, v.json.membre.id]]) {
    for (const role of ['proprietaire', '', 'nimportequoi']) assert.notEqual((await api(`/api/collections/admins/records/${id}`, { method: 'PATCH', headers: h, body: { role } })).status, 200, `${qui} → « ${role} »`);
    const fd = new FormData(); fd.append('role', 'proprietaire');
    assert.notEqual((await fetch(`${BASE}/api/collections/admins/records/${id}`, { method: 'PATCH', headers: h, body: fd })).status, 200, `${qui} → formulaire`);
    assert.equal((await api('/api/sokoyetu/equipe', { headers: h })).status, 403, `${qui} n’a toujours pas accès à l’équipe`);
  }
  assert.deepEqual((await equipe()).json.membres.map((m) => m.role), ['proprietaire', 'vendeur', 'livreur'], 'rôles inchangés');

  // Le propriétaire : nouveau mot de passe, changement de rôle, retrait ; la boutique garde toujours un propriétaire.
  const proprio = avant[0].id;
  assert.equal((await equipe('/' + proprio, { method: 'POST', body: { role: 'vendeur' } })).status, 400);
  assert.equal((await equipe('/' + proprio, { method: 'DELETE' })).status, 400);
  assert.equal((await equipe('/' + proprio, { method: 'POST', body: { reinitialiser: true } })).status, 400);
  const mdp = await equipe('/' + l.json.membre.id, { method: 'POST', body: { reinitialiser: true } });
  assert.match(mdp.json.motDePasse, /^[A-Z]{4}-[a-z]{4}-[2-9]{4}$/);
  assert.equal((await connexion('livreur@sokoyetu.test', l.json.motDePasse)).status, 400);
  assert.equal((await connexion('livreur@sokoyetu.test', mdp.json.motDePasse)).status, 200);
  const promu = await equipe('/' + v.json.membre.id, { method: 'POST', body: { role: 'proprietaire' } });
  assert.equal(promu.json.membre.role, 'proprietaire');
  assert.equal((await api('/api/collections/discounts/records', { headers: vendeur })).json.items.length, 1, 'droits suivis tout de suite');
  assert.equal((await equipe('/' + l.json.membre.id, { method: 'DELETE' })).status, 200);
  assert.equal((await api('/api/collections/orders/records', { headers: livreur })).json.items.length, 0, 'membre retiré : plus aucun accès');
  assert.deepEqual((await equipe()).json.membres.map((m) => m.role), ['proprietaire', 'proprietaire']);
});

test('sécurité : mot de passe de 10 caractères, compte verrouillé après 10 mots de passe refusés, copie de photo, en-têtes', async () => {
  // Connexion : la limite par adresse (5 essais en 15 secondes) répond 429 ; on patiente alors. Le verrou du compte répond 429 aussi.
  const connexion = async (identity, password, col = 'admins') => {
    for (let i = 0; ; i++) {
      const r = await api(`/api/collections/${col}/auth-with-password`, { method: 'POST', body: { identity, password } });
      if (r.status !== 429 || /verrouillé/.test((r.json && r.json.message) || '') || i === 12) return r;
      await pause(2000);
    }
  };
  const m = await api('/api/sokoyetu/equipe', { method: 'POST', auth: true, body: { name: 'Compte Essai', email: 'verrou@sokoyetu.test', role: 'vendeur' } });
  assert.equal(m.status, 200, m.texte);
  const moi = await connexion('verrou@sokoyetu.test', m.json.motDePasse);
  assert.equal(moi.status, 200, moi.texte);
  const h = { Authorization: moi.json.token }; const fiche = `/api/collections/admins/records/${m.json.membre.id}`;
  // Le membre garde la main sur son nom et son mot de passe (10 caractères au moins), jamais sur son rôle.
  assert.equal((await api(fiche, { method: 'PATCH', headers: h, body: { name: 'Compte Verrou' } })).status, 200);
  assert.equal((await api(fiche, { method: 'PATCH', headers: h, body: { name: 'Compte Verrou', role: 'vendeur' } })).status !== 200, true, 'même son rôle actuel ne s’envoie pas');
  assert.equal((await api(fiche, { method: 'PATCH', headers: h, body: { oldPassword: m.json.motDePasse, password: 'court-123', passwordConfirm: 'court-123' } })).status, 400);
  const nouveau = 'Verrou-Essai-2026';
  assert.equal((await api(fiche, { method: 'PATCH', headers: h, body: { oldPassword: m.json.motDePasse, password: nouveau, passwordConfirm: nouveau } })).status, 200);
  // Attaque : 10 mots de passe faux. Le compte se verrouille : même le bon mot de passe est refusé, avec un message clair.
  for (let i = 0; i < 10; i++) assert.equal((await connexion('verrou@sokoyetu.test', 'Mauvais-' + i)).status, 400, 'essai ' + i);
  const bloque = await connexion('Verrou@Sokoyetu.test ', nouveau);
  assert.equal(bloque.status, 429, bloque.texte);
  assert.match(bloque.json.message, /verrouillé encore 1[45] minutes/);
  // Les autres comptes ne sont pas touchés ; le propriétaire voit l'alerte dans le journal.
  assert.equal((await connexion('admin@sokoyetu.test', 'Sokoyetu-2026')).status, 200);
  assert.equal((await connexion('technique@sokoyetu.test', 'Technique-2026', '_superusers')).status, 200);
  // (le journal du serveur est écrit par lots, environ 3 secondes plus tard)
  let alerte = null;
  for (let i = 0; i < 6 && !alerte; i++) { await pause(3500); alerte = ((await api('/api/sokoyetu/journal?jours=1', { auth: true })).json.erreurs || []).find((x) => /Compte verrouillé/.test(x.message)); }
  assert.ok(alerte, 'alerte au journal');
  assert.deepEqual([alerte.details.module, alerte.details.compte, alerte.niveau], ['securite', 'verrou@sokoyetu.test', 'alerte']);
  // Un compte inexistant se comporte comme un vrai : rien n'est révélé.
  assert.equal((await connexion('personne@sokoyetu.test', 'Mauvais-0')).status, 400);

  // Copie de photo : jamais vers le réseau du serveur, même par une adresse déguisée.
  for (const url of ['https://exemple.com@127.0.0.1/a.jpg', 'https://localhost./a.jpg', 'https://169.254.169.254/latest/meta-data', 'https://0x7f000001/a.jpg', 'https://100.100.100.200/a.jpg', 'https://exemple.com:8090/a.jpg']) {
    const r = await api('/api/sokoyetu/import/photo', { method: 'POST', auth: true, body: { url } });
    assert.deepEqual([r.status, r.json.code], [400, 'bad_url'], url);
  }

  // En-têtes : pas d'affichage dans le cadre d'un autre site, types de fichiers jamais devinés, scripts de la boutique seulement.
  for (const chemin of ['/', '/p/t-robe/robe', '/api/sokoyetu/catalogue']) {
    const r = await fetch(BASE + chemin);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', chemin);
    assert.match(r.headers.get('x-frame-options') || '', /SAMEORIGIN|DENY/, chemin);
    if (!chemin.startsWith('/api/')) assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, chemin);
  }
  const csp = (await fetch(BASE + '/')).headers.get('content-security-policy');
  assert.ok(/frame-ancestors 'none'/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), csp);
});

test('notifications gratuites : chaque étape prévient l’appareil qui a commandé et le compte, puis le téléphone', async () => {
  const appareil = secret();
  const centre = (a, headers = {}) => api('/api/sokoyetu/notifications', { method: 'POST', headers, body: a ? { appareil: a } : {} });
  const t = secret();
  const r = await commander(saisie({ token: t, customer: { name: 'Client Notifié', phone: '0861234567' }, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0861234567' }, appareil }));
  assert.equal(r.status, 200, r.texte);
  const id = r.json.id, numero = r.json.order.number;
  assert.deepEqual((await centre(appareil)).json, { notifications: [], nonLues: 0, alertes: [] }, 'pas encore payée : rien');
  await attendre(id, t, 'paid');
  let c = (await centre(appareil)).json;
  assert.deepEqual(c.notifications.map((n) => [n.type, n.titre, n.url, n.lu]), [['payee', 'Paiement reçu', `/suivi/${id}`, false]]);
  assert.equal(c.notifications[0].texte, `Commande #${numero} confirmée. Nous préparons vos articles.`);
  const etape = (action) => api(`/api/sokoyetu/commandes/${id}`, { method: 'POST', auth: true, body: { action, note: 'x' } });
  await etape('preparing'); await etape('note'); await etape('shipped');
  c = (await centre(appareil)).json;
  assert.deepEqual([c.notifications.map((n) => n.type), c.nonLues], [['expediee', 'preparation', 'payee'], 3]);
  assert.deepEqual((await centre(secret())).json.notifications, [], 'un autre appareil ne voit rien');
  assert.deepEqual((await centre('court')).json.notifications, []);
  assert.equal((await api('/api/sokoyetu/notifications/lues', { method: 'POST', body: { appareil } })).status, 200);
  assert.equal((await centre(appareil)).json.nonLues, 0);
  // Une étape déjà annoncée ne l'est pas deux fois (annulée, rouverte, expédiée de nouveau).
  await etape('cancel'); await etape('reopen'); await etape('shipped');
  assert.deepEqual((await centre(appareil)).json.notifications.map((n) => n.type), ['annulee', 'expediee', 'preparation', 'payee']);
  assert.equal((await enregistrement(id)).appareil, undefined, 'empreinte de l’appareil jamais renvoyée');

  // Notifications du téléphone : clé publique du serveur, services de notification reconnus seulement.
  const cle = (await api('/api/sokoyetu/push/cle')).json.cle;
  assert.equal(Buffer.from(cle, 'base64url').length, 65);
  assert.equal((await api('/api/sokoyetu/push/cle')).json.cle, cle, 'clé stable');
  const abonnement = (endpoint) => ({ endpoint, keys: { auth: Buffer.alloc(16, 1).toString('base64url'), p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString('base64url') } });
  const abonner = (ab, a = appareil) => api('/api/sokoyetu/push/abonner', { method: 'POST', body: { abonnement: ab, appareil: a } });
  assert.equal((await abonner(abonnement('http://169.254.169.254/latest/meta-data'))).status, 400, 'adresse interne refusée');
  assert.equal((await abonner(abonnement('https://fcm.googleapis.com.exemple.cd/x'))).status, 400);
  const fcm = abonnement('https://fcm.googleapis.com/fcm/send/essai-' + secret());
  assert.equal((await abonner(fcm, 'court')).status, 400, 'appareil inconnu');
  assert.equal((await abonner(fcm)).status, 200);
  const attente = (auth = fcm.keys.auth) => api('/api/sokoyetu/push/attente', { method: 'POST', body: { endpoint: fcm.endpoint, auth } });
  assert.equal((await attente('faux')).status, 404, 'seulement avec la clé de l’abonnement');
  assert.deepEqual((await attente()).json, { notifications: [] }, 'rien de nouveau depuis l’abonnement');
  await etape('delivered');
  const a = (await attente()).json;
  assert.deepEqual(a.notifications, [{ titre: 'Commande livrée', texte: `Commande #${numero} remise. Merci pour votre confiance !`, url: `/suivi/${id}`, tag: `commande-${id}` }]);
  assert.deepEqual((await attente()).json.notifications, [], 'montrée une seule fois');
  assert.equal((await api('/api/sokoyetu/push/desabonner', { method: 'POST', body: { endpoint: fcm.endpoint, auth: fcm.keys.auth } })).status, 200);
  assert.equal((await attente()).status, 404);

  // Le compte du même téléphone : prévenu des commandes passées connecté, sur tous ses appareils.
  const code = (await api('/api/sokoyetu/compte/code', { method: 'POST', body: { telephone: '0861234567' } })).json.code;
  const cx = await api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone: '0861234567', code } });
  assert.equal(cx.status, 200, cx.texte);
  const moi = { Authorization: cx.json.token };
  const t2 = secret();
  const r2 = await commander(saisie({ token: t2, customer: { name: 'Client Notifié', phone: '0861234567' }, items: [{ productId: 't-montre', qty: 1 }], discountCode: '', total: 17.3, payment: { method: 'mpesa', phone: '0861234567' } }), moi);
  assert.equal(r2.status, 200, r2.texte);
  await attendre(r2.json.id, t2, 'paid');
  assert.deepEqual((await centre('', moi)).json.notifications.map((n) => [n.type, n.url]), [['payee', `/suivi/${r2.json.id}`]]);
  // Effacement des données du client : ses notifications aussi.
  assert.equal((await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0861234567' } })).status, 200);
  assert.deepEqual((await centre(appareil)).json.notifications, []);
});

test('« Prévenez-moi » : chaque client prévenu une fois au retour en stock ; annonces aux téléphones qui les acceptent', async () => {
  const appareil = secret();
  const centre = (a = appareil, headers = {}) => api('/api/sokoyetu/notifications', { method: 'POST', headers, body: { appareil: a } });
  const alerte = (corps, a = appareil, chemin = '') => api('/api/sokoyetu/alertes' + chemin, { method: 'POST', body: { appareil: a, ...corps } });
  const chemise = { title: 'Chemise d’essai', price: 12, status: 'active', source: 'local', options: { colors: [{ name: 'Blanc' }], sizes: ['M', 'L'] }, variants: { 'Blanc|M': 0, 'Blanc|L': 1 }, images: [] };
  assert.equal((await ecrire('products', 't-chemise', chemise)).status, 200);
  assert.equal((await alerte({ produit: 'inconnu', variante: '' })).status, 404);
  assert.equal((await alerte({ produit: 't-cache', variante: '' })).status, 404, 'brouillon');
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|XL' })).status, 400, 'option inconnue');
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|L' })).status, 400, 'option disponible');
  assert.equal((await alerte({ produit: 't-chemise', variante: '' })).status, 400, 'une option en stock : article disponible');
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|M' }, 'court')).status, 400, 'appareil inconnu');
  const a = await alerte({ produit: 't-chemise', variante: 'Blanc|M' });
  assert.equal(a.status, 200, a.texte);
  assert.deepEqual(a.json.alertes, [{ produit: 't-chemise', variante: 'Blanc|M' }]);
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|M' })).status, 200, 'demandé deux fois : une seule alerte');
  assert.deepEqual((await centre()).json.alertes, [{ produit: 't-chemise', variante: 'Blanc|M' }]);
  // Un deuxième client attend aussi ; un troisième change d'avis.
  const autre = secret(), parti = secret();
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|M' }, autre)).status, 200);
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|M' }, parti)).status, 200);
  assert.deepEqual((await alerte({ produit: 't-chemise', variante: 'Blanc|M' }, parti, '/retirer')).json.alertes, []);
  // L'administration voit qui attend quoi (vendeur compris).
  assert.equal((await api('/api/sokoyetu/alertes/attente')).status, 403);
  assert.deepEqual((await api('/api/sokoyetu/alertes/attente', { auth: true })).json.produits['t-chemise'], { total: 2, variantes: { 'Blanc|M': 2 } });
  // Fiche changée mais toujours épuisée : personne n'est prévenu.
  assert.equal((await ecrire('products', 't-chemise', { ...chemise, price: 11 })).status, 200);
  assert.deepEqual((await centre()).json.notifications, []);
  // Retour en stock : les deux clients prévenus, une fois chacun, et leur alerte disparaît.
  assert.equal((await ecrire('products', 't-chemise', { ...chemise, price: 11, variants: { 'Blanc|M': 4, 'Blanc|L': 1 } })).status, 200);
  const c = (await centre()).json;
  assert.deepEqual(c.notifications.map((n) => [n.type, n.titre, n.texte, n.url]),
    [['stock', 'De retour en stock', '« Chemise d’essai » (Blanc / M) est de nouveau disponible. Les quantités sont limitées : ne tardez pas !', '/p/t-chemise/chemise-d-essai']]);
  assert.deepEqual(c.alertes, []);
  assert.deepEqual((await centre(autre)).json.notifications.map((n) => n.type), ['stock']);
  assert.deepEqual((await centre(parti)).json.notifications, [], 'alerte retirée : rien');
  assert.equal((await api('/api/sokoyetu/alertes/attente', { auth: true })).json.produits['t-chemise'], undefined);
  await ecrire('products', 't-chemise', { ...chemise, variants: { 'Blanc|M': 0, 'Blanc|L': 0 } });
  await ecrire('products', 't-chemise', { ...chemise, variants: { 'Blanc|M': 2, 'Blanc|L': 0 } });
  assert.equal((await centre()).json.notifications.length, 1, 'prévenu une seule fois');

  // Stock rendu par une commande annulée : le client qui attendait l'article entier est prévenu.
  const acheteur = secret();
  assert.equal((await ecrire('products', 't-unique', { title: 'Pièce unique', price: 30, status: 'active', source: 'local', stock: 1, images: [] })).status, 200);
  const items = [{ productId: 't-unique', qty: 1 }];
  const total = (await api('/api/sokoyetu/devis', { method: 'POST', body: { items, zoneId: 'bukavu' } })).json.total;
  const t = secret();
  const r = await commander(saisie({ token: t, customer: { name: 'Client Unique', phone: '0871112233' }, items, discountCode: '', total, payment: { method: 'mpesa', phone: '0871112233' }, appareil: acheteur }));
  assert.equal(r.status, 200, r.texte);
  await attendre(r.json.id, t, 'paid');
  assert.equal((await alerte({ produit: 't-unique', variante: '' })).status, 200);
  assert.equal((await alerte({ produit: 't-chemise', variante: 'Blanc|L' }, acheteur)).status, 200);
  assert.equal((await api(`/api/sokoyetu/commandes/${r.json.id}`, { method: 'POST', auth: true, body: { action: 'cancel' } })).status, 200);
  assert.deepEqual((await centre()).json.notifications.map((n) => [n.type, n.texte]).slice(0, 1), [['stock', '« Pièce unique » est de nouveau disponible. Les quantités sont limitées : ne tardez pas !']]);
  // Effacement des données du client : ses alertes aussi.
  assert.equal((await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0871112233' } })).status, 200);
  assert.deepEqual((await centre(acheteur)).json.alertes, []);

  // Annonces : réservées au propriétaire, envoyées aux téléphones qui acceptent les annonces (un appareil n'en reçoit qu'une).
  assert.equal((await api('/api/sokoyetu/annonces')).status, 403);
  const avant = (await api('/api/sokoyetu/annonces', { auth: true })).json;
  assert.deepEqual([avant.restantes, avant.parJour, avant.annonces], [3, 3, []]);
  const abonner = (cle, a, promos) => api('/api/sokoyetu/push/abonner', { method: 'POST', body: { appareil: a, promos, abonnement: { endpoint: 'https://fcm.googleapis.com/fcm/send/' + cle + '-' + secret(), keys: { auth: Buffer.alloc(16, 3).toString('base64url'), p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 5)]).toString('base64url') } } } });
  const fan = secret(), discret = secret();
  for (const x of [await abonner('fan', fan, true), await abonner('fan-bis', fan, true), await abonner('discret', discret, false)]) assert.equal(x.status, 200, x.texte);
  const apres = (await api('/api/sokoyetu/annonces', { auth: true })).json.abonnes;
  assert.ok(apres.promos === avant.abonnes.promos + 1 && apres.telephones >= avant.abonnes.telephones + 2, JSON.stringify([avant.abonnes, apres]));
  const annoncer = (corps) => api('/api/sokoyetu/annonces', { method: 'POST', auth: true, body: corps });
  assert.equal((await annoncer({ titre: 'Arrivage', texte: 'Nouveaux modèles', url: 'https://ailleurs.example' })).status, 400, 'lien extérieur refusé');
  const e1 = await annoncer({ titre: 'Arrivage de chemises', texte: 'Nouvelles chemises dès $11, livrées en 24 h.', url: '/p/t-chemise/chemise-d-essai' });
  assert.equal(e1.status, 200, e1.texte);
  assert.deepEqual([e1.json.annonces[0].titre, e1.json.annonces[0].destinataires, e1.json.annonces[0].auteur, e1.json.restantes], ['Arrivage de chemises', apres.promos, 'admin@sokoyetu.test', 2]);
  assert.deepEqual((await centre(fan)).json.notifications.map((n) => [n.type, n.titre, n.texte, n.url]),
    [['promo', 'Arrivage de chemises', 'Nouvelles chemises dès $11, livrées en 24 h.', '/p/t-chemise/chemise-d-essai']]);
  assert.deepEqual((await centre(discret)).json.notifications, [], 'annonces refusées : rien');
  assert.equal((await annoncer({ titre: 'Deuxième', texte: 'Encore une annonce' })).status, 200);
  assert.equal((await annoncer({ titre: 'Troisième', texte: 'Encore une annonce' })).status, 200);
  const trop = await annoncer({ titre: 'Quatrième', texte: 'Encore une annonce' });
  assert.equal(trop.status, 400);
  assert.match(trop.json.message, /3 annonces par 24 heures/);
  assert.deepEqual((await api('/api/sokoyetu/annonces', { auth: true })).json.annonces.map((x) => x.titre), ['Troisième', 'Deuxième', 'Arrivage de chemises']);

  // Un vendeur voit les clients en attente, mais n'envoie pas d'annonce.
  const m = await api('/api/sokoyetu/equipe', { method: 'POST', auth: true, body: { name: 'Amani Bahati', email: 'annonces@sokoyetu.test', role: 'vendeur' } });
  assert.equal(m.status, 200, m.texte);
  let v;
  for (let i = 0; i < 9; i++) { v = await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'annonces@sokoyetu.test', password: m.json.motDePasse } }); if (v.status !== 429) break; await pause(2000); }
  assert.equal(v.status, 200, v.texte);
  assert.equal((await api('/api/sokoyetu/annonces', { headers: { Authorization: v.json.token } })).status, 403);
  assert.equal((await api('/api/sokoyetu/alertes/attente', { headers: { Authorization: v.json.token } })).status, 200);
});

test('relance des paniers : le client avec compte qui laisse son panier est prévenu une fois, gratuitement', async () => {
  assert.equal((await ecrire('products', 't-sac', { title: 'Sac d’essai', price: 25, status: 'active', source: 'local', stock: 5, images: [] })).status, 200);
  const technicien = { Authorization: technique };
  // Premier compte par la vraie connexion (code reçu) ; les autres créés par le tableau technique (limite de codes par adresse).
  const compte = async (telephone, panier) => {
    const code = (await api('/api/sokoyetu/compte/code', { method: 'POST', body: { telephone } })).json.code;
    const cx = await api('/api/sokoyetu/compte/connexion', { method: 'POST', body: { telephone, code, panier } });
    assert.equal(cx.status, 200, cx.texte);
    return { id: cx.json.record.id, moi: { Authorization: cx.json.token } };
  };
  const compteTechnique = async (phone, panier) => {
    const mdp = secret() + secret();
    const r = await api('/api/collections/clients/records', { method: 'POST', headers: technicien, body: { phone, password: mdp, passwordConfirm: mdp, verified: true, seen: Date.now(), doc: { panier, favoris: [], profil: {}, dates: Object.fromEntries(panier.map((l) => ['panier:' + l.productId, Date.now()])) } } });
    assert.equal(r.status, 200, r.texte);
    const t = await api(`/api/collections/clients/impersonate/${r.json.id}`, { method: 'POST', headers: technicien, body: {} });
    assert.equal(t.status, 200, t.texte);
    return { id: r.json.id, moi: { Authorization: t.json.token } };
  };
  // Le panier est daté par le serveur à chaque ajout : le tableau technique le vieillit pour l'essai.
  const vieillir = async (id, heures) => {
    const rec = (await api(`/api/collections/clients/records/${id}`, { headers: technicien })).json;
    const dates = Object.fromEntries(Object.keys(rec.doc.dates).map((k) => [k, Date.now() - heures * 3600e3]));
    assert.equal((await api(`/api/collections/clients/records/${id}`, { method: 'PATCH', headers: technicien, body: { doc: { ...rec.doc, dates } } })).status, 200);
  };
  const relancer = async () => { const r = await api('/api/sokoyetu/relances', { method: 'POST', auth: true }); assert.equal(r.status, 200, r.texte); return r.json.relances; };
  const notifs = async (moi) => (await api('/api/sokoyetu/notifications', { method: 'POST', headers: moi, body: {} })).json.notifications.filter((n) => n.type === 'panier');

  assert.equal((await api('/api/sokoyetu/relances', { method: 'POST' })).status, 403);
  const a = await compte('0881239876', [{ productId: 't-montre', qty: 1 }, { productId: 't-sac', qty: 2 }]);
  await relancer();
  assert.deepEqual(await notifs(a.moi), [], 'panier tout frais : rien');
  await vieillir(a.id, 30);
  assert.ok((await relancer()) >= 1);
  assert.deepEqual((await notifs(a.moi)).map((n) => [n.titre, n.texte, n.url]),
    [['Votre panier vous attend', '« Montre d’essai » et un autre article vous attendent dans votre panier, toujours disponibles. Commandez quand vous voulez.', '/panier']]);
  const rec = (await api(`/api/collections/clients/records/${a.id}`, { auth: true })).json;
  assert.ok(rec.relance > Date.now() - 60000, 'date du rappel visible dans l’administration');
  await relancer();
  assert.equal((await notifs(a.moi)).length, 1, 'une seule fois');
  // Un autre article ajouté puis laissé : pas de second rappel dans la semaine.
  assert.equal((await api('/api/sokoyetu/compte', { method: 'POST', headers: a.moi, body: { panier: [{ productId: 't-montre', qty: 1 }, { productId: 't-sac', qty: 2 }, { productId: 't-chemise', color: 'Blanc', size: 'M', qty: 1 }] } })).status, 200);
  await vieillir(a.id, 30);
  await relancer();
  assert.equal((await notifs(a.moi)).length, 1, 'au plus une fois par semaine');

  // Le client qui a commandé depuis son dernier ajout au panier n'est pas relancé.
  const b = await compteTechnique('0881239877', [{ productId: 't-sac', qty: 1 }]);
  await vieillir(b.id, 30);
  const items = [{ productId: 't-montre', qty: 1 }];
  const total = (await api('/api/sokoyetu/devis', { method: 'POST', body: { items, zoneId: 'bukavu' } })).json.total;
  const r = await commander(saisie({ token: secret(), customer: { name: 'Client Fidèle', phone: '0881239877' }, items, discountCode: '', total, payment: { method: 'mpesa', phone: '0881239877' } }), b.moi);
  assert.equal(r.status, 200, r.texte);
  await relancer();
  assert.deepEqual(await notifs(b.moi), []);
  // Rappel désactivé dans les réglages : personne n'est relancé.
  const c = await compteTechnique('0881239878', [{ productId: 't-sac', qty: 1 }]);
  await vieillir(c.id, 30);
  const cfg = (await api('/api/collections/config/records/store', { auth: true })).json.doc;
  assert.equal((await ecrire('config', 'store', { ...cfg, cartReminder: { enabled: false, hours: 24 } })).status, 200);
  assert.equal(await relancer(), 0);
  assert.equal((await ecrire('config', 'store', cfg)).status, 200);
  assert.equal(await relancer(), 1);
  assert.equal((await notifs(c.moi)).length, 1);
});

test('discussion avec la boutique : le client écrit, l’équipe répond, le client est prévenu gratuitement', async () => {
  const appareil = secret();
  const lire = (a = appareil, headers = {}) => api('/api/sokoyetu/discussion', { method: 'POST', headers, body: { appareil: a } });
  const ecrit = (corps, a = appareil, headers = {}) => api('/api/sokoyetu/discussion/envoyer', { method: 'POST', headers, body: { appareil: a, ...corps } });
  const equipe = (id, options = {}) => api('/api/sokoyetu/discussions/' + id, { auth: true, ...options });
  const reponses = async (a, headers = {}) => (await api('/api/sokoyetu/notifications', { method: 'POST', headers, body: { appareil: a } })).json.notifications.filter((n) => n.type === 'message');
  const dernier = (r) => r.json.messages[r.json.messages.length - 1];

  assert.deepEqual((await lire()).json, { discussion: null, messages: [] });
  assert.equal((await ecrit({ texte: ' \n ' })).status, 400, 'message vide');
  assert.equal((await ecrit({ texte: 'Bonjour' }, 'court')).status, 400, 'appareil inconnu');
  const r1 = await ecrit({ texte: '  Bonjour,   la robe existe en XL ?\n\n\n\nMerci ', produit: 't-robe', nom: 'Aline' });
  assert.equal(r1.status, 200, r1.texte);
  assert.deepEqual(r1.json.messages.map((m) => [m.auteur, m.texte, m.produit, m.commande, m.par]), [['client', 'Bonjour, la robe existe en XL ?\n\nMerci', 't-robe', null, undefined]]);
  const id = r1.json.discussion.id;
  const r2 = await ecrit({ texte: 'Et celui-ci ?', produit: 't-cache', apres: r1.json.messages[0].id });
  assert.deepEqual(r2.json.messages.map((m) => [m.texte, m.produit]), [['Et celui-ci ?', '']], 'brouillon jamais joint ; seulement les nouveaux messages');

  // Une commande se joint depuis l'appareil (ou le compte) qui l'a passée, ou avec son jeton de suivi.
  const items = [{ productId: 't-montre', qty: 1 }];
  const total = (await api('/api/sokoyetu/devis', { method: 'POST', body: { items, zoneId: 'bukavu' } })).json.total;
  const o = await commander(saisie({ token: secret(), customer: { name: 'Aline Furaha', phone: '0894445566' }, items, discountCode: '', total, payment: { method: 'mpesa', phone: '0894445566' }, appareil }));
  assert.equal(o.status, 200, o.texte);
  assert.deepEqual(dernier(await ecrit({ texte: 'Quand arrive ma commande ?', commande: o.json.id })).commande, { id: o.json.id, numero: o.json.order.number });
  assert.equal(dernier(await ecrit({ texte: 'Et celle-ci ?', commande: commandeId, t: secret() })).commande, null, 'commande d’un autre client : pas jointe');
  assert.deepEqual(dernier(await ecrit({ texte: 'Celle de ma sœur, avec son lien de suivi.', commande: commandeId, t: commandeJeton })).commande, { id: commandeId, numero: commandeNumero });

  // L'équipe voit la discussion (jamais l'empreinte de l'appareil) ; un visiteur ne voit rien.
  assert.deepEqual((await api('/api/collections/discussions/records')).json.items, []);
  const d = (await api('/api/collections/discussions/records?sort=-maj', { auth: true })).json.items.find((x) => x.id === id);
  assert.deepEqual([d.nom, d.telephone, d.auteur, d.non_lus, d.a_repondre, d.dernier, d.appareil], ['Aline', '0894445566', 'client', 5, true, 'Celle de ma sœur, avec son lien de suivi.', undefined]);
  const v = await equipe(id);
  assert.equal(v.status, 200, v.texte);
  assert.deepEqual([v.json.messages.length, v.json.commandes], [5, [o.json.id]]);
  assert.equal((await equipe('inconnue')).status, 404);
  assert.equal((await equipe(id, { method: 'POST', body: { texte: '' } })).status, 400);
  const rep = await equipe(id, { method: 'POST', body: { texte: 'Bonjour Aline, oui, en XL aussi. Votre commande part demain.', produit: 't-robe', commande: o.json.id, apres: v.json.messages[4].id } });
  assert.equal(rep.status, 200, rep.texte);
  assert.deepEqual(rep.json.messages.map((m) => [m.auteur, m.par, m.produit, m.commande]), [['boutique', 'admin@sokoyetu.test', 't-robe', { id: o.json.id, numero: o.json.order.number }]]);
  assert.deepEqual([rep.json.discussion.auteur, rep.json.discussion.non_lus, rep.json.discussion.a_repondre], ['boutique', 0, false]);

  // Le client est prévenu (notification gratuite) ; lire la discussion la marque lue, et l'équipe voit « Vu ».
  assert.deepEqual((await reponses(appareil)).map((n) => [n.titre, n.texte, n.url, n.lu]), [['Réponse de la boutique', 'Bonjour Aline, oui, en XL aussi. Votre commande part demain.', '/discussion', false]]);
  assert.deepEqual(await reponses(secret()), [], 'un autre appareil ne voit rien');
  const lu = await lire();
  assert.deepEqual([dernier(lu).auteur, dernier(lu).par, lu.json.discussion.luBoutique > 0], ['boutique', undefined, true], 'le nom du membre de l’équipe reste interne');
  assert.equal((await reponses(appareil))[0].lu, true);
  assert.ok((await equipe(id)).json.discussion.lu_client >= dernier(lu).cree);
  // Un merci : rien à répondre, l'équipe classe la discussion.
  await ecrit({ texte: 'Merci beaucoup !' });
  assert.deepEqual((({ a_repondre, non_lus }) => [a_repondre, non_lus])((await equipe(id)).json.discussion), [true, 1]);
  assert.equal((await equipe(id, { method: 'POST', body: { action: 'n-importe' } })).status, 400);
  const classee = (await equipe(id, { method: 'POST', body: { action: 'traitee' } })).json.discussion;
  assert.deepEqual([classee.a_repondre, classee.non_lus], [false, 0]);

  // Le client se connecte : la discussion de ce téléphone rejoint son compte, lisible de tous ses appareils et de ceux-là seulement.
  const technicien = { Authorization: technique };
  const mdp = secret() + secret();
  const c = await api('/api/collections/clients/records', { method: 'POST', headers: technicien, body: { phone: '0894445566', name: 'Aline Furaha', password: mdp, passwordConfirm: mdp, verified: true, doc: { panier: [], favoris: [], profil: {} } } });
  assert.equal(c.status, 200, c.texte);
  const moi = { Authorization: (await api(`/api/collections/clients/impersonate/${c.json.id}`, { method: 'POST', headers: technicien, body: {} })).json.token };
  const connecte = await lire(appareil, moi);
  assert.deepEqual([connecte.json.discussion.id, connecte.json.messages.length], [id, 7]);
  assert.equal((await lire(secret(), moi)).json.discussion.id, id, 'autre téléphone du compte');
  assert.deepEqual((await lire()).json, { discussion: null, messages: [] }, 'téléphone déconnecté : la discussion du compte reste privée');
  // Écrite d'un autre téléphone avant de se connecter : elle rejoint celle du compte.
  const appareil2 = secret();
  const d2 = (await ecrit({ texte: 'Bonjour depuis mon autre téléphone' }, appareil2)).json.discussion.id;
  assert.notEqual(d2, id);
  const reunie = await lire(appareil2, moi);
  assert.deepEqual([reunie.json.discussion.id, reunie.json.messages.length, dernier(reunie).texte], [id, 8, 'Bonjour depuis mon autre téléphone']);
  assert.equal((await equipe(d2)).status, 404);
  const s = (await equipe(id)).json.discussion;
  assert.deepEqual([s.nom, s.telephone, s.client, s.a_repondre, s.non_lus, s.dernier], ['Aline Furaha', '0894445566', c.json.id, true, 1, 'Bonjour depuis mon autre téléphone']);
  // La réponse suivante arrive sur le compte.
  assert.equal((await equipe(id, { method: 'POST', body: { texte: 'Bien reçu !' } })).status, 200);
  assert.deepEqual((await reponses(secret(), moi)).map((n) => [n.texte, n.lu]), [['Bien reçu !', false]]);

  // Le livreur n'a pas accès aux messages des clients.
  const membre = await api('/api/sokoyetu/equipe', { method: 'POST', auth: true, body: { name: 'Jean Mulume', email: 'livreur-messages@sokoyetu.test', role: 'livreur' } });
  assert.equal(membre.status, 200, membre.texte);
  let x;
  for (let i = 0; i < 9; i++) { x = await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'livreur-messages@sokoyetu.test', password: membre.json.motDePasse } }); if (x.status !== 429) break; await pause(2000); }
  assert.equal(x.status, 200, x.texte);
  const livreur = { Authorization: x.json.token };
  assert.deepEqual((await api('/api/collections/discussions/records', { headers: livreur })).json.items, []);
  assert.equal((await api('/api/sokoyetu/discussions/' + id, { headers: livreur })).status, 403);
  assert.equal((await api('/api/sokoyetu/discussions/' + id, { method: 'POST', headers: livreur, body: { texte: 'Bonjour' } })).status, 403);

  // Compte supprimé par le client : sa discussion disparaît.
  assert.equal((await api('/api/sokoyetu/compte/supprimer', { method: 'POST', headers: moi, body: {} })).status, 200);
  assert.equal((await equipe(id)).status, 404);
  // Effacement des données du client (son téléphone) : la discussion de son appareil aussi.
  const d4 = (await ecrit({ texte: 'Me revoilà, sans compte.' })).json.discussion.id;
  assert.deepEqual((({ nom, telephone }) => [nom, telephone])((await equipe(d4)).json.discussion), ['Aline Furaha', '0894445566'], 'nom et téléphone de sa dernière commande');
  assert.equal((await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0894445566' } })).status, 200);
  assert.equal((await equipe(d4)).status, 404);
  // Supprimée par l'équipe (message abusif) : ses messages aussi.
  const d5 = (await ecrit({ texte: 'Message à supprimer' }, secret())).json.discussion.id;
  assert.equal((await equipe(d5, { method: 'DELETE' })).status, 200);
  assert.equal((await equipe(d5)).status, 404);
});

test('avis : seul le client qui a reçu l’article le note ; l’équipe répond ou masque ; rappel gratuit après la livraison', async () => {
  const appareil = secret();
  const technicien = { Authorization: technique };
  const aDonner = async (corps = {}, headers = {}) => { const r = await api('/api/sokoyetu/avis/a-donner', { method: 'POST', headers, body: { appareil, ...corps } }); assert.equal(r.status, 200, r.texte); return r.json.articles; };
  const donner = (corps, headers = {}) => api('/api/sokoyetu/avis/donner', { method: 'POST', headers, body: { appareil, ...corps } });
  const publics = async (q) => { const r = await api('/api/sokoyetu/avis?' + q); assert.equal(r.status, 200, r.texte); return r.json; };
  const moderer = (id, corps, headers) => api('/api/sokoyetu/avis/' + id, { method: 'POST', auth: !headers, headers: headers || {}, body: corps });
  const notifs = async (type, a = appareil, headers = {}) => (await api('/api/sokoyetu/notifications', { method: 'POST', headers, body: { appareil: a } })).json.notifications.filter((n) => n.type === type);
  const relancer = async () => { const r = await api('/api/sokoyetu/relances', { method: 'POST', auth: true }); assert.equal(r.status, 200, r.texte); return r.json.avis; };
  const notes = async () => Object.fromEntries((await api('/api/sokoyetu/catalogue')).json.products.filter((p) => p.avis).map((p) => [p.id, p.avis]));
  assert.equal((await ecrire('products', 't-jupe', { title: 'Jupe d’essai', price: 18, status: 'active', source: 'local', options: { colors: [{ name: 'Rouge' }], sizes: ['S', 'M'] }, variants: { 'Rouge|S': 5, 'Rouge|M': 5 }, images: [] })).status, 200);

  // Commande payée sur cet appareil : jupe rouge M et montre.
  const items = [{ productId: 't-jupe', color: 'Rouge', size: 'M', qty: 1 }, { productId: 't-montre', qty: 1 }];
  const total = (await api('/api/sokoyetu/devis', { method: 'POST', body: { items, zoneId: 'bukavu' } })).json.total;
  const t = secret();
  const o = await commander(saisie({ token: t, customer: { name: 'benjamin lukusa', phone: '0841112233' }, items, discountCode: '', total, payment: { method: 'mpesa', phone: '0841112233' }, appareil }));
  assert.equal(o.status, 200, o.texte);
  const id = o.json.id, numero = o.json.order.number;
  await attendre(id, t, 'paid');
  // Pas encore reçue : rien à noter, avis refusé.
  assert.deepEqual(await aDonner(), []);
  assert.equal((await donner({ commande: id, t, produit: 't-jupe', note: 5 })).status, 400);
  for (const action of ['preparing', 'shipped', 'delivered']) assert.equal((await api(`/api/sokoyetu/commandes/${id}`, { method: 'POST', auth: true, body: { action } })).status, 200);

  // Reçue : chaque article est à noter, depuis cet appareil ou avec le lien de suivi (autre téléphone).
  const l = await aDonner();
  assert.deepEqual(l.map((a) => [a.produit, a.titre, a.variante, a.commande, a.numero, a.avis]), [['t-jupe', 'Jupe d’essai', 'Rouge, taille M', id, numero, null], ['t-montre', 'Montre d’essai', '', id, numero, null]]);
  assert.ok(l[0].livree > Date.now() - 120000);
  assert.deepEqual((await aDonner({ appareil: secret(), suivis: [{ id, t }] })).map((a) => a.produit), ['t-jupe', 't-montre']);
  assert.deepEqual(await aDonner({ appareil: secret(), suivis: [{ id, t: secret() }] }), [], 'mauvais jeton de suivi : rien');
  assert.equal((await donner({ commande: id, produit: 't-jupe', texte: 'Sans note' })).status, 400);
  assert.equal((await donner({ commande: id, produit: 't-robe', note: 4 })).status, 400, 'article absent de la commande');
  assert.equal((await donner({ appareil: secret(), commande: id, produit: 't-jupe', note: 4 })).status, 404, 'commande d’un autre');
  const r = await donner({ commande: id, produit: 't-jupe', note: 4, texte: '  Belle jupe,   tissu léger. ' });
  assert.equal(r.status, 200, r.texte);
  assert.deepEqual((({ nom, note, texte, variante, etat, motif }) => [nom, note, texte, variante, etat, motif])(r.json.avis), ['Benjamin L.', 4, 'Belle jupe, tissu léger.', 'Rouge, taille M', 'publie', '']);
  // Un avis par article et par téléphone : avec le lien de suivi, il est modifié.
  const r2 = await donner({ appareil: secret(), commande: id, t, produit: 't-jupe', note: 5, texte: 'Finalement parfaite.' });
  assert.equal(r2.status, 200, r2.texte);
  assert.equal(r2.json.avis.id, r.json.avis.id);
  assert.deepEqual((await aDonner()).map((a) => [a.produit, a.avis && a.avis.note]), [['t-jupe', 5], ['t-montre', null]]);

  // Publié : lu par tous, sans téléphone ni commande ; note moyenne dans le catalogue public.
  const p = await publics('produit=t-jupe');
  assert.deepEqual([p.resume, p.suite], [{ note: 5, nombre: 1, repartition: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 } }, false]);
  assert.deepEqual(Object.keys(p.avis[0]).sort(), ['cree', 'id', 'nom', 'note', 'reponse', 'reponseLe', 'texte', 'variante']);
  assert.deepEqual((await publics('produit=t-jupe&note=3')).avis, []);
  assert.deepEqual((await publics('produit=../x')).avis, []);
  assert.deepEqual((await notes())['t-jupe'], { note: 5, nombre: 1 });

  // Rappel gratuit : pas le jour de la livraison ; 3 jours après, une fois, pour l'article qui reste à noter.
  await relancer();
  assert.deepEqual(await notifs('avis'), [], 'trop tôt');
  const rec = (await api(`/api/collections/orders/records/${id}`, { headers: technicien })).json;
  assert.equal((await api(`/api/collections/orders/records/${id}`, { method: 'PATCH', headers: technicien, body: { doc: { ...rec.doc, deliveredAt: Date.now() - 3 * 864e5 } } })).status, 200);
  assert.ok((await relancer()) >= 1);
  assert.deepEqual((await notifs('avis')).map((n) => [n.titre, n.texte, n.url]), [['Votre avis compte', '« Montre d’essai » vous plaît ? Donnez votre avis en un geste : il aide les autres clients.', '/avis']]);
  await relancer();
  assert.equal((await notifs('avis')).length, 1, 'une seule fois');

  // Vérification avant publication choisie par la boutique : l'avis attend l'équipe.
  const cfg = (await api('/api/collections/config/records/store', { auth: true })).json.doc;
  assert.equal((await ecrire('config', 'store', { ...cfg, reviews: { enabled: true, moderation: true, reminder: true } })).status, 200);
  const m = await donner({ commande: id, produit: 't-montre', note: 2, texte: 'Arrivée rayée. Appelez-moi au 0841112233.' });
  assert.equal(m.status, 200, m.texte);
  assert.equal(m.json.avis.etat, 'attente');
  assert.equal((await publics('produit=t-montre')).resume.nombre, 0, 'pas encore publié');
  assert.equal((await ecrire('config', 'store', cfg)).status, 200);

  // L'équipe voit tous les avis (jamais l'appareil) ; un visiteur, rien.
  assert.deepEqual((await api('/api/collections/avis/records')).json.items, []);
  const montre = (await api('/api/collections/avis/records?sort=-cree', { auth: true })).json.items.find((x) => x.produit === 't-montre');
  assert.deepEqual([montre.telephone, montre.numero, montre.commande, montre.etat, montre.appareil], ['0841112233', numero, id, 'attente', undefined]);
  assert.equal((await moderer(montre.id, { action: 'n-importe' })).status, 400);
  assert.equal((await moderer('inconnu', { action: 'publier' })).status, 404);
  // Masqué (données personnelles) : le client voit le motif ; réécrit, son avis repasse par la vérification.
  const mq = await moderer(montre.id, { action: 'masquer', motif: 'personnel' });
  assert.equal(mq.status, 200, mq.texte);
  assert.deepEqual([mq.json.avis.etat, mq.json.avis.motif], ['masque', 'personnel']);
  const vu = (await aDonner()).find((a) => a.produit === 't-montre').avis;
  assert.deepEqual([vu.etat, vu.motif], ['masque', 'Données personnelles (téléphone, adresse…)']);
  assert.equal((await donner({ commande: id, produit: 't-montre', note: 3, texte: 'Arrivée rayée, mais la boutique me l’a échangée.' })).json.avis.etat, 'attente');
  assert.equal((await moderer(montre.id, { action: 'publier' })).json.avis.etat, 'publie');
  // Réponse publique : le client est prévenu une fois, même si la réponse est retouchée.
  const rp = await moderer(montre.id, { reponse: '  Merci Benjamin, désolés pour la rayure !  ' });
  assert.deepEqual([rp.json.avis.reponse, rp.json.avis.reponse_par], ['Merci Benjamin, désolés pour la rayure !', 'admin@sokoyetu.test']);
  assert.equal((await moderer(montre.id, { reponse: 'Merci Benjamin !' })).status, 200);
  assert.deepEqual((await notifs('avis_reponse')).map((n) => [n.titre, n.texte, n.url]), [['La boutique vous a répondu', 'Votre avis sur « Montre d’essai » : Merci Benjamin, désolés pour la rayure !', '/p/t-montre/montre-d-essai']]);
  const pub = (await publics('produit=t-montre')).avis[0];
  assert.deepEqual([pub.note, pub.reponse, pub.nom], [3, 'Merci Benjamin !', 'Benjamin L.']);
  const n2 = await notes();
  assert.deepEqual([n2['t-jupe'], n2['t-montre']], [{ note: 5, nombre: 1 }, { note: 3, nombre: 1 }]);

  // Le livreur ne voit pas les avis et ne peut pas y répondre.
  const membre = await api('/api/sokoyetu/equipe', { method: 'POST', auth: true, body: { name: 'Jean Bisimwa', email: 'livreur-avis@sokoyetu.test', role: 'livreur' } });
  assert.equal(membre.status, 200, membre.texte);
  let x;
  for (let i = 0; i < 9; i++) { x = await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'livreur-avis@sokoyetu.test', password: membre.json.motDePasse } }); if (x.status !== 429) break; await pause(2000); }
  assert.equal(x.status, 200, x.texte);
  const livreur = { Authorization: x.json.token };
  assert.deepEqual((await api('/api/collections/avis/records', { headers: livreur })).json.items, []);
  assert.equal((await moderer(montre.id, { reponse: 'Bonjour' }, livreur)).status, 403);

  // Avec un compte : commande passée connecté, notée depuis n'importe quel téléphone du compte.
  const mdp = secret() + secret();
  const c = await api('/api/collections/clients/records', { method: 'POST', headers: technicien, body: { phone: '0842223344', name: 'Aline Furaha', password: mdp, passwordConfirm: mdp, verified: true, doc: { panier: [], favoris: [], profil: {} } } });
  assert.equal(c.status, 200, c.texte);
  const moi = { Authorization: (await api(`/api/collections/clients/impersonate/${c.json.id}`, { method: 'POST', headers: technicien, body: {} })).json.token };
  const t2 = secret(); const items2 = [{ productId: 't-jupe', color: 'Rouge', size: 'S', qty: 1 }];
  const total2 = (await api('/api/sokoyetu/devis', { method: 'POST', body: { items: items2, zoneId: 'bukavu' } })).json.total;
  const o2 = await commander(saisie({ token: t2, customer: { name: 'Aline Furaha', phone: '0842223344' }, items: items2, discountCode: '', total: total2, payment: { method: 'mpesa', phone: '0842223344' } }), moi);
  assert.equal(o2.status, 200, o2.texte);
  await attendre(o2.json.id, t2, 'paid');
  for (const action of ['shipped', 'delivered']) assert.equal((await api(`/api/sokoyetu/commandes/${o2.json.id}`, { method: 'POST', auth: true, body: { action } })).status, 200);
  assert.deepEqual((await aDonner({ appareil: secret() }, moi)).map((a) => [a.produit, a.variante]), [['t-jupe', 'Rouge, taille S']]);
  const ra = await donner({ appareil: secret(), commande: o2.json.id, produit: 't-jupe', note: 3 }, moi);
  assert.equal(ra.status, 200, ra.texte);
  assert.deepEqual((await publics('produit=t-jupe')).resume, { note: 4, nombre: 2, repartition: { 5: 1, 4: 0, 3: 1, 2: 0, 1: 0 } });
  // Compte supprimé : ses avis disparaissent ; effacement des données d'un client (son téléphone) : les siens aussi.
  assert.equal((await api('/api/sokoyetu/compte/supprimer', { method: 'POST', headers: moi, body: {} })).status, 200);
  assert.equal((await publics('produit=t-jupe')).resume.nombre, 1);
  assert.equal((await api('/api/sokoyetu/clients/effacer', { method: 'POST', auth: true, body: { phone: '0841112233' } })).status, 200);
  assert.deepEqual([(await publics('produit=t-jupe')).resume.nombre, (await publics('produit=t-montre')).resume.nombre], [0, 0]);
  const reste = await notes();
  assert.ok(!reste['t-jupe'] && !reste['t-montre'], 'notes retirées du catalogue');
});

test('fidélité : cagnotte gagnée à la livraison, utilisée connecté ; parrainage : cadeau du filleul, récompense du parrain', async () => {
  const technicien = { Authorization: technique };
  const cfg0 = (await api('/api/collections/config/records/store', { auth: true })).json.doc;
  // Comptes clients créés par le tableau technique (sans code de connexion), puis « connectés ».
  const compte = async (phone, name) => {
    const mdp = secret() + secret();
    const c = await api('/api/collections/clients/records', { method: 'POST', headers: technicien, body: { phone, name, password: mdp, passwordConfirm: mdp, verified: true, doc: { panier: [], favoris: [], profil: {} } } });
    assert.equal(c.status, 200, c.texte);
    return { Authorization: (await api(`/api/collections/clients/impersonate/${c.json.id}`, { method: 'POST', headers: technicien, body: {} })).json.token };
  };
  const cagnotte = async (headers) => { const r = await api('/api/sokoyetu/cagnotte', { headers }); assert.equal(r.status, 200, r.texte); return r.json; };
  const devis = async (corps, headers = {}) => { const r = await api('/api/sokoyetu/devis', { method: 'POST', headers, body: { zoneId: 'bukavu', ...corps } }); assert.equal(r.status, 200, r.texte); return r.json; };
  const montre = [{ productId: 't-montre', qty: 1 }];
  const passer = async ({ headers = {}, name, phone, items = montre, extra = {} }) => {
    const dv = await devis({ items, ...extra }, headers);
    const t = secret();
    const o = await commander(saisie({ token: t, customer: { name, phone }, items, discountCode: '', total: dv.total, payment: { method: 'mpesa', phone }, ...extra }), headers);
    assert.equal(o.status, 200, o.texte);
    await attendre(o.json.id, t, 'paid');
    return { id: o.json.id, t, order: o.json.order, dv };
  };
  const etapes = async (id, actions) => { for (const action of actions) assert.equal((await api(`/api/sokoyetu/commandes/${id}`, { method: 'POST', auth: true, body: { action } })).status, 200); };
  const notifs = async (type, headers) => (await api('/api/sokoyetu/notifications', { method: 'POST', headers, body: { appareil: secret() } })).json.notifications.filter((n) => n.type === type).map((n) => [n.titre, n.texte, n.url]);

  // Fermées au départ : ni cagnotte, ni lien de parrainage.
  const aline = await compte('0811112222', 'Aline Furaha');
  const ferme = await cagnotte(aline);
  assert.deepEqual([ferme.ouverte, ferme.solde, ferme.parrainage], [false, 0, null]);
  assert.deepEqual((await api('/api/sokoyetu/cagnotte')).status, 401);
  const sans = await devis({ items: montre });
  assert.deepEqual([sans.bienvenue, sans.cagnotte, sans.gain, sans.fidelite], [null, 0, 0, { solde: 0, raison: '' }]);
  assert.equal((await ecrire('config', 'store', { ...cfg0, loyalty: { enabled: true, pct: 5 }, referral: { enabled: true, reward: 3, welcome: 2, min: 10 } })).status, 200);

  // Le parrain : son code (créé à la première visite de sa cagnotte, toujours le même), et le lien public.
  const a = await cagnotte(aline);
  assert.deepEqual([a.ouverte, a.pct, a.part, a.solde, a.aVenir, a.premiere, a.mouvements], [true, 5, 50, 0, 0, true, []]);
  const code = a.parrainage.code;
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{6}$/);
  assert.deepEqual([a.parrainage.bienvenue, a.parrainage.recompense, a.parrainage.min, a.parrainage.filleuls, a.parrainage.gagne, a.parrainage.enCours], [2, 3, 10, 0, 0, []]);
  assert.equal((await cagnotte(aline)).parrainage.code, code);
  assert.deepEqual((await api('/api/sokoyetu/parrainage?code=' + code.toLowerCase().slice(0, 3) + ' ' + code.slice(3))).json, { ok: true, code, prenom: 'Aline F.', bienvenue: 2, min: 10 });
  assert.deepEqual((await api('/api/sokoyetu/parrainage?code=ZZZZZZ')).json, { ok: false });
  assert.deepEqual((await api('/api/sokoyetu/parrainage?code=../x')).json, { ok: false });

  // Le cadeau de bienvenue : pour un compte qui n'a jamais commandé, sans code promo, jamais avec son propre lien.
  assert.deepEqual((await devis({ items: montre, parrain: code })).fidelite.raison, 'compte');
  assert.deepEqual((await devis({ items: montre, parrain: code }, aline)).fidelite.raison, 'soi-meme');
  const patrick = await compte('0822223333', 'Patrick Bisimwa');
  const promo = await devis({ items: montre, parrain: code, discountCode: 'ESSAI10' }, patrick);
  assert.deepEqual([promo.fidelite.raison, promo.bienvenue, promo.remise.amount], ['', null, 1.5]);
  const dv = await devis({ items: montre, parrain: code }, patrick);
  // 15 $ − 2 $ offerts = 13 $ d'articles ; frais 2 % : 0,26 $ ; livraison 2 $ ; gain 5 % : 0,65 $.
  assert.deepEqual([dv.sousTotal, dv.bienvenue, dv.cagnotte, dv.frais, dv.livraison, dv.total, dv.gain, dv.fidelite.raison], [15, { code, amount: 2 }, 0, 0.26, 2, 15.26, 0.65, '']);
  const o1 = await passer({ headers: patrick, name: 'Patrick Bisimwa', phone: '0822223333', extra: { parrain: code } });
  assert.deepEqual([o1.order.total, o1.order.referral, o1.order.loyalty, o1.order.wallet], [15.26, { code, amount: 2 }, { pct: 5, amount: 0.65 }, null]);
  const brut = (await enregistrement(o1.id)).doc;
  assert.deepEqual([brut.referral.reward, brut.referral.byPhone, brut.loyalty.phone], [3, '0811112222', '0822223333']);
  assert.equal((await devis({ items: montre, parrain: code }, patrick)).fidelite.raison, 'deja-client');

  // Payée, pas encore livrée : gains à venir, récompense du parrain en cours.
  const p1 = await cagnotte(patrick);
  assert.deepEqual([p1.solde, p1.aVenir, p1.premiere], [0, 0.65, false]);
  assert.deepEqual((await cagnotte(aline)).parrainage.enCours, [{ filleul: 'Patrick B.', montant: 3 }]);

  // Livrée : chacun reçoit son gain, une seule fois, et en est prévenu (gratuit).
  await etapes(o1.id, ['shipped', 'delivered']);
  await etapes(o1.id, ['note']);
  const p2 = await cagnotte(patrick);
  assert.deepEqual([p2.solde, p2.aVenir, p2.mouvements.map((m) => [m.type, m.montant, m.numero])], [0.65, 0, [['achat', 0.65, o1.order.number]]]);
  assert.deepEqual(await notifs('livree', patrick), [['Commande livrée', `Commande #${o1.order.number} remise. Merci pour votre confiance ! $0.65 ajoutés à votre cagnotte.`, `/suivi/${o1.id}`]]);
  const a2 = await cagnotte(aline);
  assert.deepEqual([a2.solde, a2.parrainage.filleuls, a2.parrainage.gagne, a2.parrainage.enCours, a2.mouvements.map((m) => [m.type, m.montant, m.filleul])], [3, 1, 3, [], [['parrainage', 3, 'Patrick B.']]]);
  assert.deepEqual(await notifs('parrainage', aline), [['Merci pour votre parrainage !', 'Patrick B. a reçu sa première commande : $3.00 ajoutés à votre cagnotte.', '/compte/cagnotte']]);

  // Le parrain utilise sa cagnotte (connecté seulement, la moitié des articles au plus) : 20 $ de robe, 3 $ de cagnotte.
  const robe = [{ productId: 't-robe', color: 'Noir', size: 'M', qty: 1 }];
  assert.equal((await devis({ items: robe, cagnotte: true })).cagnotte, 0);
  const avec = await devis({ items: robe, cagnotte: true }, aline);
  assert.deepEqual([avec.cagnotte, avec.frais, avec.total, avec.gain, avec.fidelite.solde], [3, 0.34, 19.34, 0.85, 3]);
  const o2 = await passer({ headers: aline, name: 'Aline Furaha', phone: '0811112222', items: robe, extra: { cagnotte: true } });
  assert.deepEqual([o2.order.wallet, o2.order.total], [{ used: 3 }, 19.34]);
  const a3 = await cagnotte(aline);
  assert.deepEqual([a3.solde, a3.mouvements[0].type, a3.mouvements[0].montant], [0, 'utilise', -3]);
  // Déjà dépensée : une autre commande au même montant est refusée (le client revoit le total).
  const refus = await commander(saisie({ token: secret(), customer: { name: 'Aline Furaha', phone: '0811112222' }, items: robe, discountCode: '', total: 19.34, cagnotte: true, payment: { method: 'mpesa', phone: '0811112222' } }), aline);
  assert.deepEqual([refus.status, refus.json.champ], [400, 'total']);
  // Commande annulée : la cagnotte revient.
  await etapes(o2.id, ['cancel']);
  assert.equal((await cagnotte(aline)).solde, 3);

  // Sans compte : le gain va au téléphone de la commande ; le client qui crée son compte avec ce numéro le retrouve.
  const o3 = await passer({ name: 'Neema Kahindo', phone: '0833334444' });
  await etapes(o3.id, ['shipped', 'delivered']);
  const neema = await compte('0833334444', 'Neema Kahindo');
  assert.equal((await cagnotte(neema)).solde, 0.75);

  // Administration : la cagnotte d'un client, et le geste de la boutique (une fois par jeton), annoncé au client.
  const fiche = await api('/api/sokoyetu/clients/0811112222/cagnotte', { auth: true });
  assert.deepEqual((({ solde, gagne, utilise, filleuls, compte: c, code: k }) => [solde, gagne, utilise, filleuls, c, k])(fiche.json), [3, 3, 0, 1, true, code]);
  assert.equal((await api('/api/sokoyetu/clients/0811112222/cagnotte')).status, 403);
  const jetonGeste = secret();
  const geste = (corps) => api('/api/sokoyetu/clients/0811112222/cagnotte', { method: 'POST', auth: true, body: { jeton: jetonGeste, ...corps } });
  assert.equal((await geste({ montant: 0 })).status, 400);
  assert.equal((await geste({ montant: 500 })).status, 400);
  const g = await geste({ montant: 5, motif: 'Retard de livraison' });
  assert.deepEqual([g.status, g.json.ajoute, g.json.solde], [200, true, 8], g.texte);
  assert.deepEqual([(await geste({ montant: 5 })).json.ajoute, (await cagnotte(aline)).solde], [false, 8]);
  assert.deepEqual(await notifs('cagnotte', aline), [['Cadeau de la boutique', '$5.00 ajoutés à votre cagnotte (Retard de livraison). Merci de votre fidélité !', '/compte/cagnotte']]);

  // Compte supprimé : la cagnotte disparaît avec lui.
  assert.equal((await api('/api/sokoyetu/compte/supprimer', { method: 'POST', headers: patrick, body: {} })).status, 200);
  assert.deepEqual((({ solde, gagne }) => [solde, gagne])((await api('/api/sokoyetu/clients/0822223333/cagnotte', { auth: true })).json), [0, 0]);
  assert.equal((await ecrire('config', 'store', cfg0)).status, 200);
});
