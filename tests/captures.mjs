// Captures d'écran de la boutique et de l'administration (contrôle visuel) + erreurs de la console.
//   node tests/captures.mjs [boutique|admin|tout] [clair|sombre]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:8090';
const ADMIN = process.env.ADMIN || 'http://admin.localhost:8090';
const SORTIE = process.env.SORTIE || '/tmp/claude-0/-home-user/4c9af478-9b7a-59ef-9660-b9b31e63d534/scratchpad/captures/';
const quoi = process.argv[2] || 'boutique';
const theme = process.argv[3] || 'clair';
await mkdir(SORTIE, { recursive: true });

const b = await chromium.launch();
const erreurs = [];
async function contexte(mobile) {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' } : { viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
  if (theme === 'sombre') await ctx.addInitScript(() => { try { localStorage.setItem('sokoyetu:theme', '"sombre"'); } catch (e) { } });
  await ctx.addInitScript(() => { try { localStorage.setItem('sokoyetu:consentement', '{"mesure":false}'); } catch (e) { } });
  return ctx;
}
function surveiller(p, nom) {
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) erreurs.push(`[${nom}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => erreurs.push(`[${nom}] pageerror: ${e.message}`));
  p.on('requestfailed', (r) => { if (!/favicon|realtime/.test(r.url())) erreurs.push(`[${nom}] échec requête: ${r.url()} ${r.failure() && r.failure().errorText}`); });
}
async function prise(p, nom, plein = false) { await p.waitForTimeout(700); await p.screenshot({ path: `${SORTIE}${nom}-${theme}.png`, fullPage: plein }); }

if (quoi === 'boutique' || quoi === 'tout') {
  const ctx = await contexte(true); const p = await ctx.newPage(); surveiller(p, 'mobile');
  await p.goto(BASE + '/'); await p.waitForSelector('.carte-produit'); await prise(p, 'm-accueil'); await prise(p, 'm-accueil-plein', true);
  await p.goto(BASE + '/categories'); await prise(p, 'm-rayons');
  await p.goto(BASE + '/p/ex-p08/chemise-en-chambray'); await p.waitForSelector('.produit-titre'); await prise(p, 'm-produit'); await prise(p, 'm-produit-plein', true);
  await p.click('.taille >> text=L'); await p.click('.barre-action .btn-primaire'); await p.waitForTimeout(900); await prise(p, 'm-produit-ajoute');
  await p.goto(BASE + '/panier'); await prise(p, 'm-panier');
  await p.click('.barre-action .btn-primaire'); await p.waitForSelector('.page-commande'); await prise(p, 'm-commande-1');
  const d = await contexte(false); const q = await d.newPage(); surveiller(q, 'ordi');
  await q.goto(BASE + '/'); await q.waitForSelector('.carte-produit'); await prise(q, 'o-accueil'); await prise(q, 'o-accueil-plein', true);
  await q.goto(BASE + '/p/ex-p10/sac-a-dos-en-cuir-marron'); await q.waitForSelector('.produit-titre'); await prise(q, 'o-produit');
  await q.goto(BASE + '/categories'); await prise(q, 'o-rayons');
}
async function connexion(p) {
  await p.goto(ADMIN + '/'); await p.waitForSelector('.connexion-carte');
  if (quoi !== 'tout' || theme === 'clair') await prise(p, p.viewportSize().width < 600 ? 'm-admin-connexion' : 'o-admin-connexion');
  await p.fill('input[type=email]', 'admin@sokoyetu.test'); await p.fill('input[autocomplete="current-password"]', 'Sokoyetu-2026');
  await p.click('button[type=submit]'); await p.waitForSelector('.kpis'); await p.waitForTimeout(600);
}
if (quoi === 'admin' || quoi === 'tout') {
  for (const mobile of [true, false]) {
    const ctx = await contexte(mobile); const p = await ctx.newPage(); const m = mobile ? 'm' : 'o'; surveiller(p, m + '-admin');
    await connexion(p); await prise(p, `${m}-admin-tableau`); await prise(p, `${m}-admin-tableau-plein`, true);
    await p.goto(ADMIN + '/#/commandes'); await p.waitForSelector('.liste .ligne'); await prise(p, `${m}-admin-commandes`);
    await p.click('.liste .ligne >> nth=2'); await p.waitForSelector('.detail-grille'); await prise(p, `${m}-admin-commande`); await prise(p, `${m}-admin-commande-plein`, true);
    await p.goto(ADMIN + '/#/produits'); await p.waitForSelector('.liste .ligne'); await prise(p, `${m}-admin-produits`);
    await p.goto(ADMIN + '/#/produits/ex-p08'); await p.waitForSelector('.grille-photos'); await prise(p, `${m}-admin-produit`); await prise(p, `${m}-admin-produit-plein`, true);
    await p.fill('input[maxlength="120"]', 'T-shirt coton homme premium'); await p.waitForTimeout(200); await prise(p, `${m}-admin-produit-modifie`);
    await p.goto(ADMIN + '/#/clients'); await p.waitForTimeout(300);
    if (await p.locator('.feuille.ouverte').count()) { await prise(p, `${m}-admin-garde`); await p.click('.feuille .btn-danger, .feuille .btn-primaire'); }
    await p.waitForSelector('.liste .ligne'); await prise(p, `${m}-admin-clients`);
    await p.goto(ADMIN + '/#/bannieres/ex-b1'); await p.waitForSelector('.apercu-heros'); await prise(p, `${m}-admin-banniere`);
    await p.goto(ADMIN + '/#/reglages/paiements'); await p.waitForSelector('.operateur-tete'); await prise(p, `${m}-admin-paiements`, true);
    await p.goto(ADMIN + '/#/plus'); await p.waitForSelector('.menu'); await prise(p, `${m}-admin-plus`);
    await p.goto(ADMIN + '/#/compte'); await p.waitForSelector('.menu'); await prise(p, `${m}-admin-compte`);
    await ctx.close();
  }
}
console.log(erreurs.length ? erreurs.join('\n') : 'Aucune erreur dans la console.');
await b.close();
