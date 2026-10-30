// Tests des règles métier partagées : node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/commun/js/regles.js');

const cfg = R.config({ payments: { mpesa: { enabled: true }, airtel: { enabled: false } }, freeShippingOver: 50, payment: { provider: 'simulation' } });
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
  assert.equal(R.valider.mobileMoney('+243 81 234 5678'), '0812345678');
  assert.equal(R.valider.mobileMoney('+250788123456'), '');
  assert.equal(R.valider.codePromo('bienvenue10'), 'BIENVENUE10');
});

test('configuration : zones et retrait', () => {
  assert.equal(cfg.zones.length, 3);
  assert.equal(R.estRetrait(R.zoneDe(cfg, 'retrait')), true);
  assert.equal(R.estRetrait(R.zoneDe(cfg, 'bukavu')), false);
  assert.deepEqual(R.moyensDePaiement(cfg).map((m) => m.k), ['mpesa', 'orange'], 'Airtel désactivé, Afrimoney et Illico désactivés par défaut');
  const vide = R.config({ zones: [] });
  assert.equal(vide.zones.length, 3);
  assert.equal(vide.payment.provider, '');
  assert.deepEqual(R.moyensDePaiement(vide), [], 'sans fournisseur de paiement, la boutique n’encaisse pas');
  assert.equal(vide.serviceFeePct, 2);
  assert.deepEqual(R.moyensDePaiement(R.config({ payment: { provider: 'flexpay' }, payments: { illico: { enabled: true } } })).map((m) => m.k), ['mpesa', 'airtel', 'orange']);
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
  assert.equal(d.frais, 0.92, 'frais de service : 2 % de 45,90 $');
  assert.equal(d.total, 48.82);
});

test('livraison offerte au-delà du seuil', () => {
  const d = R.devis({ cfg, produit, lignes: [{ productId: 'montre', qty: 4 }], zoneId: 'goma' });
  assert.equal(d.sousTotal, 62);
  assert.equal(d.livraison, 0);
  assert.equal(d.frais, 1.24);
  assert.equal(d.total, 63.24);
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
  payment: { method: 'mpesa', phone: '' }, total: 38.21
}, extra || {});

test('commande : construction, frais de service, livraison estimée et réservation', () => {
  const t0 = Date.UTC(2026, 9, 25, 9);
  const { commande, reserve } = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'K7P2QA', maintenant: t0 });
  assert.equal(commande.total, 38.21);
  assert.equal(commande.serviceFee, 0.71);
  assert.equal(commande.serviceFeePct, 2);
  assert.equal(commande.payment.label, 'M-Pesa');
  assert.equal(commande.payment.phone, '0991234567', 'numéro de contact par défaut');
  assert.equal(commande.payment.status, 'pending');
  assert.equal(commande.payment.test, true);
  assert.equal(commande.expiresAt, t0 + 30 * 60000);
  assert.equal(commande.delivery.days, 21, 'import Chine (20 jours) + Bukavu (1 jour)');
  assert.equal(commande.items[0].cost, 8);
  assert.deepEqual(reserve, [{ productId: 'robe', key: 'Noir|M', qty: 1, import: false }, { productId: 'montre', key: '', qty: 1, import: true }]);
  const apres = R.ajusterStock(produits.robe, reserve.filter((r) => r.productId === 'robe'), -1);
  assert.equal(apres.variants['Noir|M'], 1);
  assert.equal(apres.sold, 2);
  assert.equal(R.livraisonEstimee(cfg, [{ source: 'local' }], R.zoneDe(cfg, 'goma'), t0).days, 2);
  assert.equal(R.livraisonEstimee(cfg, [{ source: 'local' }], R.zoneDe(cfg, 'retrait'), t0).days, 0);
});

test('commande : erreurs bloquantes, avant tout paiement', () => {
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ termsAccepted: false }) }), /conditions/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ customer: { name: 'X', phone: '0991234567' } }) }), /nom/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ payment: { method: 'cod' } }) }), /mode de paiement/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ payment: { method: 'airtel' } }) }), /mode de paiement/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ payment: { method: 'mpesa', phone: '+250788123456' } }) }), /M-Pesa invalide/);
  assert.throws(() => R.preparerCommande({ cfg, produit, saisie: saisie({ shipping: { zoneId: 'bukavu', address: '' } }) }), /adresse/);
  assert.throws(() => R.preparerCommande({ cfg: R.config({}), produit, saisie: saisie() }), /pas encore ouvert/);
  const ok = R.preparerCommande({ cfg, produit, saisie: saisie({ shipping: { zoneId: 'retrait' }, total: 36.21 }) });
  assert.equal(ok.commande.shipping.pickup, true);
  assert.equal(ok.commande.total, 36.21);
});

