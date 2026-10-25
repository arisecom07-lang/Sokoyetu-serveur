// Tests des règles métier partagées : node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/commun/js/regles.js');

const cfg = R.config({ payments: { mpesa: { enabled: true, number: '0991234567' }, airtel: { enabled: true, number: '' } }, freeShippingOver: 50 });
const produits = {
  robe: { title: 'Robe', price: 20, cost: 8, status: 'active', source: 'local', options: { colors: [{ name: 'Noir', hex: '#000' }], sizes: ['M', 'L'] }, variants: { 'Noir|M': 2, 'Noir|L': 0 }, sold: 1 },
  montre: { title: 'Montre', price: 15.5, cost: 6, status: 'active', source: 'import' },
  sac: { title: 'Sac', price: 10, status: 'active', source: 'local', stock: 3 },
  brouillon: { title: 'Brouillon', price: 5, status: 'draft', stock: 9 }
};
const produit = (id) => produits[id] || null;
const remise10 = { code: 'BIENVENUE10', type: 'percent', value: 10, minSubtotal: 20, active: true };

test('validation des téléphones', () => {
  assert.equal(R.valider.telephone('099 123 4567'), '0991234567');
  assert.equal(R.valider.telephone('+243 99 123 4567'), '0991234567');
  assert.equal(R.valider.telephone('00243991234567'), '0991234567');
  assert.equal(R.valider.telephone('+250 788 123 456'), '+250788123456');
  assert.equal(R.valider.telephone('12345'), '');
  assert.equal(R.valider.telephone('0712345678'), '');
});

test('validation des noms et codes', () => {
  assert.equal(R.valider.nom('  Grâce   Mapendo '), 'Grâce Mapendo');
  assert.equal(R.valider.nom('N’Sele-Kabeya'), 'N’Sele-Kabeya');
  assert.equal(R.valider.nom('<script>'), '');
  assert.equal(R.valider.nom('a'), '');
  assert.equal(R.valider.reference(' pp231024.1234 '), 'PP231024.1234');
  assert.equal(R.valider.reference('ab'), '');
  assert.equal(R.valider.codePromo('bienvenue10'), 'BIENVENUE10');
});

test('configuration : zones et retrait', () => {
  assert.equal(cfg.zones.length, 3);
  assert.equal(R.estRetrait(R.zoneDe(cfg, 'retrait')), true);
  assert.equal(R.estRetrait(R.zoneDe(cfg, 'bukavu')), false);
  assert.deepEqual(R.moyensDePaiement(cfg).map((m) => m.k), ['mpesa']);
  const vide = R.config({ zones: [] });
  assert.equal(vide.zones.length, 3);
});

test('stock par variante', () => {
  assert.equal(R.stockDe(produits.robe, 'Noir', 'M'), 2);
  assert.equal(R.stockTotal(produits.robe), 2);
  assert.deepEqual(R.clesVariantes(produits.robe), ['Noir|M', 'Noir|L']);
  assert.equal(R.stockDe(produits.sac), 3);
});

test('devis sans problème, avec remise et livraison', () => {
  const d = R.devis({ cfg, produit, lignes: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 1 }, { productId: 'montre', qty: 2 }], zoneId: 'bukavu', code: 'bienvenue10', remise: remise10 });
  assert.deepEqual(d.problemes, []);
  assert.equal(d.sousTotal, 51);
  assert.equal(d.remise.amount, 5.1);
  assert.equal(d.livraison, 2);
  assert.equal(d.total, 47.9);
});

test('livraison offerte au-delà du seuil', () => {
  const d = R.devis({ cfg, produit, lignes: [{ productId: 'montre', qty: 4 }], zoneId: 'goma' });
  assert.equal(d.sousTotal, 62);
  assert.equal(d.livraison, 0);
  assert.equal(d.total, 62);
});

test('devis : stock insuffisant, option invalide, article retiré, doublons fusionnés', () => {
  const d = R.devis({ cfg, produit, lignes: [
    { productId: 'robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 'robe', color: 'Noir', size: 'M', qty: 1 },
    { productId: 'robe', color: 'Rouge', size: 'M', qty: 1 }, { productId: 'brouillon', qty: 1 }, { productId: 'inconnu', qty: 1, title: 'Vieux' }
  ], zoneId: 'bukavu' });
  assert.equal(d.lignes.length, 4);
  assert.equal(d.lignes[0].qty, 3);
  assert.deepEqual(d.problemes.map((p) => p.code), ['stock', 'option', 'article', 'article']);
  assert.match(d.problemes[0].message, /Plus que 2 exemplaires/);
});

test('remise : minimum et expiration', () => {
  assert.equal(R.verifierRemise(remise10, 'BIENVENUE10', 10).ok, false);
  assert.equal(R.verifierRemise({ ...remise10, endsAt: Date.now() - 1000 }, 'BIENVENUE10', 30).ok, false);
  assert.equal(R.verifierRemise({ type: 'fixed', value: 50 }, 'FIXE', 20).amount, 20);
  assert.equal(R.verifierRemise({ type: 'percent', value: 99 }, 'GROS', 100).amount, 90);
});

const saisie = (extra) => Object.assign({
  termsAccepted: true, customer: { name: 'Grâce Mapendo', phone: '0991234567' },
  shipping: { zoneId: 'bukavu', address: 'Nyawera, av. Lumumba 12' },
  items: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 1 }, { productId: 'montre', qty: 1 }],
  payment: { method: 'mpesa', ref: 'ABC123XYZ' }, total: 37.5
}, extra || {});

