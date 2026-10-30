// Tests du cadrage automatique des photos (cadre renvoyé par l'assistant, géométrie, lumière) : node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IA = require('../serveur/pb_hooks/lib/ia.js');

test('cadre de l’assistant : remis dans l’ordre, borné, refusé s’il est absurde', () => {
  assert.deepEqual(IA.nettoyerCadre({ gauche: 200, haut: 100, droite: 800, bas: 900 }), { gauche: 200, haut: 100, droite: 800, bas: 900 });
  assert.deepEqual(IA.nettoyerCadre({ gauche: 800, haut: 1200, droite: -5, bas: 100.4 }), { gauche: 0, haut: 100, droite: 800, bas: 1000 });
  assert.equal(IA.nettoyerCadre({ gauche: 500, haut: 500, droite: 510, bas: 900 }), null);
  assert.equal(IA.nettoyerCadre({ gauche: 'a', haut: 0, droite: 1000, bas: 1000 }), null);
  assert.equal(IA.nettoyerCadre(null), null);
  assert.ok(IA.SCHEMA.required.includes('cadre'));
  assert.equal(IA.nettoyerReponse({ title: 'Montre', description: 'x', cadre: { gauche: 0, haut: 0, droite: 1000, bas: 1000 } }, {}).cadre.droite, 1000);
  assert.equal(IA.nettoyerReponse({ title: 'Montre', description: 'x' }, {}).cadre, null);
});

test('géométrie : article centré, en grand, format 4:5, fond d’origine gardé si possible', async () => {
  const { calculerCadrage, RATIO } = await import('../src/admin/cadrage.js');
  // Photo paysage 4000×3000, petite montre à droite.
  const z = calculerCadrage(4000, 3000, { gauche: 600, haut: 400, droite: 800, bas: 700 });
  assert.ok(Math.abs(z.l / z.h - RATIO) < 1e-9);
  const art = { x0: 2400, x1: 3200, y0: 1200, y1: 2100 };
  assert.ok(z.x <= art.x0 && z.x + z.l >= art.x1 && z.y <= art.y0 && z.y + z.h >= art.y1, 'l’article reste entier');
  assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.l <= 4000 && z.y + z.h <= 3000, 'pas de bande : le cadre reste dans la photo');
  assert.ok(Math.abs(z.x + z.l / 2 - 2800) < 1 && Math.abs(z.y + z.h / 2 - 1650) < 1, 'article au centre');
  // Article qui touche le bord : le cadre peut dépasser (rempli par la couleur du fond) mais l'article reste entier.
  const b = calculerCadrage(1000, 1000, { gauche: 0, haut: 0, droite: 1000, bas: 400 });
  assert.ok(b.x <= 0 && b.x + b.l >= 1000 && b.y <= 0 && b.y + b.h >= 400);
  // Minuscule article : zoom limité pour ne pas rendre une photo floue.
  const m = calculerCadrage(1000, 1250, { gauche: 495, haut: 495, droite: 505, bas: 505 });
  assert.ok(m.h >= 1250 * 0.42 - 1e-6);
  assert.equal(calculerCadrage(1000, 1000, null), null);
});

test('lumière : photo terne étirée, photo sombre éclaircie, photo correcte presque intacte', async () => {
  const { tableLumiere } = await import('../src/admin/cadrage.js');
  const histo = (de, a) => { const h = new Uint32Array(256); for (let i = de; i <= a; i++) h[i] = 10; return [h, (a - de + 1) * 10]; };
  const terne = tableLumiere(...histo(60, 200));
  assert.ok(terne[200] >= 240 && terne[200] - terne[60] >= 180, 'fond terne remonté vers le blanc, contraste renforcé');
  const gris = tableLumiere(...histo(40, 170));
  assert.ok(gris[170] >= 225, 'fond gris éclairci (gain plafonné à ×1,55)');
  const sombre = tableLumiere(...histo(0, 120));
  assert.ok(sombre[60] > 100, 'les tons moyens remontent');
  const bonne = tableLumiere(...histo(0, 255));
  for (const i of [0, 64, 128, 255]) assert.ok(Math.abs(bonne[i] - i) <= 2);
  for (const t of [terne, sombre, bonne]) for (let i = 1; i < 256; i++) assert.ok(t[i] >= t[i - 1], 'jamais d’inversion');
});