test('commande : stock épuisé ou total changé, le client ne paie pas', () => {
  const e1 = (() => { try { R.preparerCommande({ cfg, produit, saisie: saisie({ items: [{ productId: 'robe', color: 'Noir', size: 'L', qty: 1 }], total: 22.4 }) }); } catch (e) { return e; } })();
  assert.ok(e1 instanceof R.ErreurCommande);
  assert.equal(e1.champ, 'panier');
  assert.match(e1.message, /épuisé/);
  const e2 = (() => { try { R.preparerCommande({ cfg, produit, saisie: saisie({ total: 30 }) }); } catch (e) { return e; } })();
  assert.equal(e2.champ, 'total');
  assert.match(e2.message, /38\.21/);
});

test('paiement automatique : demande, refus, nouvelle tentative, confirmation', () => {
  const t0 = Date.now();
  let o = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'AAAAAA', maintenant: t0 }).commande;
  o = R.paiementEnvoye(o, { maintenant: t0, providerId: 'SIM-1' });
  assert.equal(o.payment.attempts, 1);
  assert.equal(R.enAttentePaiement(o), true);
  assert.equal(R.aTraiter(o), false, 'une commande non payée n’est pas à préparer');
  assert.deepEqual(R.statutClient(o), { label: 'Paiement en cours', ton: 'warn', etape: 0 });
  o = R.paiementEchoue(o, { maintenant: t0 + 1000, raison: 'Solde insuffisant' });
  assert.equal(o.payment.status, 'failed');
  assert.equal(R.statutClient(o).label, 'Paiement non abouti');
  assert.equal(R.relancePossible(o, t0 + 2000), '');
  o = R.paiementEnvoye(o, { maintenant: t0 + 2000, providerId: 'SIM-2', methode: 'mpesa', telephone: '0812345678' });
  assert.equal(o.payment.attempts, 2);
  assert.equal(o.payment.phone, '0812345678');
  const r = R.paiementConfirme(o, { maintenant: t0 + 3000, reference: 'MP261025.1200.A12345' });
  assert.equal(r.stock, '');
  assert.equal(r.commande.payment.status, 'paid');
  assert.equal(r.commande.payment.reference, 'MP261025.1200.A12345');
  assert.equal(R.aTraiter(r.commande), true);
  assert.equal(R.statutClient(r.commande).label, 'Payée');
  assert.equal(R.paiementConfirme(r.commande, { maintenant: t0 + 4000 }).commande.timeline.length, r.commande.timeline.length, 'confirmation répétée sans effet');
  assert.match(R.relancePossible(r.commande), /déjà payée/);
});

test('paiement non reçu à temps : annulation automatique, stock rendu ; paiement tardif : commande rouverte', () => {
  const t0 = Date.now();
  let o = R.paiementEnvoye(R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'BBBBBB', maintenant: t0 }).commande, { maintenant: t0, providerId: 'SIM-3' });
  assert.match(R.relancePossible(o, t0 + 31 * 60000), /délai/);
  const ex = R.paiementExpire(o, { maintenant: t0 + 31 * 60000 });
  assert.equal(ex.stock, 'restituer');
  assert.equal(ex.entrees.length, 2);
  assert.equal(R.nonAboutie(ex.commande), true);
  assert.equal(R.statutClient(ex.commande).label, 'Annulée : paiement non reçu');
  assert.throws(() => R.etapeCommande(ex.commande, 'reopen'), /jamais arrivé/);
  const tard = R.paiementConfirme(ex.commande, { maintenant: t0 + 32 * 60000, reference: 'TARD' });
  assert.equal(tard.stock, 'reserver');
  assert.equal(tard.commande.status, 'open');
  assert.equal(tard.commande.payment.status, 'paid');
  assert.match(tard.commande.issues[0], /après l’annulation/);
  let n = R.paiementEnvoye(R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'CCCCCC', maintenant: t0 }).commande, { maintenant: t0, providerId: 'x' });
  for (let i = 0; i < 4; i++) n = R.paiementEnvoye(R.paiementEchoue(n, { maintenant: t0, raison: 'refus' }), { maintenant: t0, providerId: 'x' + i });
  assert.match(R.relancePossible(n, t0), /Trop de tentatives/);
});

