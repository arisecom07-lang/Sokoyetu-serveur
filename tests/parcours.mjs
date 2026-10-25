// Sokoyetu — parcours complet dans de vrais navigateurs, sur le vrai serveur local (paiement en mode test) :
// un client commande et paie sur son téléphone pendant que la gérante suit l'administration sur ordinateur.
//   npm run build && bash outils/serveur-local.sh   (autre terminal)   puis   node tests/parcours.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8090';
const ADMIN = process.env.ADMIN || 'http://admin.localhost:8090';
const SORTIE = process.env.SORTIE || '/tmp/claude-0/-home-user/4c9af478-9b7a-59ef-9660-b9b31e63d534/scratchpad/captures/';
const erreurs = [];
const etape = (t) => console.log('✓ ' + t);

const api = async (chemin, options = {}) => { const r = await fetch(BASE + chemin, options); return r.json(); };
const jetonAdmin = (await api('/api/collections/admins/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' }) })).token;
const stockMontre = async () => (await api('/api/collections/products/records/ex-p17', { headers: { Authorization: jetonAdmin } })).doc.stock;
const montre = await api('/api/collections/products/records/ex-p17', { headers: { Authorization: jetonAdmin } });
await fetch(BASE + '/api/collections/products/records/ex-p17', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: jetonAdmin }, body: JSON.stringify({ doc: { ...montre.doc, stock: 5 } }) });
const stockAvant = await stockMontre();

