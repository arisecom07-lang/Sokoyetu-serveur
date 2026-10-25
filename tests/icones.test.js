// Chaque icône utilisée dans les deux applications doit exister dans le jeu d'icônes (sinon elle s'affiche vide).
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const SRC = join(__dirname, '..', 'src');
const jeu = readFileSync(join(SRC, 'commun', 'js', 'icones.jsx'), 'utf8');
const definies = new Set([...jeu.matchAll(/^ {2}([a-zA-Z]+): /gm)].map((m) => m[1]));

function fichiers(d) {
  return readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? fichiers(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : []; });
}

test('toutes les icônes référencées existent', () => {
  const manquantes = [];
  for (const f of fichiers(SRC)) {
    const code = readFileSync(f, 'utf8');
    const motifs = [/<Icone[^>]*?\bn=["']([a-zA-Z]+)["']/g, /<Icone[^>]*?\bn=\{["']([a-zA-Z]+)["']\}/g, /\bicone(?:=|: ?)["']([a-zA-Z]{2,})["']/g, /\bicone=\{["']([a-zA-Z]{2,})["']\}/g];
    for (const m of motifs) for (const x of code.matchAll(m)) if (!definies.has(x[1])) manquantes.push(`${f.replace(SRC, 'src')} : ${x[1]}`);
  }
  assert.deepEqual(manquantes, []);
  assert.ok(definies.size > 60);
});
