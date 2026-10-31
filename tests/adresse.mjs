// Sokoyetu — adresse de livraison enregistrée une seule fois, dans de vrais navigateurs, sur le vrai serveur local
// (catalogue d'exemple chargé) : listes ville → commune → quartier, résumé aux commandes suivantes, modification,
// « Mon compte », listes réglées par la boutique, adresse détaillée gardée sur la commande.
//   npm run build && bash outils/serveur-local.sh   (autre terminal)   puis   node tests/adresse.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8090';
const ADMIN = process.env.ADMIN || 'http://admin.localhost:8090';
const P = 'sokoyetu:';
const TEL = '0997' + String(Date.now()).slice(-6);
const erreurs = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
await ctx.addInitScript((p) => { try { localStorage.setItem(p + 'consentement', '{"mesure":false}'); } catch (e) { } }, P);
const c = await ctx.newPage();
c.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
c.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
// Texte affiché, espaces insécables (« C.\u00a0Ibanda ») comprises comme des espaces.
const texte = async (l) => (await l.innerText()).replace(/\u00a0/g, ' ');
const options = (label) => c.getByLabel(label, { exact: true }).locator('option').allInnerTexts();

async function ouvrirCommande() {
  await c.goto(BASE + '/');
  await c.evaluate((p) => localStorage.setItem(p + 'panier', JSON.stringify([{ productId: 'ex-p13', qty: 1 }])), P);
  await c.goto(BASE + '/commander');
  await c.waitForSelector('.page-choix-compte, .page-commande');
  if (await c.locator('.page-choix-compte').count()) { await c.click('button:has-text("Continuer sans compte")'); }
  await c.waitForSelector('.page-commande');
}

// 1. Première commande : le formulaire, avec ville, commune et quartier en listes.
await ouvrirCommande();
assert.match(await c.locator('.page-commande').innerText(), /Enregistrée une seule fois : cette adresse servira pour toutes vos livraisons/);
assert.deepEqual(await options('Ville'), ['Bukavu', 'Goma']);
assert.deepEqual(await options('Commune'), ['Choisissez…', 'Ibanda', 'Kadutu', 'Bagira']);
await c.getByLabel('Ville', { exact: true }).selectOption({ label: 'Goma' });
assert.deepEqual(await options('Commune'), ['Choisissez…', 'Goma', 'Karisimbi']);
await c.getByLabel('Commune', { exact: true }).selectOption('Karisimbi');
const quartiers = await options('Quartier');
assert.ok(quartiers.includes('Katoyi') && quartiers.at(-1) === 'Autre quartier…', quartiers.join(', '));
await c.getByLabel('Quartier', { exact: true }).selectOption({ label: 'Autre quartier…' });
await c.getByLabel('Nom du quartier').fill('Kyeshero-Bas');
// Retour à Bukavu : la commune et le quartier se vident.
await c.getByLabel('Ville', { exact: true }).selectOption({ label: 'Bukavu' });
assert.equal(await c.getByLabel('Commune', { exact: true }).inputValue(), '');
await c.click('.barre-action .btn-primaire');
assert.match(await c.locator('.formulaire-adresse').innerText(), /Indiquez votre nom complet[\s\S]*Choisissez votre commune/);
await c.getByLabel('Nom complet').fill('Neema Furaha'); await c.getByLabel('Téléphone').fill(TEL);
await c.getByLabel('Commune', { exact: true }).selectOption('Ibanda'); await c.getByLabel('Quartier', { exact: true }).selectOption('Nyalukemba');
await c.getByLabel('Avenue ou rue').fill('av. de la Mission'); await c.getByLabel('Numéro').fill('7'); await c.getByLabel('Point de repère').fill('en face de la pharmacie');
await c.click('.barre-action .btn-primaire'); await c.waitForSelector('[aria-label^="Opérateur Mobile Money"], [aria-label="Moyen de paiement"]');
assert.match(await c.locator('.page-commande').innerText(), /av\. de la Mission n° 7, Q\. Nyalukemba, C\. Ibanda/);
console.log('✓ première commande : adresse choisie dans les listes, enregistrée');

// 2. Commande suivante : plus de formulaire, l'adresse enregistrée en résumé.
await ouvrirCommande();
assert.equal(await c.locator('.formulaire-adresse').count(), 0, 'pas de formulaire');
const resume = await texte(c.locator('.adresse-texte'));
assert.match(resume, /Neema Furaha/); assert.match(resume, /av\. de la Mission n° 7, Q\. Nyalukemba, C\. Ibanda, Bukavu/); assert.match(resume, /pharmacie/);
assert.match(await c.locator('.page-commande').innerText(), /elle sert pour toutes vos livraisons tant que vous ne la modifiez pas/);
console.log('✓ commande suivante : adresse enregistrée réutilisée, sans rien ressaisir');

