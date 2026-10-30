// Sokoyetu — recherche dans de vrais navigateurs, sur le vrai serveur local (catalogue d'exemple chargé) :
// fautes corrigées, suggestions, recherches populaires, liste de l'en-tête au clavier (et son accessibilité),
// recherche sans résultat comptée pour la boutique.
//   npm run build && bash outils/serveur-local.sh   (autre terminal)   puis   node tests/recherche.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = process.env.BASE || 'http://localhost:8090';
const P = 'sokoyetu:';
const erreurs = [];
const json = (corps, ua) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua || 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile' }, body: JSON.stringify(corps) });

// Deux appareils ont cherché « sac à dos » (signal anonyme, comme celui de la boutique) : la recherche devient populaire.
for (const v of ['essairecherche' + Date.now().toString(36) + 'aaaa', 'essairecherche' + Date.now().toString(36) + 'bbbb']) {
  await fetch(BASE + '/api/sokoyetu/visite', json({ v, p: '', a: 'recherche', q: 'sac à dos', n: 1 }));
}
const b = await chromium.launch();
async function page(mobile) {
  // Navigateur sans fenêtre : le serveur ne compte pas les robots (« HeadlessChrome »), on se présente comme un vrai téléphone.
  const ua = mobile ? 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', userAgent: ua } : { viewport: { width: 1280, height: 900 }, locale: 'fr-FR', userAgent: ua, bypassCSP: true }); // bypassCSP : pour charger axe-core
  await ctx.addInitScript((p) => { try { localStorage.setItem(p + 'consentement', '{"mesure":true}'); } catch (e) { } }, P);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  p.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));
  return p;
}
const statut = (p) => p.locator('main [role=status]').innerText().then((t) => t.trim());

// 1. Téléphone : champ vide → recherches populaires, écrites comme dans le catalogue.
const t = await page(true);
await t.goto(BASE + '/recherche'); await t.waitForSelector('main h2:text("Recherches populaires")', { timeout: 15000 });
assert.ok((await t.locator('main .puce', { hasText: 'sac à dos' }).count()) > 0, 'recherche populaire « sac à dos »');
console.log('✓ recherches populaires proposées');

// 2. Fautes : la recherche est corrigée et annoncée, les résultats sont ceux du mot corrigé.
await t.fill('.recherche-mobile input', 'monter');
await t.waitForFunction(() => /pour « montre »/.test(document.querySelector('main [role=status]')?.innerText || ''));
assert.match(await statut(t), /^3 résultats pour « montre » · vous avez écrit « monter »$/);
for (const [q, attendu] of [['saa', /pour « montre »/], ['chosure', /pour « chaussures »/], ['lunetes', /pour « lunettes »/], ['mkoba', /3 résultats pour « sac »/]]) {
  await t.fill('.recherche-mobile input', q);
  await t.waitForFunction((re) => new RegExp(re).test(document.querySelector('main [role=status]')?.innerText || ''), attendu.source);
}
console.log('✓ fautes, sons proches et mots swahili compris');

// 3. Suggestions en puces : la première devient la recherche.
await t.fill('.recherche-mobile input', 'bra'); await t.waitForSelector('.puces-suggestions .puce');
const puce = (await t.locator('.puces-suggestions .puce').first().innerText()).trim();
await t.locator('.puces-suggestions .puce').first().click();
assert.equal(await t.inputValue('.recherche-mobile input'), puce);
assert.match(await statut(t), new RegExp(`pour « ${puce} »`));
console.log('✓ suggestion choisie :', puce);

// 4. Sans résultat : message clair, recherches des clients proposées ; la recherche est comptée pour la boutique.
const mot = 'perruque' + Date.now().toString(36).slice(-3).replace(/[0-9]/g, 'x');
await t.fill('.recherche-mobile input', mot); await t.waitForSelector('main .vide');
assert.match(await t.locator('main .vide').innerText(), /Aucun article trouvé/);
await t.waitForTimeout(2600); // la recherche est comptée quand on s'arrête de taper
const jeton = (await (await fetch(BASE + '/api/collections/admins/auth-with-password', json({ identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' }))).json()).token;
const r = await (await fetch(BASE + '/api/sokoyetu/audience?jours=1', { headers: { Authorization: jeton } })).json();
assert.ok(r.recherches.sansResultat.some((x) => x.terme === mot), 'recherche sans résultat visible par la boutique');
console.log('✓ recherche sans résultat comptée pour la boutique');

// 5. Ordinateur : liste de l'en-tête (populaires, suggestions, articles), au clavier, accessible.
const o = await page(false);
await o.goto(BASE + '/'); await o.waitForSelector('.recherche-ordi input');
await o.click('.recherche-ordi input'); await o.waitForSelector('#suggestions-ordi:not([hidden])');
assert.ok((await o.locator('#suggestions-ordi [role=option]', { hasText: 'sac à dos' }).count()) > 0);
await o.keyboard.type('mont', { delay: 30 });
await o.waitForSelector('#suggestions-ordi .sug-article');
await o.addScriptTag({ content: axe });
const violations = await o.evaluate(async () => (await window.axe.run(document.querySelector('header'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => v.id + ' : ' + v.nodes.map((n) => n.target.join(' ')).join(', ')));
assert.deepEqual(violations, [], 'liste de suggestions accessible');
await o.keyboard.press('ArrowDown'); await o.keyboard.press('ArrowDown');
const choix = (await o.locator('#suggestions-ordi [aria-selected=true]').innerText()).trim();
assert.equal(await o.getAttribute('.recherche-ordi input', 'aria-activedescendant'), 'sug-1');
await o.keyboard.press('Enter'); await o.waitForURL(/\/recherche\?q=/);
assert.equal(decodeURIComponent(new URL(o.url()).searchParams.get('q')), choix);
await o.waitForFunction(() => /résultat/.test(document.querySelector('main [role=status]')?.innerText || ''));
await o.click('.recherche-ordi input'); await o.keyboard.press('Escape');
assert.equal(await o.getAttribute('.recherche-ordi input', 'aria-expanded'), 'false');
console.log('✓ liste de l’en-tête au clavier :', choix);

await b.close();
if (erreurs.length) { console.log('Erreurs dans les consoles :\n' + erreurs.join('\n')); process.exit(1); }
console.log('Recherche : fautes, suggestions, populaires et clavier vérifiés, aucune erreur dans les consoles.');