const b = await chromium.launch();
function surveiller(p, nom) {
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) erreurs.push(`[${nom}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => erreurs.push(`[${nom}] pageerror: ${e.message}`));
}

// La gérante, sur ordinateur, ouvre les commandes.
const bureau = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const admin = await bureau.newPage(); surveiller(admin, 'admin');
await admin.goto(ADMIN + '/');
await admin.fill('input[type=email]', 'admin@sokoyetu.test'); await admin.fill('input[autocomplete="current-password"]', 'Sokoyetu-2026');
await admin.click('button[type=submit]'); await admin.waitForSelector('.kpis');
await admin.goto(ADMIN + '/#/commandes'); await admin.waitForSelector('.liste .ligne');
const nAvant = await admin.locator('.liste .ligne').count();
etape(`administration ouverte (${nAvant} commandes)`);

// Le client, sur téléphone, commande une montre avec un code de réduction.
const tel = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
await tel.addInitScript(() => { try { localStorage.setItem('sokoyetu:consentement', '{"mesure":false}'); } catch (e) { } });
const client = await tel.newPage(); surveiller(client, 'client');
await client.goto(BASE + '/p/ex-p17/montre-classique-bracelet-cuir'); await client.waitForSelector('.produit-titre');
await client.click('.barre-action .btn-primaire'); await client.waitForTimeout(500);
await client.goto(BASE + '/panier'); await client.waitForSelector('.barre-action .btn-primaire');
await client.click('.barre-action .btn-primaire'); await client.waitForSelector('.page-choix-compte');
await client.click('button:has-text("Continuer sans compte")'); await client.waitForSelector('.page-commande');
etape('article ajouté au panier, création de compte proposée, commande ouverte sans compte');

await client.click('.barre-action .btn-primaire'); await client.waitForSelector('.champ-erreur');
etape('étape 1 vide : erreurs affichées près des champs');
await client.fill('input[autocomplete="name"]', 'Amani Bahati'); await client.fill('input[type=tel]', '0997654321');
await client.click('[aria-label="Zone de livraison"] .choix >> nth=0');
await client.fill('input[autocomplete="street-address"]', 'Nguba, av. de la Mission 7');
await client.click('.barre-action .btn-primaire'); await client.waitForSelector('[aria-label="Opérateur Mobile Money"]');
etape('étape 1 : coordonnées et livraison');

await client.click('[aria-label="Opérateur Mobile Money"] .choix >> nth=0');
await client.fill('[aria-label="Code promo"]', 'bienvenue10'); await client.click('button:has-text("Appliquer")');
await client.waitForSelector('text=Code BIENVENUE10 appliqué');
await client.waitForSelector('.montants >> text=Frais de service (2 %)');
const aPayer = (await client.locator('.barre-total .prix').innerText()).trim();
etape(`étape 2 : M-Pesa, code BIENVENUE10, frais de service 2 %, à payer ${aPayer}`);
await client.screenshot({ path: SORTIE + 'parcours-paiement.png' });

await client.click('.barre-action .btn-primaire'); await client.waitForSelector('.champ-erreur:has-text("Cochez cette case")');
etape('conditions non acceptées : paiement bloqué');
await client.click('.case .case-boite');
await client.click('.barre-action .btn-primaire'); await client.waitForSelector('.paiement-attente', { timeout: 15000 });
assert.match(await client.locator('.paiement-attente').innerText(), /099 765 4321/);
etape('demande de paiement envoyée au 099 765 4321 : écran « Validez le paiement sur votre téléphone »');
await client.screenshot({ path: SORTIE + 'parcours-attente.png' });
await admin.waitForFunction((n) => document.querySelectorAll('.liste .ligne').length === n, nAvant + 1);
assert.equal(await admin.locator('.toast:has-text("Commande payée")').count(), 0);
etape('la commande apparaît « Paiement en cours » dans l’administration, sans alerte de vente');

await client.waitForSelector('.recu', { timeout: 20000 });
const numero = (await client.locator('.recu-numero .code').innerText()).trim();
assert.match(await client.locator('.recu').innerText(), new RegExp(`Total payé\\s*${aPayer.replace(/[$.]/g, '\\$&')}`));
etape(`paiement confirmé par l’opérateur : reçu affiché, commande #${numero}, ${aPayer}`);
await client.screenshot({ path: SORTIE + 'parcours-recu.png', fullPage: true });

// L'administration est prévenue en direct, seulement une fois le paiement confirmé.
await admin.waitForSelector(`.toast:has-text("Commande payée #${numero}")`, { timeout: 10000 });
assert.match(await admin.title(), /^\(\d+\) /);
etape('alerte « Commande payée » reçue en direct, compteur dans le titre');
assert.equal(await stockMontre(), stockAvant - 1);
etape(`stock réservé dès la commande (${stockAvant} → ${stockAvant - 1})`);

// Le client suit sa commande ; la gérante la prépare.
await client.click('a:has-text("Suivre ma commande")'); await client.waitForSelector('.page-suivi .pastille:has-text("Payée")');
await admin.click(`.liste .ligne:has-text("#${numero}")`); await admin.waitForSelector('.detail-grille');
await admin.waitForSelector('button:has-text("Commencer la préparation")');
assert.match(await admin.locator('.detail-grille').innerText(), /Mode test \(aucun argent\)/);
etape('commande payée dans l’administration, prête à préparer');
await admin.click('button:has-text("Commencer la préparation")'); await admin.waitForSelector('button:has-text("Marquer comme expédiée")');
await admin.click('button:has-text("Marquer comme expédiée")'); await admin.waitForSelector('button:has-text("Marquer comme livrée")');
await client.waitForSelector('.page-suivi .pastille:has-text("En route")', { timeout: 10000 });
await admin.click('button:has-text("Marquer comme livrée")'); await admin.waitForSelector('text=Commande terminée');
await client.waitForSelector('.page-suivi .pastille:has-text("Livrée")', { timeout: 10000 });
etape('préparation → expédition → livraison, suivies en direct par le client');
await client.screenshot({ path: SORTIE + 'parcours-suivi.png', fullPage: true });
await admin.screenshot({ path: SORTIE + 'parcours-admin.png' });

// Annulation : une deuxième commande (envoyée comme le fait la boutique) est annulée dans l'administration, son stock revient.
const json = (corps) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
const articles = [{ productId: 'ex-p17', qty: 1 }];
const dv = await api('/api/sokoyetu/devis', json({ items: articles, zoneId: 'bukavu' }));
const autre = await api('/api/sokoyetu/commander', json({ token: 'annul' + Date.now() + 'abcdefghijklmnopqrst', termsAccepted: true, customer: { name: 'Neema Zawadi', phone: '0971112233' }, shipping: { zoneId: 'bukavu', address: 'Panzi, av. Kasongo 3' }, items: articles, payment: { method: 'mpesa', phone: '0971110000' }, total: dv.total }));
assert.ok(autre.id, JSON.stringify(autre));
const avantAnnul = await stockMontre();
await admin.goto(ADMIN + '/#/commandes/' + autre.id); await admin.waitForSelector('.detail-grille');
await admin.click('button:has-text("Annuler la commande")'); await admin.click('.feuille .btn-danger');
await admin.waitForSelector('text=Commande annulée');
assert.equal(await stockMontre(), avantAnnul + 1);
etape(`annulation confirmée par une fenêtre, article rendu au stock (${avantAnnul} → ${avantAnnul + 1})`);

// Un autre téléphone retrouve la commande avec le numéro du reçu.
const autreTel = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
await autreTel.addInitScript(() => { try { localStorage.setItem('sokoyetu:consentement', '{"mesure":false}'); } catch (e) { } });
const proche = await autreTel.newPage(); surveiller(proche, 'autre téléphone');
await proche.goto(BASE + '/compte/retrouver'); await proche.waitForSelector('.page-retrouver');
await proche.fill('.saisie-code', numero.toLowerCase()); await proche.fill('input[type=tel]', '+243 99 765 4321');
await proche.click('button[type=submit]'); await proche.waitForSelector('.page-suivi .pastille:has-text("Livrée")');
etape(`commande #${numero} retrouvée sur un autre téléphone avec son numéro`);

// L'assistant IA sans clé : message clair.
const ia = await fetch(BASE + '/api/sokoyetu/ia/produit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: jetonAdmin }, body: JSON.stringify({ image: 'aGVsbG8=', type: 'image/jpeg' }) });
const iaJ = await ia.json();
assert.ok(ia.status >= 400 && /no_key|cl/.test(JSON.stringify(iaJ)), JSON.stringify(iaJ));
etape('assistant IA non activé : refus explicite (' + ia.status + ')');

await b.close();
const graves = erreurs.filter((e) => !/ERR_ABORTED|net::ERR_|Failed to load resource: the server responded with a status of 4/.test(e));
console.log(graves.length ? '\nConsole :\n' + graves.join('\n') : '\nAucune erreur dans les consoles.');
process.exit(graves.length ? 1 : 0);