test('étapes de commande : expédition, annulation et stock', () => {
  const { commande } = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'DDDDDD' });
  assert.throws(() => R.etapeCommande(commande, 'shipped'), /paiement/);
  const p1 = R.paiementConfirme(commande, { reference: 'X' });
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
  assert.equal(R.margeCommande(fin.commande).marge, 22.21, 'articles 35,50 + frais 0,71 − coûts 14');
  const manuel = R.etapeCommande(commande, 'paid');
  assert.equal(manuel.commande.payment.manual, true);
});

test('ancienne commande sans réservation : stock réservé au paiement', () => {
  const ancienne = { status: 'open', payment: { status: 'pending' }, fulfillment: 'unfulfilled', items: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 1, source: 'local' }] };
  const r = R.etapeCommande(ancienne, 'paid', { produit });
  assert.equal(r.stock, 'reserver');
  assert.deepEqual(r.entrees, [{ productId: 'robe', key: 'Noir|M', qty: 1, import: false }]);
});

test('numéro de commande et montants', () => {
  assert.match(R.numeroCommande(), /^[A-Z2-9]{6}$/);
  assert.equal(R.numeroNettoye(' #k7p2qa '), 'K7P2QA');
  assert.equal(R.numeroValide('#K7P2QA'), true);
  assert.equal(R.numeroValide('K7'), false);
  assert.equal(R.dollars(1234.5), '$1 234.50');
  assert.equal(R.arrondi(1.005), 1.01);
  assert.deepEqual(R.incoherences({ items: [{ price: 10, qty: 2 }], subtotal: 20, shippingFee: 2, total: 22 }), []);
  assert.deepEqual(R.incoherences({ items: [{ price: 10, qty: 2 }], subtotal: 20, shippingFee: 2, serviceFee: 0.4, total: 22.4 }), []);
});

test('comptes clients : code, numéro international, fusion du panier et des favoris', () => {
  assert.equal(R.codeConnexion(' 123 456 '), '123456');
  assert.equal(R.codeConnexion('12345'), '');
  assert.equal(R.telephoneInternational('0991234567'), '+243991234567');
  assert.equal(R.telephoneInternational('n’importe quoi'), '');
  const compte = { panier: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 1 }], favoris: ['sac'], profil: { zoneId: 'bukavu', address: '' }, dates: { 'panier:robe': 5, 'favori:sac': 7, 'favori:perdu': 9 } };
  const appareil = { panier: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 3 }, { productId: 'montre', qty: 1 }, { productId: '<x>', qty: 1 }], favoris: ['sac', 'montre'], profil: { zoneId: 'goma', address: 'Av. Lumumba 12' } };
  const f = R.fusionCompte(compte, appareil);
  assert.deepEqual(f.panier.map((l) => [l.productId, l.qty]), [['robe', 3], ['montre', 1]]);
  assert.deepEqual(f.favoris, ['sac', 'montre']);
  assert.equal(f.profil.zoneId, 'bukavu');
  assert.equal(f.profil.address, 'Av. Lumumba 12');
  assert.deepEqual(f.dates, { 'panier:robe': 5, 'favori:sac': 7 });
  const d = R.daterCompte(f, 100);
  assert.equal(d.dates['panier:robe'], 5);
  assert.equal(d.dates['panier:montre'], 100);
  assert.equal(R.docCompte({ favoris: Array.from({ length: 300 }, (_, i) => 'p' + i) }).favoris.length, R.MAX_FAVORIS);
});

