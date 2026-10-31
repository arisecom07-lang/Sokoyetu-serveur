// Tests des langues de la boutique (anglais, swahili, lingala) : chaque texte traduit, parties variables gardées,
// messages du serveur reconnus, notifications dans chaque langue. node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../outils/langues.cjs');
const R = require('../src/commun/js/regles.js');

const liste = L.textes();
const trous = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

test('chaque texte de la boutique est traduit, sans texte oublié dans les dictionnaires', () => {
  assert.ok(liste.size > 900, `${liste.size} textes relevés`);
  for (const k of L.LANGUES) {
    const d = L.dictionnaire(k);
    assert.deepEqual(L.manquants(k, liste), [], `${L.NOMS[k]} : textes sans traduction (node outils/langues.cjs)`);
    assert.deepEqual(Object.keys(d).filter((x) => !liste.has(x)), [], `${L.NOMS[k]} : textes qui ne sont plus dans le code`);
  }
});

test('parties variables gardées, singulier et pluriel là où il faut', () => {
  for (const k of L.LANGUES) {
    const d = L.dictionnaire(k);
    for (const [fr, info] of liste) {
      const x = d[fr];
      if (Array.isArray(x)) {
        assert.ok(info.pluriel, `${k} : « ${fr} » n'a pas de pluriel en français`);
        assert.equal(x.length, 2, `${k} : « ${fr} » : [singulier, pluriel]`);
      }
      for (const y of Array.isArray(x) ? x : [x]) {
        assert.equal(typeof y, 'string', `${k} : « ${fr} »`);
        assert.ok(y.trim() || !fr.trim(), `${k} : « ${fr} » est vide`);
        assert.ok(trous(y) === trous(fr) || (info.pluriel && trous(y) === trous(info.pluriel)), `${k} : « ${fr} » → « ${y} » : ${trous(fr)} attendus`);
      }
    }
  }
});

test('les messages du serveur traduits existent toujours côté serveur', () => {
  const dossier = path.join(__dirname, '..', 'serveur', 'pb_hooks');
  const sources = [fs.readFileSync(path.join(__dirname, '..', 'src', 'commun', 'js', 'regles.js'), 'utf8')];
  (function lire(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) lire(p); else if (n.endsWith('.js')) sources.push(fs.readFileSync(p, 'utf8')); } })(dossier);
  const tout = sources.join('\n');
  for (const m of L.MESSAGES_SERVEUR) {
    // Chaque morceau fixe du message (entre les parties variables) figure dans le code du serveur.
    const morceaux = m.split(/\{\w+\}/).map((x) => x.trim()).filter((x) => x.length >= 6 && !/exemplaire/.test(x));
    for (const x of morceaux) assert.ok(tout.includes(x), `message du serveur introuvable (modifié ?) : « ${m} » (« ${x} »)`);
  }
});

