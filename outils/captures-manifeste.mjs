// Sokoyetu — captures d'écran affichées par Android au moment d'installer l'application (site.webmanifest).
//   serveur local lancé + catalogue d'exemple chargé, puis : node outils/captures-manifeste.mjs
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8090';
const SORTIE = new URL('../src/boutique/public/captures/', import.meta.url).pathname;
const T = join(tmpdir(), 'sokoyetu-captures');
await mkdir(SORTIE, { recursive: true }); await mkdir(T, { recursive: true });

const b = await chromium.launch();
const sansToasts = '.toasts, .barre-mise-a-jour, .carte-installation, .consentement { display: none !important; }';
async function contexte(options) {
  const ctx = await b.newContext({ locale: 'fr-FR', reducedMotion: 'reduce', ...options });
  await ctx.addInitScript(() => { try { localStorage.setItem('sokoyetu:consentement', '{"mesure":false}'); localStorage.setItem('sokoyetu:installMasque', String(Date.now() + 1e10)); } catch (e) { } });
  return ctx;
}
async function prise(p, nom) { await p.addStyleTag({ content: sansToasts }); await p.waitForTimeout(900); await p.screenshot({ path: join(T, nom + '.png') }); }

const tel = await contexte({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await tel.newPage();
await p.goto(BASE + '/'); await p.waitForSelector('.carte-produit'); await prise(p, 'accueil');
await p.goto(BASE + '/p/ex-p08/chemise-en-chambray'); await p.waitForSelector('.produit-titre'); await prise(p, 'produit');
await p.click('.taille >> text=L'); await p.click('.barre-action .btn-primaire'); await p.waitForTimeout(400);
await p.goto(BASE + '/commander'); await p.waitForSelector('.page-commande');
await p.fill('input[autocomplete="name"]', 'Grâce Mapendo'); await p.fill('input[type=tel]', '0991234567');
await p.click('[aria-label="Zone de livraison"] .choix >> nth=0'); await p.fill('input[autocomplete="street-address"]', 'Nyawera, av. Lumumba 12');
await p.click('.barre-action .btn-primaire'); await p.waitForSelector('[aria-label="Mode de paiement"]');
await p.click('[aria-label="Mode de paiement"] .choix >> nth=0');
await p.click('.barre-action .btn-primaire'); await p.waitForSelector('.carte-paiement');
await p.evaluate(() => scrollTo(0, 0)); await prise(p, 'commande');

const ordi = await contexte({ viewport: { width: 1440, height: 900 } });
const q = await ordi.newPage();
await q.goto(BASE + '/'); await q.waitForSelector('.carte-produit'); await prise(q, 'ordinateur');
await b.close();

for (const n of ['accueil', 'produit', 'commande', 'ordinateur']) {
  execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", quality=78, method=6)', join(T, n + '.png'), join(SORTIE, n + '.webp')]);
}
await rm(T, { recursive: true, force: true });
console.log('Captures enregistrées dans src/boutique/public/captures/');