test('prix par variante, vente flash et prix de gros', () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const robe = { title: 'Robe', price: 20, compareAt: 25, status: 'active', source: 'import', weight: 0.5,
    options: { colors: [{ name: 'Noir', hex: '#000' }], sizes: ['M', 'XL'] }, variantPrices: { 'Noir|XL': 24 },
    wholesale: [{ min: 6, pct: 10 }, { min: 3, pct: 5 }, { min: 1, pct: 50 }] };
  assert.equal(R.prixVariante(robe, 'Noir', 'M'), 20);
  assert.equal(R.prixVariante(robe, 'Noir', 'XL'), 24);
  assert.deepEqual(R.paliersGros(robe), [{ min: 3, pct: 5 }, { min: 6, pct: 10 }]);
  assert.equal(R.prixUnitaire(robe, 'Noir', 'M', 2, now), 20);
  assert.equal(R.prixUnitaire(robe, 'Noir', 'M', 3, now), 19);
  assert.equal(R.prixUnitaire(robe, 'Noir', 'XL', 6, now), 21.6);
  // Sans choix : le prix le plus bas, « dès », avec le prix barré de la fiche.
  assert.deepEqual(R.prixAffiche(robe, '', '', now), { prix: 20, barre: 25, pct: 20, flash: null, des: true });
  assert.equal(R.prixAffiche(robe, 'Noir', 'XL', now).barre, 0);
  // Vente flash : 20 % jusqu'à demain, rien avant le début ni après la fin.
  const flash = { ...robe, compareAt: 0, flash: { pct: 20, endsAt: now + R.JOUR } };
  assert.equal(R.prixAffiche(flash, 'Noir', 'XL', now).prix, 19.2);
  assert.equal(R.prixAffiche(flash, 'Noir', 'XL', now).barre, 24);
  assert.equal(R.prixUnitaire(flash, 'Noir', 'M', 3, now), 15.2);
  assert.equal(R.venteFlash(flash, now + 2 * R.JOUR), null);
  assert.equal(R.venteFlash({ ...flash, flash: { pct: 20, startsAt: now + 1000, endsAt: now + R.JOUR } }, now), null);
  // Devis : le palier compte toutes les pièces de l'article ; supplément au kilo selon la zone.
  const c = R.config({ zones: [{ id: 'bukavu', name: 'Bukavu', fee: 2, days: 1, perKg: 3 }], payment: { provider: 'simulation' } });
  const dv = R.devis({ cfg: c, produit: () => robe, lignes: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 'robe', color: 'Noir', size: 'XL', qty: 1 }], zoneId: 'bukavu', maintenant: now });
  assert.deepEqual(dv.lignes.map((l) => [l.price, l.basePrice, l.wholesale]), [[19, 20, 5], [22.8, 24, 5]]);
  assert.equal(dv.sousTotal, 60.8);
  assert.equal(dv.poids, 1.5);
  assert.equal(dv.livraison, 6.5);
});