test('commande : construction correcte et réservation', () => {
  const { commande, reserve } = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'K7P2Q' });
  assert.equal(commande.total, 37.5);
  assert.deepEqual(commande.issues, []);
  assert.equal(commande.payment.label, 'M-Pesa');
  assert.equal(commande.payment.status, 'pending');
  assert.equal(commande.items[0].cost, 8);
  assert.deepEqual(reserve, [{ productId: 'robe', key: 'Noir|M', qty: 1, import: false }, { productId: 'montre', key: '', qty: 1, import: true }]);
  const apres = R.ajusterStock(produits.robe, reserve.filter((r) => r.productId === 'robe'), -1);
  assert.equal(apres.variants['Noir|M'], 1);
  assert.equal(apres.sold, 2);
});

test('commande : erreurs de saisie bloquantes', () => {
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ termsAccepted: false }) }), /conditions/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ customer: { name: 'X', phone: '0991234567' } }) }), /nom/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ payment: { method: 'cod' } }) }), /mode de paiement/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ payment: { method: 'airtel', ref: 'ABC123' } }) }), /mode de paiement/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ payment: { method: 'mpesa', ref: '!' } }) }), /transaction/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ shipping: { zoneId: 'bukavu', address: '' } }) }), /adresse/);
  const ok = R.preparerCommande({ cfg, produit, saisie: saisie({ shipping: { zoneId: 'retrait' }, total: 35.5 }) });
  assert.equal(ok.commande.shipping.pickup, true);
  assert.deepEqual(ok.commande.issues, []);
});

test('commande payée mais catalogue modifié : enregistrée avec points à vérifier', () => {
  const { commande, reserve } = R.preparerCommande({ cfg, produit, saisie: saisie({ items: [{ productId: 'robe', color: 'Noir', size: 'L', qty: 1 }], total: 22 }) });
  assert.equal(commande.issues.length, 1);
  assert.match(commande.issues[0], /épuisé/);
  assert.deepEqual(reserve, []);
  const t = R.preparerCommande({ cfg, produit, saisie: saisie({ total: 30 }) });
  assert.match(t.commande.issues[0], /total recalculé/);
});

test('étapes de commande : paiement, expédition, annulation et stock', () => {
  const { commande } = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'AAAAA' });
  assert.throws(() => R.etapeCommande(commande, 'shipped'), /paiement/);
  const p1 = R.etapeCommande(commande, 'paid');
  assert.equal(p1.commande.payment.status, 'paid');
  assert.equal(p1.stock, '');
  const p2 = R.etapeCommande(p1.commande, 'shipped');
  assert.equal(p2.commande.fulfillment, 'shipped');
  const p3 = R.etapeCommande(p2.commande, 'cancel');
  assert.equal(p3.stock, 'restituer');
  assert.equal(p3.entrees.length, 2);
  assert.equal(p3.commande.stockApplied, false);
  const p4 = R.etapeCommande(p3.commande, 'reopen');
  assert.equal(p4.stock, 'reserver');
  const fin = R.etapeCommande(R.etapeCommande(p4.commande, 'delivered').commande, 'note', { note: 'Client ravi' });
  assert.equal(fin.commande.adminNote, 'Client ravi');
  assert.throws(() => R.etapeCommande(fin.commande, 'cancel'), /livrée/);
  assert.deepEqual(R.statutClient(fin.commande), { label: 'Livrée', ton: 'ok', etape: 4 });
});

test('ancienne commande sans réservation : stock réservé au paiement', () => {
  const ancienne = { status: 'open', payment: { status: 'pending' }, fulfillment: 'unfulfilled', items: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 1, source: 'local' }] };
  const r = R.etapeCommande(ancienne, 'paid', { produit });
  assert.equal(r.stock, 'reserver');
  assert.deepEqual(r.entrees, [{ productId: 'robe', key: 'Noir|M', qty: 1, import: false }]);
});

test('numéro de commande et montants', () => {
  assert.match(R.numeroCommande(), /^[A-Z2-9]{5}$/);
  assert.equal(R.dollars(1234.5), '$1 234.50');
  assert.equal(R.arrondi(1.005), 1.01);
  assert.deepEqual(R.incoherences({ items: [{ price: 10, qty: 2 }], subtotal: 20, shippingFee: 2, total: 22 }), []);
});
