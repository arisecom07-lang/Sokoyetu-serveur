// Sokoyetu — contrôle d'accessibilité automatique (axe-core, règles WCAG 2.2 A/AA) des pages principales.
//   node tests/accessibilite.mjs [clair|sombre]     (serveur local lancé, catalogue d'exemple chargé)
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE || 'http://localhost:8090';
const ADMIN = process.env.ADMIN || 'http://admin.localhost:8090';
const theme = process.argv[2] || 'clair';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', reducedMotion: 'reduce', bypassCSP: true });
await ctx.addInitScript((sombre) => { try { localStorage.setItem('sokoyetu:consentement', '{"mesure":false}'); if (sombre) localStorage.setItem('sokoyetu:theme', '"sombre"'); } catch (e) { } }, theme === 'sombre');
const p = await ctx.newPage();
let total = 0;
async function controler(nom, url, attendre, avant) {
  await p.goto(url); await p.waitForSelector(attendre); if (avant) await avant(); await p.waitForTimeout(500);
  await p.addScriptTag({ content: axe });
  const r = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, aide: v.help, cibles: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + (n.any[0] ? ' — ' + n.any[0].message : '')) })));
  total += r.length;
  console.log(`${r.length ? '✗' : '✓'} ${nom}${r.length ? '' : ' : aucune violation'}`);
  for (const v of r) console.log(`   [${v.impact}] ${v.id} : ${v.aide}\n      ${v.cibles.join('\n      ')}`);
}
await controler('Boutique · accueil', BASE + '/', '.carte-produit');
await controler('Boutique · rayons', BASE + '/categories', '.page');
await controler('Boutique · produit', BASE + '/p/ex-p08/chemise-en-chambray', '.produit-titre');
await controler('Boutique · recherche', BASE + '/recherche?q=sac', '.page');
await controler('Boutique · panier', BASE + '/panier', '.page', async () => { });
await controler('Boutique · infos', BASE + '/infos/conditions', '.page');
// Paiement, reçu et suivi : deux commandes de test (paiement accepté, paiement refusé), suivies sur ce téléphone.
const json = (corps) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
async function commande(payeur) {
  const items = [{ productId: 'ex-p15', qty: 1 }];
  const dv = await (await fetch(BASE + '/api/sokoyetu/devis', json({ items, zoneId: 'retrait' }))).json();
  const t = 'axe' + Date.now() + Math.random().toString(16).slice(2, 12) + 'abcdefghij';
  const r = await (await fetch(BASE + '/api/sokoyetu/commander', json({ token: t, termsAccepted: true, customer: { name: 'Essai Accès', phone: '0991231234' }, shipping: { zoneId: 'retrait' }, items, payment: { method: 'mpesa', phone: payeur }, total: dv.total }))).json();
  return { id: r.id, t };
}
const jetonAdmin = (await (await fetch(BASE + '/api/collections/admins/auth-with-password', json({ identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' }))).json()).token;
const article = await (await fetch(BASE + '/api/collections/products/records/ex-p15', { headers: { Authorization: jetonAdmin } })).json();
await fetch(BASE + '/api/collections/products/records/ex-p15', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: jetonAdmin }, body: JSON.stringify({ doc: { ...article.doc, stock: 10 } }) });
const payee = await commande('0991231234'); const refusee = await commande('0991230000');
await p.evaluate((l) => { localStorage.setItem('sokoyetu:mesCommandes', JSON.stringify(l)); localStorage.setItem('sokoyetu:panier', JSON.stringify([{ productId: 'ex-p15', qty: 1 }])); }, [payee, refusee]);
await controler('Boutique · commande : avec ou sans compte', BASE + '/commander', '.page-choix-compte');
await controler('Boutique · créer un compte', BASE + '/compte/connexion?pour=commande&retour=/commander', '.page-connexion');
await controler('Boutique · code de connexion', BASE + '/compte/connexion?retour=/compte', '.page-connexion', async () => {
  await p.fill('input[type=tel]', '0991239999'); await p.click('button[type=submit]'); await p.waitForSelector('.saisie-otp');
});
await p.evaluate(() => sessionStorage.setItem('sokoyetu:sansCompte', 'true'));
await controler('Boutique · commande, paiement', BASE + '/commander', '.page-commande', async () => {
  await p.fill('input[autocomplete="name"]', 'Essai Accès'); await p.fill('input[type=tel]', '0991231234'); await p.click('.choix >> text=Retrait');
  await p.click('.barre-action .btn-primaire'); await p.waitForSelector('.carte-paiement');
});
await controler('Boutique · paiement refusé', BASE + '/paiement/' + refusee.id, '.paiement-attente.en-echec');
await controler('Boutique · reçu', BASE + '/merci/' + payee.id, '.recu');
await controler('Boutique · suivi', BASE + '/suivi/' + payee.id, '.page-suivi');
await controler('Boutique · retrouver une commande', BASE + '/compte/retrouver', '.page-retrouver');
await controler('Admin · connexion', ADMIN + '/', '.connexion-carte');
await p.fill('input[type=email]', 'admin@sokoyetu.test'); await p.fill('input[autocomplete="current-password"]', 'Sokoyetu-2026'); await p.click('button[type=submit]'); await p.waitForSelector('.kpis');
await controler('Admin · tableau de bord', ADMIN + '/#/', '.kpis');
await controler('Admin · commandes', ADMIN + '/#/commandes', '.liste .ligne');
await controler('Admin · commande', ADMIN + '/#/commandes', '.liste .ligne', async () => { await p.click('.liste .ligne >> nth=0'); await p.waitForSelector('.detail-grille'); });
await controler('Admin · produits', ADMIN + '/#/produits', '.liste .ligne');
await controler('Admin · fiche produit', ADMIN + '/#/produits/ex-p08', '.grille-photos');
await controler('Admin · réglages paiements', ADMIN + '/#/reglages/paiements', '.operateur-tete');
await controler('Admin · compte', ADMIN + '/#/compte', '.menu');
await controler('Admin · clients', ADMIN + '/#/clients', '.page, .liste');
await controler('Admin · audience', ADMIN + '/#/audience', '.kpis');
await b.close();
console.log(total ? `\n${total} problème(s) d’accessibilité.` : '\nAucune violation d’accessibilité détectée.');
process.exit(total ? 1 : 0);