test('traduction à l’affichage : textes, pluriels, éléments, messages du serveur, retour au français', async () => {
  const dicos = Object.fromEntries(L.LANGUES.map((k) => [k, 'data:application/json,' + encodeURIComponent(JSON.stringify(L.dictionnaire(k)))]));
  globalThis.__LANGUES__ = dicos;
  const T = await import('../src/commun/js/langue.js');
  assert.equal(T.t('Ajouter au panier'), 'Ajouter au panier', 'français par défaut');
  assert.equal(T.traduireMessage('Votre panier est vide.'), 'Votre panier est vide.');
  assert.equal(await T.choisirLangue('en', { garder: false }), true);
  assert.equal(T.langue.value, 'en');
  assert.equal(T.t('Ajouter au panier'), 'Add to basket');
  assert.equal(T.t('Payer {0}', ['$5.00']), 'Pay $5.00');
  assert.equal(T.t('Texte absent du dictionnaire'), 'Texte absent du dictionnaire', 'sans traduction : le français');
  assert.equal(T.tn(1, '{n} article', '{n} articles'), '1 item');
  assert.equal(T.tn(3, '{n} article', '{n} articles'), '3 items');
  assert.equal(T.pluriel(2, 'avis', 'avis'), '2 reviews');
  const el = { type: 'b' };
  assert.deepEqual(T.tx('Payer {0}', [el]), ['Pay ', el]);
  // Messages du serveur : tels quels, avec parties variables, ou plusieurs phrases à la suite
  assert.equal(T.traduireMessage('Votre panier est vide.'), 'Your basket is empty.');
  assert.equal(T.traduireMessage('Numéro M-Pesa invalide : 10 chiffres, commençant par 08 ou 09.'), 'Invalid M-Pesa number: 10 digits, starting with 08 or 09.');
  assert.equal(T.traduireMessage('« Robe wax » (Rouge / M) est épuisé.'), '“Robe wax” (Rouge / M) is sold out.');
  assert.equal(T.traduireMessage('« Sac » est épuisé.'), '“Sac” is sold out.', 'partie variable vide');
  assert.equal(T.traduireMessage('« Sac » est épuisé. Choisissez une taille disponible pour « Robe ».'), '“Sac” is sold out. Choose an available size for “Robe”.');
  assert.equal(T.traduireMessage('Message inconnu du dictionnaire.'), 'Message inconnu du dictionnaire.');
  assert.equal(T.locale(), 'en-GB');
  // Swahili : un seul mot pour le singulier et le pluriel
  assert.equal(await T.choisirLangue('sw', { garder: false }), true);
  assert.equal(T.tn(1, '{n} article', '{n} articles'), 'bidhaa 1');
  assert.equal(T.tn(4, '{n} article', '{n} articles'), 'bidhaa 4');
  // Lingala : préfixe du pluriel
  assert.equal(await T.choisirLangue('ln', { garder: false }), true);
  assert.equal(T.pluriel(1, 'article'), 'eloko 1');
  assert.equal(T.pluriel(5, 'article'), 'biloko 5');
  // Langue inconnue : français ; retour au français
  assert.equal(await T.choisirLangue('xx', { garder: false }), true);
  assert.equal(T.langue.value, 'fr');
  assert.equal(T.t('Ajouter au panier'), 'Ajouter au panier');
  assert.equal(T.tn(1, '{n} article', '{n} articles'), '1 article');
  assert.equal(T.tn(0, '{n} article', '{n} articles'), '0 article', 'français : singulier jusqu’à 1');
  // Chaque langue se présente dans sa langue, et propose de l'utiliser dans celle-ci
  assert.deepEqual(T.LANGUES.map((l) => l.k), ['fr', 'en', 'sw', 'ln']);
  for (const k of L.LANGUES) assert.equal(T.PROPOSITIONS[k].length, 3);
});

test('notifications dans chaque langue : mêmes types, mêmes détails', () => {
  const fr = R.TEXTES_NOTIFICATIONS.fr;
  const d = { numero: 'K7P2QA', zone: 'Goma', moyen: 'Carte bancaire', gain: 0.45, titre: 'Robe wax', option: 'Rouge / M', texte: 'Merci !', autres: 2, filleul: 'Patrick B.', montant: 3, motif: 'anniversaire' };
  for (const k of L.LANGUES) {
    const x = R.TEXTES_NOTIFICATIONS[k];
    assert.deepEqual(Object.keys(x).sort(), Object.keys(fr).sort(), `${k} : types de notifications`);
    for (const type of Object.keys(fr)) {
      for (const i of [0, 1]) if (typeof fr[type][i] === 'string' && typeof x[type][i] === 'string') assert.equal(trous(x[type][i]), trous(fr[type][i]), `${k} ${type}`);
      const n = R.texteNotification({ type, details: d }, k);
      assert.ok(n.titre && n.texte && !/\{\w+\}|undefined/.test(n.titre + n.texte), `${k} ${type} : ${JSON.stringify(n)}`);
    }
  }
  assert.equal(R.texteNotification({ type: 'remboursee', details: { numero: 'A', moyen: 'Carte bancaire' } }, 'en').texte, 'Order #A refunded (bank card).');
  assert.equal(R.texteNotification({ type: 'remboursee', details: { numero: 'A', moyen: 'M-Pesa' } }, 'sw').texte, 'Oda #A: pesa imerejeshwa (M-Pesa).');
  assert.equal(R.texteNotification({ type: 'stock', details: { titre: 'Sac', option: '' } }, 'ln').texte.indexOf('“Sac” ezongi'), 0, 'sans option : pas de parenthèses vides');
  assert.equal(R.texteNotification({ type: 'expediee', details: { numero: 'A' } }, 'en').texte, 'Order #A: the delivery person is on the way.');
});
