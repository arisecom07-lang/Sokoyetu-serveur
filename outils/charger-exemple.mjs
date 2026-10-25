// Sokoyetu — charge le catalogue d'exemple dans un serveur (tests, démonstration).
//   BASE=http://127.0.0.1:8090 EMAIL=admin@sokoyetu.test MOT_DE_PASSE=Sokoyetu-2026 node outils/charger-exemple.mjs
import { readFile } from 'node:fs/promises';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const r = await fetch(BASE + '/api/collections/admins/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: process.env.EMAIL || 'admin@sokoyetu.test', password: process.env.MOT_DE_PASSE || 'Sokoyetu-2026' }) });
const { token } = await r.json();
const h = { 'Content-Type': 'application/json', Authorization: token };
const d = JSON.parse(await readFile(new URL('../src/admin/public/exemple-catalogue.json', import.meta.url), 'utf8'));
const maintenant = Date.now();
async function ecrire(col, id, doc) {
  let x = await fetch(`${BASE}/api/collections/${col}/records/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ doc }) });
  if (x.status === 404) x = await fetch(`${BASE}/api/collections/${col}/records`, { method: 'POST', headers: h, body: JSON.stringify({ id, doc }) });
  if (!x.ok) throw new Error(`${col}/${id} : ${x.status} ${await x.text()}`);
}
for (const k of ['collections', 'products', 'banners', 'discounts']) {
  for (const x of d[k] || []) { const { id, ageDays, ...doc } = x; if (k === 'products') doc.createdAt = maintenant - (ageDays || 0) * 864e5; await ecrire(k, id, doc); }
}
const cfg = { name: 'Sokoyetu', city: 'Bukavu', whatsapp: '0991234567', ownerName: 'Messir',
  payments: { mpesa: { enabled: true }, airtel: { enabled: true }, orange: { enabled: true } }, serviceFeePct: 2,
  legal: { company: 'Sokoyetu SARL', address: 'av. Patrice Lumumba n° 12, Ibanda, Bukavu', email: 'contact@sokoyakwetu.com' } };
if (process.env.CONFIG !== 'non') await ecrire('config', 'store', cfg);
console.log('Catalogue d’exemple chargé.');
