// Tests de la recherche tolérante aux fautes : node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/commun/js/recherche.js');
const exemple = require('../src/admin/public/exemple-catalogue.json');

const rayons = new Map(exemple.collections.map((c) => [c.id, c.name]));
const index = S.indexer(exemple.products, (p) => (p.collectionIds || []).map((id) => rayons.get(id)));
const titres = (q) => S.chercher(index, q).resultats.map((x) => x.p.title);
const premier = (q) => titres(q)[0] || '';

test('mots : accents, pluriels, sons proches, fautes comptées', () => {
  assert.equal(S.normaliser('Écouteurs Œuvre'), 'ecouteurs oeuvre');
  assert.deepEqual(S.decouper('Boucles d’oreilles').map((m) => m.brut), ['boucles', 'd', 'oreilles']);
  assert.equal(S.racine('montres'), S.racine('montre'));
  assert.equal(S.racine('chaussures'), S.racine('chaussure'));
  assert.equal(S.son('telefone'), S.son('telephone'));
  assert.equal(S.son('chosure'), S.son('chaussure'));
  assert.equal(S.son('bracele'), S.son('bracelet'));
  assert.notEqual(S.son('lunette'), S.son('lune'));
  assert.equal(S.distance('monter', 'montre', 1), 1, 'deux lettres inversées : une seule faute');
  assert.equal(S.distance('mntre', 'montre', 1), 1);
  assert.equal(S.distance('saa', 'montre', 3), 4, 'au-delà du maximum : maximum + 1');
});

test('fautes de frappe et d’orthographe : le bon article d’abord, la recherche corrigée', () => {
  for (const q of ['monter', 'mntre', 'Montre', 'MONTRES', 'montré']) assert.match(premier(q), /^Montre/, q);
  assert.equal(S.chercher(index, 'monter').correction, 'montre');
  assert.equal(titres('monter').length, 3, 'les résultats de la recherche corrigée, rien d’autre');
  assert.equal(S.chercher(index, 'montre').correction, '', 'bien écrit : pas de correction');
  assert.match(premier('chemize'), /^Chemise/);
  assert.match(premier('baterie'), /^Batterie/);
  assert.match(premier('lunetes'), /^Lunettes/);
  assert.equal(S.chercher(index, 'lunetes').correction, 'lunettes');
  assert.match(premier('colier'), /^Colliers/);
  assert.match(premier('ecouter'), /^Écouteurs/);
  assert.equal(S.chercher(index, 'enceinte blutooth').correction, 'enceinte bluetooth');
  assert.match(premier('chosure'), /^Escarpins/, 'son proche de « chaussure »');
});

test('autres langues et synonymes : swahili, anglais, couleurs', () => {
  assert.ok(titres('saa').every((t) => /^Montre/.test(t)) && titres('saa').length === 3, 'saa → montres');
  assert.match(premier('viatu'), /^Escarpins/);
  assert.deepEqual(titres('mkoba').sort(), ['Cartable en cuir gris', 'Sac bandoulière en cuir camel', 'Sac à dos en cuir marron']);
  assert.match(premier('watch'), /^Montre/);
  const rouge = S.chercher(index, 'robe rouge');
  assert.ok(rouge.complet && rouge.resultats[0].p.title === 'Robe midi bordeaux', 'rouge trouve le bordeaux');
  assert.match(premier('smartw'), /^Montre/, 'début d’un mot anglais');
});

test('précision : rien de parasite, articles proches quand un mot manque', () => {
  assert.deepEqual(titres('robe'), ['Robe midi bordeaux'], '« robe » ne trouve pas « rose »');
  assert.deepEqual(titres('avion'), []);
  assert.deepEqual(titres('bracelet or'), ['Bracelet or rose serti']);
  assert.deepEqual(titres('sac cuir').slice(0, 2).sort(), ['Sac bandoulière en cuir camel', 'Sac à dos en cuir marron']);
  assert.ok(titres('sac cuir').includes('Cartable en cuir gris'));
  const verte = S.chercher(index, 'robe verte');
  assert.equal(verte.complet, false);
  assert.equal(verte.resultats[0].p.title, 'Robe midi bordeaux');
  assert.deepEqual(S.chercher(index, '   ').resultats, []);
  assert.deepEqual(S.chercher(S.indexer([], () => []), 'montre').resultats, []);
});

test('suggestions pendant la frappe : catalogue, fautes et recherches fréquentes', () => {
  const mon = S.suggestions(index, 'mon', ['montre connectee']);
  assert.equal(mon[0], 'montre connectée', 'recherche fréquente en tête');
  assert.ok(mon.includes('montre classique') && mon.length <= 6);
  assert.deepEqual(S.suggestions(index, 'montre c').sort(), ['montre classique', 'montre connectée']);
  assert.equal(S.suggestions(index, 'lunt')[0], 'lunettes', 'début de mot mal écrit');
  assert.equal(S.suggestions(index, 'chau')[0], 'chaussures');
  assert.ok(S.suggestions(index, 'boucl').includes('boucles d’oreilles'), 'apostrophe gardée');
  assert.deepEqual(S.suggestions(index, 'm'), [], 'deux lettres au moins');
  assert.ok(!S.suggestions(index, 'sac').includes('sac'), 'pas la recherche elle-même');
});

test('recherches populaires montrées à tous : seulement des mots du catalogue qui trouvent des articles', () => {
  assert.deepEqual(S.populairesSures(index, ['montre connectee', 'mot-grossier', 'sacs', 'avion', 'montre connectée']), ['montre connectée', 'sacs']);
  assert.deepEqual(S.populairesSures(index, ['sac a dos']), ['sac à dos'], 'écrite comme dans le catalogue');
  assert.deepEqual(S.populairesSures(index, []), []);
});

test('rapide sur un grand catalogue', () => {
  const grand = Array.from({ length: 800 }, (_, i) => ({ ...exemple.products[i % exemple.products.length], id: 'p' + i, title: exemple.products[i % exemple.products.length].title + ' modèle ' + i }));
  const t0 = Date.now(); const ix = S.indexer(grand, () => ['Montres', 'Sacs']); const t1 = Date.now();
  S.chercher(ix, 'montre connecte'); S.suggestions(ix, 'mont'); const t2 = Date.now();
  assert.ok(t1 - t0 < 1500, `index : ${t1 - t0} ms`);
  assert.ok(t2 - t1 < 500, `recherche et suggestions : ${t2 - t1} ms`);
});
