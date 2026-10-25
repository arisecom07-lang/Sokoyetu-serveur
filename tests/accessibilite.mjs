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
await controler('Admin · connexion', ADMIN + '/', '.connexion-carte');
await p.fill('input[type=email]', 'admin@sokoyetu.test'); await p.fill('input[autocomplete="current-password"]', 'Sokoyetu-2026'); await p.click('button[type=submit]'); await p.waitForSelector('.kpis');
await controler('Admin · tableau de bord', ADMIN + '/#/', '.kpis');
await controler('Admin · commandes', ADMIN + '/#/commandes', '.liste .ligne');
await controler('Admin · commande', ADMIN + '/#/commandes', '.liste .ligne', async () => { await p.click('.liste .ligne >> nth=0'); await p.waitForSelector('.detail-grille'); });
await controler('Admin · produits', ADMIN + '/#/produits', '.liste .ligne');
await controler('Admin · fiche produit', ADMIN + '/#/produits/ex-p08', '.grille-photos');
await controler('Admin · réglages paiements', ADMIN + '/#/reglages/paiements', '.operateur-tete');
await controler('Admin · compte', ADMIN + '/#/compte', '.menu');
await b.close();
console.log(total ? `\n${total} problème(s) d’accessibilité.` : '\nAucune violation d’accessibilité détectée.');
process.exit(total ? 1 : 0);