test('panier partagé : lien court et lisible, lu à l’identique, lignes invalides écartées', () => {
  const lignes = [{ productId: 'robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 'sac', qty: 1 }, { productId: 'montre', size: 'XL', qty: 1 }, { productId: 'robe', color: 'Bleu marine: foncé', size: 'L', qty: 3 }];
  const q = R.lienPanier(lignes);
  assert.equal(q, 'a=robe:2:Noir:M&a=sac&a=montre:1::XL&a=robe:3:Bleu%20marine%3A%20fonc%C3%A9:L');
  assert.deepEqual(R.panierDepuisLien('?' + q), R.panierCompte(lignes));
  // Lien réencodé par une application (« : » devenu %3A, espaces en +) : les articles sont retrouvés.
  assert.deepEqual(R.panierDepuisLien('a=robe%3A2%3ANoir%3AM&a=sac'), [{ productId: 'robe', color: 'Noir', size: 'M', qty: 2 }, { productId: 'sac', color: '', size: '', qty: 1 }]);
  // Identifiant invalide, quantité nulle, doublon, autre paramètre : ignorés ; quantité bornée à MAX_QTE.
  assert.deepEqual(R.panierDepuisLien('a=MAUVAIS ID:2&a=sac:0&a=sac:999&a=sac:1&utm_source=wa&a=&a=%E0'), [{ productId: 'sac', color: '', size: '', qty: R.MAX_QTE }]);
  // Au plus MAX_LIGNES_PARTAGE lignes, dans les deux sens.
  const beaucoup = Array.from({ length: 40 }, (_, i) => ({ productId: 'p' + i, qty: 1 }));
  assert.equal(R.panierDepuisLien(R.lienPanier(beaucoup)).length, R.MAX_LIGNES_PARTAGE);
  assert.deepEqual(R.panierDepuisLien(''), []);
  assert.deepEqual(R.panierDepuisLien('?'), []);
  assert.deepEqual(R.panierDepuisLien(null), []);
});

test('panier partagé : aperçu aux prix et au stock du jour (message, aperçu du lien et page identiques)', () => {
  const a = R.apercuPartage({ cfg, produit, lignes: [{ productId: 'robe', color: 'Noir', size: 'M', qty: 5 }, { productId: 'robe', color: 'Noir', size: 'L', qty: 1 }, { productId: 'robe', color: 'Rouge', size: 'M', qty: 1 }, { productId: 'montre', qty: 2 }, { productId: 'brouillon', qty: 1 }, { productId: 'inconnu', qty: 1 }] });
  assert.deepEqual(a.lignes.map((l) => [l.productId, l.qty, l.demandee, l.probleme]), [['robe', 2, 5, ''], ['robe', 1, 1, 'epuise'], ['robe', 1, 1, 'option'], ['montre', 2, 2, ''], ['brouillon', 1, 1, 'retiré'], ['inconnu', 1, 1, 'retiré']]);
  assert.equal(a.n, 4);
  // Robe 2 × $20 (stock restant) + montre 2 × $15.50 = $71 ; frais de service 2 % ; livraison non comprise.
  assert.deepEqual([a.sousTotal, a.frais, a.total], [71, 1.42, 72.42]);
  assert.deepEqual(R.apercuPartage({ cfg, produit, lignes: [] }), { lignes: [], disponibles: [], n: 0, sousTotal: 0, frais: 0, total: 0 });
});

test('équipe : rôles, droits et étapes permises', () => {
  assert.equal(R.roleNettoye(''), 'proprietaire', 'les comptes créés avant les rôles sont ceux du propriétaire');
  assert.equal(R.roleNettoye('inconnu'), 'proprietaire');
  assert.equal(R.roleNettoye('livreur'), 'livreur');
  assert.equal(R.peut('', 'reglages'), true);
  assert.equal(R.peut('vendeur', 'produits'), true);
  assert.equal(R.peut('vendeur', 'reglages'), false);
  assert.equal(R.peut('vendeur', 'equipe'), false);
  assert.equal(R.peut('vendeur', 'remises'), false);
  assert.equal(R.peut('livreur', 'livraisons'), true);
  assert.equal(R.peut('livreur', 'commandes'), false);
  assert.equal(R.etapePermise('proprietaire', 'refund'), true);
  assert.equal(R.etapePermise('vendeur', 'shipped'), true);
  assert.equal(R.etapePermise('vendeur', 'refund'), false);
  assert.equal(R.etapePermise('livreur', 'delivered'), true);
  assert.equal(R.etapePermise('livreur', 'cancel'), false);
  assert.equal(R.etapePermise('livreur', 'paid'), false);
  const { commande } = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'EEEEEE' });
  assert.equal(R.pourLivreur(commande), false, 'pas encore payée');
  const payee = R.paiementConfirme(commande, { reference: 'X' }).commande;
  assert.equal(R.pourLivreur(payee), true);
  assert.equal(R.pourLivreur(R.etapeCommande(payee, 'cancel').commande), false, 'annulée');
  assert.equal(R.pourLivreur({ ...payee, shipping: { ...payee.shipping, pickup: true } }), false, 'retrait en boutique');
});

test('notifications : chaque étape d’une commande payée prévient le client, une seule fois', () => {
  const t0 = Date.UTC(2026, 9, 30, 9);
  const { commande } = R.preparerCommande({ cfg, produit, saisie: saisie(), numero: 'NOTIF2', maintenant: t0 });
  assert.deepEqual(R.evenementsCommande({}, commande), [], 'commande non payée : rien');
  const payee = R.paiementConfirme(commande, { reference: 'X' }).commande;
  assert.deepEqual(R.evenementsCommande(commande, payee).map((e) => e.type), ['payee']);
  assert.deepEqual(R.evenementsCommande(payee, payee), [], 'rien de nouveau : rien');
  const prep = R.etapeCommande(payee, 'preparing').commande;
  const route = R.etapeCommande(prep, 'shipped').commande;
  assert.deepEqual([R.evenementsCommande(payee, prep), R.evenementsCommande(prep, route)].map((l) => l.map((e) => e.type)), [['preparation'], ['expediee']]);
  assert.deepEqual(R.evenementsCommande(route, R.etapeCommande(route, 'note', { note: 'x' }).commande), [], 'note interne : rien');
  const annulee = R.etapeCommande(route, 'cancel').commande;
  assert.deepEqual(R.evenementsCommande(route, annulee).map((e) => e.type), ['annulee']);
  assert.deepEqual(R.evenementsCommande(annulee, R.etapeCommande(annulee, 'refund').commande).map((e) => e.type), ['remboursee']);
  const retrait = { ...payee, shipping: { ...payee.shipping, pickup: true } };
  assert.deepEqual(R.evenementsCommande(retrait, R.etapeCommande(retrait, 'shipped').commande).map((e) => e.type), ['prete']);
  const expiree = R.paiementExpire(commande, { maintenant: t0 + 3600e3 }).commande;
  assert.deepEqual(R.evenementsCommande(commande, expiree).map((e) => e.type), ['expiree']);
  const ev = R.evenementsCommande(prep, route)[0];
  assert.deepEqual(R.texteNotification(ev, 'fr'), { titre: 'Commande en route', texte: 'Commande #NOTIF2 : le livreur est en route (Bukavu).' });
  assert.equal(R.texteNotification({ type: 'expediee', details: { numero: 'A' } }, 'xx').texte, 'Commande #A : le livreur est en route.', 'langue inconnue : français, détail absent retiré');
  assert.equal(R.texteNotification({ type: 'inconnu' }, 'fr'), null);
});

