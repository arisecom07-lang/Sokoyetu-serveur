// Sokoyetu — essai de charge : beaucoup de visiteurs en même temps sur le vrai serveur local (paiement en mode test).
//   npm run build && SOKOYETU_SIMULATION_DELAI=1 DATA=.local/charge bash outils/serveur-local.sh   (base à part, autre terminal)
//   BASE=http://127.0.0.1:8090 node tests/charge.mjs [visiteurs, 60 par défaut]
//
//  1. Les visiteurs arrivent tous en même temps, chacun depuis sa propre adresse IP : boutique, catalogue, page d'un article,
//     photos, devis, commande, puis attente de la confirmation du paiement. Aucun ne doit échouer ; temps de réponse mesurés.
//  2. Dernier exemplaire : 25 clients commandent au même instant l'article qui n'en a plus qu'un. Un seul l'obtient,
//     les autres reçoivent « rupture de stock », et le stock ne passe jamais sous zéro.
//  3. Clients d'un même opérateur mobile (une seule adresse IP pour tous) : au-delà des limites anti-abus, le serveur
//     répond 429 (« patientez ») ; jamais d'erreur 500.
// Pour donner à chaque visiteur sa propre adresse, l'essai fait lire l'en-tête X-Real-IP au serveur le temps de l'essai
// (réglage remis comme avant à la fin). Ne lancez pas cet essai sur le serveur de la boutique en ligne.
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const N = Math.max(5, Number(process.argv[2]) || 60);
const etape = (t) => console.log('✓ ' + t);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Nom de client en lettres seulement (le serveur refuse les chiffres dans un nom) : 0 → « Client Aa », 27 → « Client Bb »…
const nomClient = (i) => 'Client ' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(i / 26) % 26] + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + 'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 676) % 26];
const secret = () => Array.from({ length: 32 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[Math.floor(Math.random() * 57)]).join('');

/* ---------- Mesures ---------- */
const mesures = new Map(); // nom → { durees: [], statuts: Map }
async function appel(nom, chemin, { method = 'GET', body, ip, jeton, entetes = {} } = {}) {
  const h = { ...entetes };
  if (ip) h['X-Real-IP'] = ip;
  if (jeton) h.Authorization = jeton;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const t0 = performance.now();
  let status = 0, json = null, texte = '';
  try {
    const r = await fetch(BASE + chemin, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    status = r.status; texte = await r.text();
    try { json = JSON.parse(texte); } catch (e) { json = null; }
  } catch (e) { status = 0; texte = String(e); }
  const m = mesures.get(nom) || { durees: [], statuts: new Map() };
  m.durees.push(performance.now() - t0); m.statuts.set(status, (m.statuts.get(status) || 0) + 1);
  mesures.set(nom, m);
  return { status, json, texte };
}
const centile = (l, p) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
function bilan(titre) {
  console.log(`\n${titre}`);
  console.log('  requête             nombre   médiane     95 %   maximum   réponses');
  for (const [nom, m] of mesures) {
    const st = [...m.statuts].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(' ');
    console.log(`  ${nom.padEnd(18)} ${String(m.durees.length).padStart(6)} ${centile(m.durees, 50).toFixed(0).padStart(7)} ms ${centile(m.durees, 95).toFixed(0).padStart(6)} ms ${Math.max(...m.durees).toFixed(0).padStart(7)} ms   ${st}`);
  }
  console.log('');
  mesures.clear();
}
const erreurs5xx = () => [...mesures.values()].reduce((a, m) => a + [...m.statuts].filter(([s]) => s >= 500 || s === 0).reduce((x, [, n]) => x + n, 0), 0);

/* ---------- Préparation : comptes, adresse IP par visiteur, catalogue d'essai ---------- */
const tech = await appel('connexion', '/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: 'technique@sokoyetu.test', password: 'Technique-2026' } });
assert.equal(tech.status, 200, 'compte technique local (serveur-local.sh) : ' + tech.texte);
const gerant = await appel('connexion', '/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' } });
assert.equal(gerant.status, 200, gerant.texte);
const T = tech.json.token, G = gerant.json.token;

const reglages = (await appel('reglages', '/api/settings', { jeton: T })).json;
const avant = reglages.trustedProxy || { headers: [], useLeftmostIP: false };
assert.equal((await appel('reglages', '/api/settings', { method: 'PATCH', jeton: T, body: { trustedProxy: { headers: ['X-Real-IP'], useLeftmostIP: false } } })).status, 200);

async function ecrire(col, id, doc) {
  const r = await appel('écriture', `/api/collections/${col}/records/${id}`, { method: 'PATCH', jeton: G, body: { doc } });
  if (r.status === 404) return appel('écriture', `/api/collections/${col}/records`, { method: 'POST', jeton: G, body: { id, doc } });
  return r;
}
const lireProduit = async (id) => (await appel('lecture', `/api/collections/products/records/${id}`, { jeton: G })).json.doc;

let code = 0;
try {
  const config = (await appel('lecture', '/api/collections/config/records/store', { jeton: G })).json;
  const cfg = { ...((config && config.doc) || { name: 'Sokoyetu', city: 'Bukavu' }) };
  cfg.payments = { ...(cfg.payments || {}), mpesa: { ...((cfg.payments || {}).mpesa || {}), enabled: true } };
  assert.equal((await ecrire('config', 'store', cfg)).status, 200);
  assert.equal((await ecrire('products', 'charge-sac', { title: 'Sac d’essai de charge', price: 25, cost: 10, status: 'active', source: 'local', stock: 100000, sold: 0, images: [] })).status, 200);
  assert.equal((await ecrire('products', 'charge-dernier', { title: 'Dernier exemplaire', price: 40, cost: 15, status: 'active', source: 'local', stock: 1, sold: 0, images: [] })).status, 200);
  const devisSac = (await appel('devis', '/api/sokoyetu/devis', { method: 'POST', ip: '10.250.0.1', body: { items: [{ productId: 'charge-sac', qty: 1 }], zoneId: 'bukavu' } })).json;
  const devisDernier = (await appel('devis', '/api/sokoyetu/devis', { method: 'POST', ip: '10.250.0.2', body: { items: [{ productId: 'charge-dernier', qty: 1 }], zoneId: 'bukavu' } })).json;
  assert.ok(devisSac.total > 0 && devisDernier.total > 0, 'devis d’essai');
  const page = await appel('page', '/', { ip: '10.250.0.3' });
  const fichiers = [...new Set((page.texte.match(/(?:src|href)="(\/assets\/[^"]+)"/g) || []).map((x) => x.replace(/^(?:src|href)="|"$/g, '')))];
  mesures.clear();

  const commande = (i, ip, produit, total, token = secret()) => appel('commander', '/api/sokoyetu/commander', {
    method: 'POST', ip, body: {
      token, termsAccepted: true, customer: { name: nomClient(i), phone: '0997' + String(100000 + i).slice(-6) },
      shipping: { zoneId: 'bukavu', address: 'Ibanda, av. Kasongo 3' }, items: [{ productId: produit, qty: 1 }], discountCode: '',
      // Numéro qui ne finit jamais par 0000 (le mode test refuse ces paiements-là).
      payment: { method: 'mpesa', phone: '0998' + String(210001 + i).slice(-6) }, total
    }
  }).then((r) => Object.assign(r, { token }));

  /* 1. Visiteurs simultanés, chacun avec sa propre adresse IP. */
  const debut = performance.now();
  const parcours = await Promise.all(Array.from({ length: N }, async (_, i) => {
    const ip = `10.${1 + (i >> 8)}.${i & 255}.${1 + (i % 200)}`;
    await pause(Math.random() * 300); // arrivées dans la même seconde
    await appel('page d’accueil', '/', { ip });
    await Promise.all(fichiers.map((f) => appel('fichiers', f, { ip, entetes: { 'Accept-Encoding': 'gzip' } })));
    const cat = await appel('catalogue', '/api/sokoyetu/catalogue', { ip });
    if (cat.status !== 200) return { ok: false, pourquoi: 'catalogue ' + cat.status };
    await appel('visite', '/api/sokoyetu/visite', { method: 'POST', ip, body: { v: 'charge' + String(i).padStart(12, '0'), p: 'charge-sac', a: 'vue' } });
    await appel('page article', '/p/charge-sac/sac-d-essai-de-charge', { ip });
    const etag = await appel('catalogue (cache)', '/api/sokoyetu/catalogue', { ip, entetes: { 'If-None-Match': '"x"' } });
    if (etag.status >= 500) return { ok: false, pourquoi: 'catalogue ' + etag.status };
    const dv = await appel('devis', '/api/sokoyetu/devis', { method: 'POST', ip, body: { items: [{ productId: 'charge-sac', qty: 1 }], zoneId: 'bukavu' } });
    if (dv.status !== 200) return { ok: false, pourquoi: 'devis ' + dv.status };
    const c = await commande(i, ip, 'charge-sac', dv.json.total);
    if (c.status !== 200) return { ok: false, pourquoi: 'commande ' + c.status + ' ' + c.texte.slice(0, 120) };
    for (let k = 0; k < 40; k++) {
      await pause(1000);
      const p = await appel('suivi paiement', `/api/sokoyetu/paiement/${c.json.id}?t=${encodeURIComponent(c.token)}`, { ip });
      if (p.status !== 200) return { ok: false, pourquoi: 'suivi ' + p.status };
      if (p.json.paiement && p.json.paiement.etat === 'paid') return { ok: true };
    }
    return { ok: false, pourquoi: 'paiement jamais confirmé' };
  }));
  const duree = ((performance.now() - debut) / 1000).toFixed(1);
  const rates = parcours.filter((p) => !p.ok);
  const graves = erreurs5xx();
  bilan(`1. ${N} visiteurs en même temps, du catalogue au paiement confirmé (${duree} s au total)`);
  assert.equal(graves, 0, 'aucune erreur 500 ni coupure');
  assert.deepEqual(rates, [], 'chaque visiteur va jusqu’au paiement confirmé');
  etape(`${N} visiteurs simultanés : ${N} commandes payées, aucune erreur`);

  /* 2. Course au dernier exemplaire. */
  const nb = 25;
  const course = await Promise.all(Array.from({ length: nb }, (_, i) => commande(1000 + i, `10.200.${i}.9`, 'charge-dernier', devisDernier.total)));
  const gagnes = course.filter((r) => r.status === 200);
  const refus = course.filter((r) => r.status === 400 && r.json && r.json.champ === 'panier');
  bilan(`2. ${nb} clients commandent le dernier exemplaire au même instant`);
  assert.equal(gagnes.length, 1, 'un seul client obtient le dernier exemplaire');
  assert.equal(refus.length, nb - 1, 'les autres apprennent que l’article est épuisé : ' + course.filter((r) => r.status !== 200).map((r) => r.status).join(','));
  const stock = (await lireProduit('charge-dernier')).stock;
  assert.equal(stock, 0, 'stock à zéro, jamais négatif');
  etape(`dernier exemplaire : 1 commande sur ${nb}, ${nb - 1} « épuisé », stock final ${stock}`);

  /* 3. Même adresse IP pour tous (opérateur mobile) : limites anti-abus. */
  const ip = '10.99.99.99';
  const memes = await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    await appel('catalogue', '/api/sokoyetu/catalogue', { ip });
    return commande(2000 + i, ip, 'charge-sac', devisSac.total);
  }));
  const ok3 = memes.filter((r) => r.status === 200).length; const limites = memes.filter((r) => r.status === 429).length;
  const graves3 = erreurs5xx();
  bilan('3. 30 clients derrière la même adresse IP (même opérateur mobile)');
  assert.equal(graves3, 0, 'aucune erreur 500');
  assert.equal(ok3 + limites, 30, 'chaque réponse est soit acceptée, soit « patientez » (429)');
  assert.ok(ok3 >= 5, 'les premiers clients passent');
  etape(`même adresse IP : ${ok3} commandes acceptées, ${limites} invitées à patienter (429), aucune erreur`);
} catch (e) {
  console.error('✗ ' + (e && e.message));
  code = 1;
} finally {
  await appel('reglages', '/api/settings', { method: 'PATCH', jeton: T, body: { trustedProxy: avant } });
  etape('réglage des adresses IP remis comme avant');
}
process.exit(code);
