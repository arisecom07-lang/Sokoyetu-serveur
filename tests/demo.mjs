// Sokoyetu — vérifie la démo construite (npm run demo), servie en fichiers statiques :
//   (cd dist/demo && python3 -m http.server 8095)   puis   node tests/demo.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8095';
const SORTIE = process.env.SORTIE || '/tmp/claude-0/-home-user/4c9af478-9b7a-59ef-9660-b9b31e63d534/scratchpad/captures/';
const erreurs = [];
const etape = (t) => console.log('✓ ' + t);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
const surveiller = (p, n) => { p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) erreurs.push(`[${n}] ${m.text()}`); }); p.on('pageerror', (e) => erreurs.push(`[${n}] ${e.message}`)); p.on('requestfailed', (r) => erreurs.push(`[${n}] échec ${r.url()}`)); };

const admin = await ctx.newPage(); surveiller(admin, 'admin');
await admin.goto(BASE + '/admin/index.html'); await admin.waitForSelector('.connexion-carte');
await admin.click('button[type=submit]'); await admin.waitForSelector('.kpis');
await admin.screenshot({ path: SORTIE + 'demo-admin.png' });
etape('administration de la démo : connexion en un geste, tableau de bord rempli');
await admin.goto(BASE + '/admin/index.html#/commandes'); await admin.waitForSelector('.liste .ligne');
const n0 = await admin.locator('.liste .ligne').count();

const client = await ctx.newPage(); surveiller(client, 'boutique');
await client.goto(BASE + '/boutique/index.html'); await client.waitForSelector('.carte-produit');
await client.screenshot({ path: SORTIE + 'demo-boutique.png' });
await client.goto(BASE + '/boutique/index.html#/p/ex-p17/montre-classique-bracelet-cuir'); await client.waitForSelector('.produit-titre');
await client.click('.barre-action .btn-primaire'); await client.waitForTimeout(400);
await client.goto(BASE + '/boutique/index.html#/commander'); await client.waitForSelector('.page-choix-compte');
await client.click('button:has-text("Continuer sans compte")'); await client.waitForSelector('.page-commande');
await client.fill('input[autocomplete="name"]', 'Amani Bahati'); await client.fill('input[type=tel]', '0997654321');
await client.click('[aria-label="Zone de livraison"] .choix >> nth=0'); await client.fill('input[autocomplete="street-address"]', 'Nguba, av. de la Mission 7');
await client.click('.barre-action .btn-primaire'); await client.waitForSelector('[aria-label="Opérateur Mobile Money"]');
await client.click('[aria-label="Opérateur Mobile Money"] .choix >> nth=0');
await client.fill('[aria-label="Code promo"]', 'BIENVENUE10'); await client.click('button:has-text("Appliquer")'); await client.waitForSelector('text=Code BIENVENUE10 appliqué');
await client.click('.case .case-boite');
await client.click('.barre-action .btn-primaire'); await client.waitForSelector('.paiement-attente', { timeout: 15000 });
etape('paiement demandé dans la démo : écran d’attente');
await client.waitForSelector('.recu', { timeout: 20000 });
const numero = (await client.locator('.recu-numero .code').innerText()).trim();
etape(`paiement de test confirmé, reçu de la commande #${numero}`);

await admin.bringToFront();
await admin.waitForSelector(`.toast:has-text("Commande payée #${numero}")`, { timeout: 8000 });
assert.equal(await admin.locator('.liste .ligne').count(), n0 + 1);
etape('alerte « Commande payée » reçue en direct dans l’autre onglet');
await client.click('a:has-text("Suivre ma commande")'); await client.waitForSelector('.page-suivi .pastille:has-text("Payée")');
await admin.click(`.liste .ligne:has-text("#${numero}")`); await admin.click('button:has-text("Commencer la préparation")');
await client.waitForSelector('.page-suivi .pastille:has-text("En préparation")', { timeout: 8000 });
etape('préparation commencée : suivi du client mis à jour en direct');

// Accueil de la démo, ordinateur et téléphone
// La page d'accueil est publiée sans en-tête : l'hébergeur l'enveloppe (encodage, largeur d'écran). On fait de même ici.
const envelopper = async (route) => { const r = await route.fetch(); route.fulfill({ response: r, headers: { ...r.headers(), 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + (await r.text()) + '</body></html>' }); };
await ctx.route(BASE + '/index.html', envelopper);
const bureau = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' });
await bureau.route(BASE + '/index.html', envelopper);
const l = await bureau.newPage(); surveiller(l, 'accueil');
await l.goto(BASE + '/index.html'); await l.waitForTimeout(2500); await l.screenshot({ path: SORTIE + 'demo-accueil-ordi.png' });
const lt = await ctx.newPage(); surveiller(lt, 'accueil-mobile');
await lt.goto(BASE + '/index.html'); await lt.waitForTimeout(800); await lt.screenshot({ path: SORTIE + 'demo-accueil-mobile.png', fullPage: true });
etape('page d’accueil de la démo affichée');
await b.close();
const graves = erreurs.filter((e) => !/ERR_ABORTED|favicon/.test(e));
console.log(graves.length ? '\n' + graves.join('\n') : '\nAucune erreur dans les consoles.');
process.exit(graves.length ? 1 : 0);