test('« Prévenez-moi » et annonces : option suivie, retour en stock, textes et liens permis', () => {
  const robe = { title: 'Robe wax', price: 20, options: { colors: [{ name: 'Rouge' }, { name: 'Bleu' }], sizes: ['M', 'L'] }, variants: { 'Rouge|M': 0, 'Rouge|L': 2, 'Bleu|M': 0, 'Bleu|L': 0 } };
  assert.equal(R.varianteAlerte(robe, ''), '', 'article entier');
  assert.equal(R.varianteAlerte(robe, '|'), '', 'article sans option');
  assert.equal(R.varianteAlerte(robe, 'Rouge|M'), 'Rouge|M');
  assert.equal(R.varianteAlerte(robe, 'Vert|M'), null, 'option inconnue');
  assert.equal(R.alerteDisponible(robe, 'Rouge|M'), false);
  assert.equal(R.alerteDisponible(robe, 'Rouge|L'), true);
  assert.equal(R.alerteDisponible(robe, ''), true, 'une option en stock suffit pour l’article entier');
  assert.equal(R.alerteDisponible({ ...robe, variants: {} }, ''), false);
  assert.equal(R.alerteDisponible({ ...robe, status: 'draft' }, 'Rouge|L'), false, 'brouillon : pas encore');
  assert.equal(R.alerteDisponible({ title: 'Montre', stock: 0, source: 'import' }, ''), true, 'vendu sur commande : disponible');
  assert.equal(R.alerteDisponible({ title: 'Sac', stock: 3 }, ''), true);
  assert.equal(R.libelleVariante('Rouge|M'), 'Rouge / M');
  assert.equal(R.libelleVariante('|42'), '42');
  assert.deepEqual(R.texteNotification({ type: 'stock', details: { titre: 'Robe wax', option: 'Rouge / M' } }, 'fr'),
    { titre: 'De retour en stock', texte: '« Robe wax » (Rouge / M) est de nouveau disponible. Les quantités sont limitées : ne tardez pas !' });
  assert.equal(R.texteNotification({ type: 'stock', details: { titre: 'Sac', option: '' } }, 'fr').texte.indexOf('« Sac » est de nouveau'), 0, 'sans option : pas de parenthèses vides');
  assert.deepEqual(R.texteNotification({ type: 'promo', details: { titre: 'Arrivage', texte: '40 modèles dès $8.' } }, 'fr'), { titre: 'Arrivage', texte: '40 modèles dès $8.' });
  assert.deepEqual(R.annonceNettoyee({ titre: '  Arrivage   wax ', texte: 'Nouveaux\nmodèles', url: '/c/abc123/pagnes' }), { titre: 'Arrivage wax', texte: 'Nouveaux modèles', url: '/c/abc123/pagnes' });
  assert.equal(R.annonceNettoyee({ titre: 'Promo', texte: 'Tout à −20 %' }).url, '/');
  for (const url of ['/', '/nouveautes', '/en-stock', '/import-chine', '/p/ex-p08/robe-wax', '/p/abc']) assert.equal(R.annonceNettoyee({ titre: 'Promo', texte: 'Tout à −20 %', url }).url, url);
  for (const url of ['https://exemple.com', '//exemple.com', '/p/../admin', 'javascript:alert(1)', '/compte?x=1']) assert.throws(() => R.annonceNettoyee({ titre: 'Promo', texte: 'Tout à −20 %', url }), /Lien invalide/);
  assert.throws(() => R.annonceNettoyee({ titre: 'P', texte: 'Tout à −20 %' }), /titre/);
  assert.throws(() => R.annonceNettoyee({ titre: 'Promo', texte: '' }), /message/);
  assert.equal(R.annonceNettoyee({ titre: 'x'.repeat(90), texte: 'y'.repeat(300) }).titre.length, 60);
});