// 3. Modifier : formulaire pré-rempli, nouvelle adresse gardée pour la suite.
await c.click('.titre-avec-bouton button:has-text("Modifier")');
assert.equal(await c.getByLabel('Quartier', { exact: true }).inputValue(), 'Nyalukemba');
await c.getByLabel('Quartier', { exact: true }).selectOption('Panzi');
await c.click('.barre-action .btn-primaire'); await c.waitForSelector('[aria-label^="Opérateur Mobile Money"], [aria-label="Moyen de paiement"]');
await ouvrirCommande();
assert.match(await texte(c.locator('.adresse-texte')), /Q\. Panzi, C\. Ibanda/);
console.log('✓ adresse modifiée : la nouvelle sert aux commandes suivantes');

// 4. Commande payée : l'adresse détaillée est gardée par le serveur.
await c.click('.barre-action .btn-primaire');
await c.waitForSelector('[aria-label^="Opérateur Mobile Money"], [aria-label="Moyen de paiement"]');
await c.locator('.carte-paiement .choix').first().click();
if (await c.locator('.saisie-numero').count()) await c.fill('.saisie-numero', TEL);
await c.click('.case .case-boite'); await c.click('.barre-action .btn-primaire');
await c.waitForURL(/\/paiement\//, { timeout: 25000 });
const json = (corps) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
const jeton = (await (await fetch(BASE + '/api/collections/admins/auth-with-password', json({ identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' }))).json()).token;
const cmd = (await (await fetch(BASE + `/api/collections/orders/records?filter=${encodeURIComponent(`phone='${TEL}'`)}&sort=-created`, { headers: { Authorization: jeton } })).json()).items[0];
const s = cmd.doc.shipping;
assert.deepEqual([s.zoneName, s.commune, s.quartier, s.avenue, s.numero, s.address, s.landmark], ['Bukavu', 'Ibanda', 'Panzi', 'av. de la Mission', '7', 'av. de la Mission n° 7, Q. Panzi, C. Ibanda', 'en face de la pharmacie']);
console.log('✓ commande : ville, commune, quartier, avenue et numéro gardés');

// 5. Mon compte : l'adresse se voit et se modifie.
await c.goto(BASE + '/compte'); await c.waitForSelector('.page-compte');
assert.match(await c.locator('.menu-item:has-text("Mon adresse de livraison")').innerText(), /av\. de la Mission n° 7, Q\. Panzi, C\. Ibanda, Bukavu/);
await c.click('.menu-item:has-text("Mon adresse de livraison")'); await c.waitForSelector('.feuille .formulaire-adresse');
await c.locator('.feuille').getByLabel('Avenue ou rue').fill('av. Patrice Lumumba');
await c.click('.feuille button:has-text("Enregistrer mon adresse")'); await c.waitForSelector('.feuille', { state: 'detached' });
assert.match(await c.locator('.menu-item:has-text("Mon adresse de livraison")').innerText(), /av\. Patrice Lumumba n° 7/);
console.log('✓ Mon compte : adresse modifiée');

// 6. Administration : la boutique complète la liste des quartiers ; le client la voit aussitôt.
const ad = await (await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' })).newPage();
ad.on('pageerror', (e) => erreurs.push('[admin] ' + e.message));
await ad.goto(ADMIN + '/');
await ad.fill('input[type=email]', 'admin@sokoyetu.test'); await ad.fill('input[autocomplete="current-password"]', 'Sokoyetu-2026');
await ad.click('button[type=submit]'); await ad.waitForSelector('.kpis');
await ad.goto(ADMIN + '/#/reglages/livraison'); await ad.waitForSelector('.zone-carte');
const zone = ad.locator('.zone-carte').first();
const liste = zone.getByLabel('Communes et quartiers');
assert.match(await liste.inputValue(), /^Ibanda : Ndendere, Nyalukemba, Panzi(, Nguba)?\nKadutu : /); // déjà complétée si l'essai a déjà tourné sur cette base
await liste.fill((await liste.inputValue()).replace(/Panzi(, Nguba)?/, 'Panzi, Nguba'));
await ad.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await ad.waitForSelector('text=Réglages enregistrés', { timeout: 15000 });
await c.goto(BASE + '/compte'); await c.waitForSelector('.page-compte'); await c.waitForTimeout(800);
await c.click('.menu-item:has-text("Mon adresse de livraison")'); await c.waitForSelector('.feuille .formulaire-adresse');
assert.ok((await c.locator('.feuille').getByLabel('Quartier', { exact: true }).locator('option').allInnerTexts()).includes('Nguba'));
console.log('✓ quartier ajouté dans l’administration, proposé au client');

await b.close();
if (erreurs.length) { console.log('Erreurs dans les consoles :\n' + erreurs.join('\n')); process.exit(1); }
console.log('Adresse enregistrée : listes, réutilisation, modification et commande vérifiées, aucune erreur dans les consoles.');
