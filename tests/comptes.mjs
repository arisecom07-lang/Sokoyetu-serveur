// Sokoyetu — comptes clients dans de vrais navigateurs, sur le vrai serveur local (codes et paiement en mode test) :
// un client crée son compte au moment de commander, retrouve panier, favoris et commandes sur un autre téléphone ;
// la gérante voit qui a mis quoi au panier. Un autre client commande sans compte.
//   npm run build && bash outils/serveur-local.sh   (autre terminal, catalogue d'exemple chargé)   puis   node tests/comptes.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8090';
const ADMIN = process.env.ADMIN || 'http://admin.localhost:8090';
// Captures d'écran : dossier temporaire du système, ou SORTIE=… pour un autre dossier.
const SORTIE = process.env.SORTIE || join(tmpdir(), 'sokoyetu-captures') + '/';
mkdirSync(SORTIE, { recursive: true });
const TEL = process.env.TEL || '0995' + String(Date.now()).slice(-6);
const erreurs = [];
const etape = (t) => console.log('✓ ' + t);

const b = await chromium.launch();
function surveiller(p, nom) {
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) erreurs.push(`[${nom}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => erreurs.push(`[${nom}] pageerror: ${e.message}`));
}
async function telephone(nom) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('sokoyetu:consentement', '{"mesure":false}'); } catch (e) { } });
  const p = await ctx.newPage(); surveiller(p, nom); return p;
}
/* Connexion : numéro, puis le code affiché à l'écran en mode test. */
async function seConnecter(p, nom) {
  await p.waitForSelector('.page-connexion input[type=tel]');
  await p.fill('.page-connexion input[type=tel]', TEL); await p.click('.page-connexion button[type=submit]');
  await p.waitForSelector('.saisie-otp');
  const code = (await p.locator('.page-connexion .note .code').innerText()).trim();
  assert.match(code, /^\d{6}$/);
  await p.fill('.saisie-otp', code);
  if (nom) { await p.waitForSelector('input[autocomplete="name"]'); await p.fill('input[autocomplete="name"]', nom); await p.click('button[type=submit]'); }
}

// 1. Un client met un sac en favori et une montre au panier, puis va commander : la création de compte lui est proposée.
const a = await telephone('téléphone A');
await a.goto(BASE + '/p/ex-p05'); await a.waitForSelector('.produit-titre');
await a.click('.barre-favori'); await a.waitForTimeout(300);
await a.goto(BASE + '/p/ex-p17/montre-classique-bracelet-cuir'); await a.waitForSelector('.produit-titre');
await a.click('.barre-action .btn-primaire'); await a.waitForTimeout(400);
await a.goto(BASE + '/panier'); await a.click('.barre-action .btn-primaire');
await a.waitForSelector('.page-choix-compte'); await a.waitForTimeout(600);
assert.match(await a.locator('.invitation-compte h2').innerText(), /Créez votre compte et commencez à commander dès maintenant/);
await a.screenshot({ path: SORTIE + 'compte-1-proposition.png' });
etape('avant de commander : « Créez votre compte et commencez à commander dès maintenant » ou « Continuer sans compte »');

await a.click('a:has-text("Créer mon compte")');
await a.waitForSelector('.page-connexion'); await a.waitForTimeout(600); await a.fill('.page-connexion input[type=tel]', TEL);
await a.screenshot({ path: SORTIE + 'compte-2-telephone.png' });
await a.click('.page-connexion button[type=submit]'); await a.waitForSelector('.saisie-otp'); await a.waitForTimeout(600);
assert.match(await a.locator('.page-connexion h1').innerText(), /Code reçu sur WhatsApp/);
await a.screenshot({ path: SORTIE + 'compte-3-code.png' });
await a.fill('.saisie-otp', '000000'); await a.waitForSelector('.champ-erreur:has-text("Code incorrect")');
const code = (await a.locator('.page-connexion .note .code').innerText()).trim();
await a.fill('.saisie-otp', code);
await a.waitForSelector('input[autocomplete="name"]'); await a.fill('input[autocomplete="name"]', 'Furaha Mapendo');
await a.screenshot({ path: SORTIE + 'compte-4-nom.png' });
await a.click('button[type=submit]');
await a.waitForSelector('.page-commande'); await a.waitForTimeout(600);
assert.equal(await a.inputValue('input[autocomplete="name"]'), 'Furaha Mapendo');
assert.match(await a.locator('.page-commande').innerText(), /Connecté : la commande s’ajoute à votre compte/);
await a.screenshot({ path: SORTIE + 'compte-5-commande-connecte.png' });
etape('code WhatsApp (mode test) : faux code refusé, bon code accepté, nom demandé, retour à la commande pré-remplie');

// 2. La gérante voit le compte, son panier et ses favoris, en direct.
const bureau = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const admin = await bureau.newPage(); surveiller(admin, 'admin');
await admin.goto(ADMIN + '/');
await admin.fill('input[type=email]', 'admin@sokoyetu.test'); await admin.fill('input[autocomplete="current-password"]', 'Sokoyetu-2026');
await admin.click('button[type=submit]'); await admin.waitForSelector('.kpis');
await admin.goto(ADMIN + '/#/audience'); await admin.waitForSelector('.carte-titre:has-text("Paniers à relancer")');
await admin.waitForSelector('.ligne:has-text("Furaha Mapendo")', { timeout: 10000 });
await admin.screenshot({ path: SORTIE + 'compte-6-admin-paniers.png' });
await admin.goto(ADMIN + '/#/audience/ex-p05'); await admin.waitForSelector('.carte-titre:has-text("Clients avec compte")');
await admin.waitForSelector('.ligne:has-text("Furaha Mapendo"):has-text("en favori")');
await admin.goto(ADMIN + '/#/clients'); await admin.waitForSelector('.ligne:has-text("Furaha Mapendo") .pastille:has-text("Compte")');
await admin.click('.ligne:has-text("Furaha Mapendo")'); await admin.waitForSelector('.carte-titre:has-text("Compte client")');
assert.match(await admin.locator('.carte:has(.carte-titre:has-text("Compte client"))').innerText(), /Montre classique/);
await admin.screenshot({ path: SORTIE + 'compte-7-admin-client.png', fullPage: true });
etape('administration : « Paniers à relancer », clients qui ont l’article en favori, fiche client avec panier et favoris');

// 3. Le client paie sa commande connecté.
await a.click('[aria-label="Zone de livraison"] .choix >> nth=0'); await a.fill('input[autocomplete="street-address"]', 'Nyawera, av. Lumumba 12');
await a.click('.barre-action .btn-primaire'); await a.waitForSelector('[aria-label="Opérateur Mobile Money"]');
await a.click('[aria-label="Opérateur Mobile Money"] .choix >> nth=0');
await a.fill('.saisie-numero', TEL);
await a.click('.case .case-boite'); await a.click('.barre-action .btn-primaire');
await a.waitForSelector('.recu', { timeout: 25000 });
const numero = (await a.locator('.recu-numero .code').innerText()).trim();
assert.equal(await a.locator('.invitation-compte').count(), 0);
etape(`commande #${numero} payée en étant connecté`);

// 4. Sur un autre téléphone : même compte, favoris et commande retrouvés.
const bb = await telephone('téléphone B');
await bb.goto(BASE + '/compte'); await bb.waitForSelector('.invitation-compte');
await bb.screenshot({ path: SORTIE + 'compte-8-mon-compte.png', fullPage: true });
await bb.click('.invitation-compte a:has-text("me connecter")');
await seConnecter(bb);
await bb.waitForSelector('.profil-texte:has-text("connecté")');
assert.match(await bb.locator('.profil-texte').innerText(), /Furaha Mapendo/);
await bb.goto(BASE + '/compte/commandes'); await bb.waitForSelector(`.carte-commande:has-text("#${numero}")`, { timeout: 10000 });
await bb.goto(BASE + '/favoris'); await bb.waitForSelector('.carte-produit');
await bb.goto(BASE + '/compte'); await bb.waitForSelector('.profil-texte:has-text("connecté")');
await bb.screenshot({ path: SORTIE + 'compte-9-autre-telephone.png', fullPage: true });
etape('autre téléphone : connexion avec le même numéro, commande et favoris retrouvés');

// 5. Panier changé sur B : il arrive sur A quand A revient sur la boutique.
await bb.goto(BASE + '/p/ex-p13'); await bb.waitForSelector('.produit-titre');
await bb.click('.barre-action .btn-primaire'); await bb.waitForTimeout(2000);
await a.goto(BASE + '/panier'); await a.waitForSelector('.page');
await a.waitForFunction(() => JSON.parse(localStorage.getItem('sokoyetu:panier') || '[]').some((l) => l.productId === 'ex-p13'), null, { timeout: 10000 });
etape('panier synchronisé entre les deux téléphones');

// 6. Déconnexion : le panier quitte l'appareil, il reste dans le compte.
await bb.goto(BASE + '/compte'); await bb.click('button:has-text("Se déconnecter")'); await bb.click('.feuille .btn-primaire');
await bb.waitForSelector('.carte-produit'); await bb.goto(BASE + '/compte'); await bb.waitForSelector('.invitation-compte');
assert.equal(await bb.evaluate(() => JSON.parse(localStorage.getItem('sokoyetu:panier') || '[]').length), 0);
etape('déconnexion : rien ne reste sur le téléphone prêté');

// 7. Un autre client commande sans compte.
const c = await telephone('téléphone C');
await c.goto(BASE + '/p/ex-p17/montre-classique-bracelet-cuir'); await c.waitForSelector('.produit-titre');
await c.click('.barre-action .btn-primaire'); await c.waitForTimeout(300);
await c.goto(BASE + '/commander'); await c.waitForSelector('.page-choix-compte');
await c.click('button:has-text("Continuer sans compte")'); await c.waitForSelector('.page-commande input[autocomplete="name"]');
await c.reload(); await c.waitForSelector('.page-commande input[autocomplete="name"]');
etape('« Continuer sans compte » : commande ouverte tout de suite, la question n’est pas reposée');

await b.close();
const graves = erreurs.filter((e) => !/favicon|ERR_ABORTED|net::ERR_|Failed to load resource/.test(e));
console.log(graves.length ? '\n' + graves.join('\n') : '\nAucune erreur dans les consoles.');
process.exit(graves.length ? 1 : 0);
