// Sokoyetu — les sauvegardes se restaurent-elles vraiment ? Sur le vrai serveur local :
//   1. une sauvegarde PocketBase (comme celle de chaque nuit) est créée, puis vérifiée par sauvegarde.sh (copie à part,
//      intégrité de la base, redémarrage de PocketBase dessus) ;
//   2. une sauvegarde « maintenant » (boutique ouverte) est faite et vérifiée ;
//   3. une restauration complète est jouée sur une copie du serveur : données revenues, ancien état gardé à part.
//   npm run build && DATA=.local/essai bash outils/serveur-local.sh   (autre terminal)   puis
//   BASE=http://127.0.0.1:8090 DATA=.local/essai node tests/sauvegarde.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const RACINE = resolve(new URL('..', import.meta.url).pathname);
const DATA = resolve(RACINE, process.env.DATA || '.local/pb_data');
const PB = resolve(RACINE, process.env.PB || '.local/pocketbase');
const PAQUET = join(RACINE, 'dist', 'sokoyetu-serveur');
const etape = (t) => console.log('✓ ' + t);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(chemin, { method = 'GET', body, jeton } = {}) {
  const r = await fetch(BASE + chemin, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jeton ? { Authorization: jeton } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
  return { status: r.status, json: j };
}

/* Dossier qui imite /opt/sokoyetu : pocketbase, pb_migrations, pb_data (lien vers la base du serveur ou une copie), sauvegardes. */
function installation(pbData) {
  const d = mkdtempSync(join(tmpdir(), 'sokoyetu-sauvegarde-'));
  symlinkSync(PB, join(d, 'pocketbase'));
  symlinkSync(join(PAQUET, 'pb_migrations'), join(d, 'pb_migrations'));
  symlinkSync(join(PAQUET, 'pb_hooks'), join(d, 'pb_hooks'));
  if (pbData) symlinkSync(pbData, join(d, 'pb_data')); else mkdirSync(join(d, 'pb_data'));
  return d;
}
const script = (dir, ...args) => execFileSync('bash', [join(PAQUET, 'sauvegarde.sh'), ...args], { env: { ...process.env, SOKOYETU_ESSAI: '1', SOKOYETU_DIR: dir }, encoding: 'utf8' });
const verification = (dir) => JSON.parse(readFileSync(join(dir, 'sauvegardes', 'verification.json'), 'utf8'));

assert.ok(existsSync(join(PAQUET, 'sauvegarde.sh')), 'Construisez d’abord le paquet : npm run build');
const t = await api('/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: 'technique@sokoyetu.test', password: 'Technique-2026' } });
assert.equal(t.status, 200, 'compte technique du serveur local');
const jeton = t.json.token;
const admin = (await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' } })).json.token;

// Un article témoin, pour reconnaître l'état sauvegardé.
const temoin = 'sauv-' + Date.now().toString(36);
const ecrit = await api('/api/collections/products/records', { method: 'POST', jeton: admin, body: { id: temoin, doc: { title: 'Article témoin', price: 1, status: 'draft' } } });
assert.equal(ecrit.status, 200, 'article témoin');

// 1. Sauvegarde PocketBase (la même que celle de chaque nuit), puis vérification.
const nom = `essai_${temoin}.zip`;
assert.equal((await api('/api/backups', { method: 'POST', jeton, body: { name: nom } })).status, 204);
for (let i = 0; i < 40 && !existsSync(join(DATA, 'backups', nom)); i++) await attendre(250);
assert.ok(existsSync(join(DATA, 'backups', nom)), 'sauvegarde créée dans pb_data/backups');
const ici = installation(DATA);
const sortie = script(ici, 'verifier', nom);
assert.match(sortie, /se restaure/);
let v = verification(ici);
assert.equal(v.ok, true); assert.equal(v.fichier, nom); assert.match(v.message, /commandes, \d+ articles/);
etape(`sauvegarde nocturne vérifiée : ${v.message}`);

// L'administration voit le résultat (état du serveur).
const sante = await api('/api/sokoyetu/sante', { jeton: admin });
assert.equal(sante.status, 200); assert.equal(sante.json.ok, true);
assert.ok(sante.json.details && sante.json.details.sauvegardes.nombre >= 1, 'sauvegardes comptées par le serveur');
etape(`état du serveur : ${sante.json.details.sauvegardes.nombre} sauvegarde(s), ${sante.json.details.problemes.length} point(s) signalé(s)`);

// 2. Sauvegarde immédiate pendant que la boutique tourne, puis vérification.
const avant = readdirSync(join(DATA, 'backups')).filter((f) => f.startsWith('@manuel_'));
assert.match(script(ici, 'maintenant'), /Sauvegarde faite/);
const manuelle = readdirSync(join(DATA, 'backups')).filter((f) => f.startsWith('@manuel_') && !avant.includes(f))[0];
assert.ok(manuelle, 'sauvegarde « maintenant » créée');
script(ici, 'verifier', manuelle);
v = verification(ici);
assert.equal(v.ok, true);
etape(`sauvegarde « maintenant » vérifiée (${manuelle})`);

// Une sauvegarde abîmée est signalée, jamais déclarée bonne.
const abimee = join(ici, 'sauvegardes', 'abimee.zip');
execFileSync('bash', ['-c', `head -c 4000 /dev/urandom > "${abimee}"`]);
assert.throws(() => script(ici, 'verifier', abimee));
assert.equal(verification(ici).ok, false);
etape('sauvegarde abîmée : refusée et signalée');

// 3. Restauration sur une copie du serveur : l'article témoin, supprimé depuis, revient.
assert.equal((await api(`/api/collections/products/records/${temoin}`, { method: 'DELETE', jeton: admin })).status, 204);
const copie = installation(null);
rmSync(join(copie, 'pb_data'), { recursive: true, force: true });
cpSync(DATA, join(copie, 'pb_data'), { recursive: true, dereference: true });
const sortieRest = script(copie, 'restaurer', join(DATA, 'backups', nom), '--oui');
assert.match(sortieRest, /Boutique restaurée/);
assert.ok(readdirSync(join(copie, 'sauvegardes')).some((f) => f.startsWith('avant-restauration-')), 'ancien état gardé à part');
const port = 18990;
const pb = spawn(PB, ['serve', `--http=127.0.0.1:${port}`, `--dir=${join(copie, 'pb_data')}`, `--hooksDir=${join(copie, 'vide')}`, `--migrationsDir=${join(PAQUET, 'pb_migrations')}`], { stdio: 'ignore' });
try {
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { await attendre(250); try { ok = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch (e) { } }
  assert.ok(ok, 'la copie restaurée démarre');
  const tc = await (await fetch(`http://127.0.0.1:${port}/api/collections/_superusers/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'technique@sokoyetu.test', password: 'Technique-2026' }) })).json();
  const r = await fetch(`http://127.0.0.1:${port}/api/collections/products/records/${temoin}`, { headers: { Authorization: tc.token } });
  assert.equal(r.status, 200, 'article témoin revenu avec la restauration');
  etape('restauration complète : données revenues, ancien état gardé dans sauvegardes/');
} finally { pb.kill(); }

rmSync(join(DATA, 'backups', nom), { force: true }); rmSync(join(DATA, 'backups', manuelle), { force: true });
rmSync(ici, { recursive: true, force: true }); rmSync(copie, { recursive: true, force: true });
console.log('\nSauvegardes : création, vérification et restauration réussies.');
