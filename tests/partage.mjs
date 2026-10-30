// Sokoyetu — partage d'un article et de tout le panier, dans de vrais navigateurs, sur le vrai serveur local :
// le lien envoyé, l'aperçu lu par WhatsApp (sans JavaScript), la page qui s'ouvre et l'ajout au panier de celui qui le reçoit.
//   npm run build && bash outils/serveur-local.sh   (autre terminal, catalogue d'exemple chargé)   puis   node tests/partage.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8090';
const P = 'sokoyetu:';
const erreurs = [];
const b = await chromium.launch();
async function telephone(largeur = 390) {
  const ctx = await b.newContext(largeur < 700 ? { viewport: { width: largeur, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' } : { viewport: { width: largeur, height: 900 }, locale: 'fr-FR' });
  await ctx.addInitScript((p) => { try { localStorage.setItem(p + 'consentement', '{"mesure":false}'); } catch (e) { } }, P);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
  return page;
}
const meta = (html, p) => ((new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`)).exec(html) || [])[1];
const entites = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// 1. Un client partage tout son panier (le téléphone n'a pas de feuille de partage ici : la fenêtre de la boutique s'ouvre).
const a = await telephone();
await a.goto(BASE + '/');
await a.evaluate((p) => localStorage.setItem(p + 'panier', JSON.stringify([{ productId: 'ex-p09', color: 'Bleu', size: 'L', qty: 2 }, { productId: 'ex-p03', qty: 1 }, { productId: 'ex-p07', qty: 1 }])), P);
await a.goto(BASE + '/panier'); await a.waitForSelector('.panier-ligne');
await a.getByRole('button', { name: 'Partager' }).click(); await a.waitForSelector('.partage-choix');
const lien = await a.inputValue('.partage-lien');
assert.equal(lien, BASE + '/panier/partage?a=ex-p09:2:Bleu:L&a=ex-p03&a=ex-p07');
const message = decodeURIComponent((await a.getAttribute('.partage-option[data-app="whatsapp"]', 'href')).replace('https://wa.me/?text=', ''));
const [, n, total] = /^Voici mon panier Sokoyetu : (\d+) articles?, (\$[\d ]+\.\d\d)\. /.exec(message) || [];
assert.ok(n && message.endsWith(' ' + lien), 'message WhatsApp : ' + message);
console.log('✓ panier partagé :', message);

// 2. WhatsApp lit la page sans JavaScript : le même nombre d'articles et le même total, l'image d'un article, jamais référencé.
const html = await (await fetch(lien, { headers: { 'User-Agent': 'WhatsApp/2.24 A' } })).text();
assert.equal(entites(meta(html, 'og:title')), `Panier partagé · ${n} articles · ${total}`);
assert.match(meta(html, 'og:image'), /\/api\/files\/media\/|\/photos\//);
assert.equal(meta(html, 'robots'), 'noindex');
console.log('✓ aperçu du lien :', entites(meta(html, 'og:title')));

// 3. La personne qui reçoit le lien (panier vide) voit les articles et le même total, puis les met dans son panier.
const c = await telephone();
await c.goto(lien); await c.waitForSelector('.ligne-recue');
assert.equal(await c.locator('.ligne-recue').count(), 3);
assert.equal((await c.locator('.barre-action .prix').innerText()).trim(), total);
await c.locator('.barre-action button', { hasText: 'Ajouter au panier' }).click();
await c.waitForURL(/\/panier$/); await c.waitForSelector('.panier-ligne');
const recu = await c.evaluate((p) => JSON.parse(localStorage.getItem(p + 'panier')).map((l) => [l.productId, l.color || '', l.size || '', l.qty]), P);
assert.deepEqual(recu, [['ex-p09', 'Bleu', 'L', 2], ['ex-p03', '', '', 1], ['ex-p07', '', '', 1]]);
// Le même lien ouvert une deuxième fois ne double rien.
await c.goto(lien); await c.waitForSelector('.ligne-recue');
assert.match(await c.locator('.barre-action').innerText(), /Voir le panier/);
console.log('✓ articles ajoutés au panier, rien de doublé à la deuxième ouverture');

// 4. Lien incomplet ou articles retirés : un message clair, pas d'erreur.
await c.goto(BASE + '/panier/partage?a=article-inconnu'); await c.waitForSelector('.vide');
assert.match(await c.locator('.vide').innerText(), /plus disponibles/);
console.log('✓ lien vers des articles retirés : message clair');

// 5. Sur ordinateur, la fiche d'un article a son bouton « Partager » ; le lien est celui de l'article.
const d = await telephone(1280);
await d.goto(BASE + '/p/ex-p03/sac-bandouliere-en-cuir-camel'); await d.waitForSelector('.produit-haut');
await d.locator('.produit-haut button', { hasText: 'Partager' }).click(); await d.waitForSelector('.partage-choix');
assert.equal(await d.inputValue('.partage-lien'), BASE + '/p/ex-p03/sac-bandouliere-en-cuir-camel');
const fiche = await (await fetch(BASE + '/p/ex-p03/sac-bandouliere-en-cuir-camel')).text();
assert.match(entites(meta(fiche, 'og:title')), /^Sac bandoulière en cuir camel · \$/);
console.log('✓ article partagé depuis un ordinateur');

await b.close();
if (erreurs.length) { console.log('Erreurs dans les consoles :\n' + erreurs.join('\n')); process.exit(1); }
console.log('Partage : article, panier et aperçus vérifiés, aucune erreur dans les consoles.');
