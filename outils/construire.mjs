// Sokoyetu — construction du paquet serveur.
//   npm run build            → dist/sokoyetu-serveur/ et dist/sokoyetu-serveur.zip
//   npm run build -- --demo  → dist/demo/ (aperçu sans serveur, données simulées dans le navigateur)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RACINE, 'src');
const DIST = join(RACINE, 'dist');
const DEMO = process.argv.includes('--demo');
const SORTIE = join(DIST, DEMO ? 'demo' : 'sokoyetu-serveur');
const pkg = JSON.parse(await readFile(join(RACINE, 'package.json'), 'utf8'));
const maintenant = new Date();
const VERSION = `${pkg.version}+${maintenant.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

const empreinte = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

async function fichiers(dossier) {
  const out = [];
  for (const nom of await readdir(dossier)) {
    const p = join(dossier, nom);
    if ((await stat(p)).isDirectory()) out.push(...await fichiers(p)); else out.push(p);
  }
  return out;
}

/*
 * Langues de la boutique : un fichier par langue (assets/langue-en.<empreinte>.json…), chargé seulement si le client la
 * choisit. Les textes sans traduction s'affichent en français (liste : node outils/langues.cjs).
 */
async function langues(dest) {
  const L = createRequire(import.meta.url)('./langues.cjs');
  const adresses = {}; const liste = L.textes(); const manque = [];
  for (const k of L.LANGUES) {
    const d = L.dictionnaire(k);
    const contenu = Buffer.from(JSON.stringify(d));
    const n = `langue-${k}.${empreinte(contenu)}.json`;
    await writeFile(join(dest, 'assets', n), contenu);
    adresses[k] = (DEMO ? 'assets/' : '/assets/') + n;
    const m = L.manquants(k, liste).length; if (m) manque.push(`${m} en ${L.NOMS[k]}`);
  }
  if (manque.length) console.log(`Langues : textes sans traduction (affichés en français) : ${manque.join(', ')}. Liste : node outils/langues.cjs`);
  return adresses;
}

/* Une application (boutique ou admin) : JS et CSS regroupés, minifiés et nommés par empreinte. */
async function application(nom, dest, options = {}) {
  const dossier = join(SRC, nom);
  await mkdir(join(dest, 'assets'), { recursive: true });
  // L'administration reste en français.
  const adressesLangues = nom === 'boutique' ? await langues(dest) : {};
  // Démo : le client du serveur est remplacé par un serveur simulé dans le navigateur.
  const demo = { name: 'demo', setup(b) { b.onResolve({ filter: /commun\/js\/api\.js$/ }, () => ({ path: join(RACINE, 'demo', 'api-demo.js') })); } };
  const js = await build({
    entryPoints: [join(dossier, 'main.jsx')], bundle: true, minify: true, format: 'iife', target: ['chrome80', 'safari15', 'firefox78', 'edge88'],
    write: false, legalComments: 'none', charset: 'utf8', jsx: 'automatic', jsxImportSource: 'preact',
    define: { __DEMO__: String(DEMO), __VERSION__: JSON.stringify(VERSION), __APP__: JSON.stringify(nom), __LANGUES__: JSON.stringify(adressesLangues) },
    plugins: DEMO ? [demo] : []
  });
  const css = await build({
    entryPoints: [join(dossier, `${nom}.css`)], bundle: true, minify: true, write: false, charset: 'utf8',
    loader: { '.woff2': 'file', '.svg': 'file', '.webp': 'file' }, assetNames: '[name]-[hash]', outdir: join(dest, 'assets'), publicPath: './'
  });
  const noms = { polices: [] };
  for (const f of js.outputFiles) { const n = `${nom}.${empreinte(f.contents)}.js`; await writeFile(join(dest, 'assets', n), f.contents); noms.js = n; }
  for (const f of css.outputFiles) {
    if (f.path.endsWith('.css')) { const n = `${nom}.${empreinte(f.contents)}.css`; await writeFile(join(dest, 'assets', n), f.contents); noms.css = n; }
    else { await writeFile(f.path, f.contents); if (f.path.endsWith('.woff2')) noms.polices.push(relative(join(dest, 'assets'), f.path)); }
  }
  // Fichiers statiques de l'application (pages, icônes, manifeste…)
  const statiques = join(dossier, 'public');
  if (existsSync(statiques)) await cp(statiques, dest, { recursive: true });
  // Pages HTML : liens vers les fichiers construits
  for (const f of await fichiers(dest)) {
    if (!f.endsWith('.html')) continue;
    let html = await readFile(f, 'utf8');
    const prechargement = noms.polices.map((p) => `<link rel="preload" href="/assets/${p}" as="font" type="font/woff2" crossorigin>`).join('');
    html = html.replaceAll('{{PRELOAD}}', prechargement).replaceAll('{{CSS}}', `/assets/${noms.css}`).replaceAll('{{JS}}', `/assets/${noms.js}`).replaceAll('{{VERSION}}', VERSION);
    if (DEMO) html = html.replace(/(href|src)="\/(?!\/)/g, '$1="');
    await writeFile(f, html);
  }
  // Service worker : liste des fichiers à garder hors connexion
  const sw = join(dest, 'sw.js');
  if (existsSync(sw)) {
    const liste = (await fichiers(dest)).map((f) => '/' + relative(dest, f).split('\\').join('/'))
      .filter((u) => /^\/(assets\/|index\.html$|offline\.html$|site\.webmanifest$|favicon\.svg$|icone-)/.test(u) || options.precache?.(u))
      .filter((u) => !/^\/assets\/langue-/.test(u)); // gardée hors connexion une fois choisie, pas d'avance
    let code = await readFile(sw, 'utf8');
    code = code.replace('__VERSION__', VERSION).replace('[/*PRECACHE*/]', JSON.stringify(['/', ...liste]));
    await writeFile(sw, code);
  }
  return noms;
}

await rm(SORTIE, { recursive: true, force: true });
await mkdir(SORTIE, { recursive: true });

if (DEMO) {
  const b = await application('boutique', join(SORTIE, 'boutique'));
  await application('admin', join(SORTIE, 'admin'));
  await cp(join(RACINE, 'medias', 'photos'), join(SORTIE, 'boutique', 'photos'), { recursive: true });
  // Page d'accueil de la démo : mêmes polices que les applications
  const police = (nom) => 'boutique/assets/' + b.polices.find((p) => p.startsWith(nom));
  const accueil = (await readFile(join(RACINE, 'demo', 'index.html'), 'utf8')).replace('{{FRAUNCES}}', police('fraunces')).replace('{{JAKARTA}}', police('plus-jakarta-sans'));
  await writeFile(join(SORTIE, 'index.html'), accueil);
  await cp(join(RACINE, 'demo', 'apercu-admin.webp'), join(SORTIE, 'apercu-admin.webp'));
  console.log('Démo prête :', relative(RACINE, SORTIE));
} else {
  // Serveur : hooks (+ règles métier partagées), migrations, scripts
  await cp(join(RACINE, 'serveur', 'pb_hooks'), join(SORTIE, 'pb_hooks'), { recursive: true });
  await cp(join(SRC, 'commun', 'js', 'regles.js'), join(SORTIE, 'pb_hooks', 'lib', 'regles.js'));
  await writeFile(join(SORTIE, 'pb_hooks', 'lib', 'version.js'), `module.exports = { version: ${JSON.stringify(VERSION)} };\n`);
  await cp(join(RACINE, 'serveur', 'pb_migrations'), join(SORTIE, 'pb_migrations'), { recursive: true });
  for (const f of await readdir(join(RACINE, 'serveur', 'scripts'))) await cp(join(RACINE, 'serveur', 'scripts', f), join(SORTIE, f));
  await cp(join(RACINE, 'LISEZMOI.md'), join(SORTIE, 'LISEZMOI.md')).catch(() => {});
  // Applications
  await application('boutique', join(SORTIE, 'pb_public'), { precache: (u) => /^\/photos\/(ban|cat)-/.test(u) });
  await application('admin', join(SORTIE, 'pb_admin'));
  await cp(join(RACINE, 'medias', 'photos'), join(SORTIE, 'pb_public', 'photos'), { recursive: true });
  // Paquet zip (fichiers à la racine, comme l'attendent installer.sh et mise-a-jour.sh)
  const zip = join(DIST, 'sokoyetu-serveur.zip');
  await rm(zip, { force: true });
  execFileSync('python3', ['-c', `
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(base, f)
            info = zipfile.ZipInfo(os.path.relpath(p, src), date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = (0o755 if f.endswith('.sh') else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(p, 'rb') as fh: z.writestr(info, fh.read())
`, SORTIE, zip]);
  console.log(`Paquet prêt : ${relative(RACINE, zip)} (${((await stat(zip)).size / 1048576).toFixed(1)} Mo) · version ${VERSION}`);
}
