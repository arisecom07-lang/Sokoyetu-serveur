// Sokoyetu — crée quelques commandes de test (statuts variés, réparties sur 10 jours) dans un serveur local.
//   node tests/commandes-exemple.mjs      (après outils/charger-exemple.mjs)
import { randomBytes } from 'node:crypto';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const JOUR = 864e5;

const auth = await (await fetch(BASE + '/api/collections/admins/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' }) })).json();
const h = { 'Content-Type': 'application/json', Authorization: auth.token };
const jeton = () => randomBytes(20).toString('hex');

const CLIENTS = [
  ['Grâce Mapendo', '0991234501', 'bukavu', 'Nyawera, av. Lumumba 12'], ['Patient Bisimwa', '0971234502', 'goma', 'Himbi, av. du Lac 4'],
  ['Esther Furaha', '0891234503', 'bukavu', 'Ibanda, Q. Ndendere 33'], ['Josué Mugisho', '0991234504', 'retrait', ''],
  ['Chantal Neema', '0971234505', 'bukavu', 'Kadutu, av. Industrielle 8'], ['Didier Kambale', '0821234506', 'goma', 'Katindo, av. Mapendo 21']
];
const PANIERS = [
  [{ productId: 'ex-p08', size: 'L', qty: 2 }, { productId: 'ex-p17', qty: 1 }],
  [{ productId: 'ex-p10', qty: 1 }],
  [{ productId: 'ex-p05', qty: 1 }, { productId: 'ex-p13', qty: 1 }],
  [{ productId: 'ex-p15', qty: 1 }],
  [{ productId: 'ex-p01', size: 'M', qty: 1 }, { productId: 'ex-p04', qty: 1 }],
  [{ productId: 'ex-p18', qty: 2 }]
];
const METHODES = ['mpesa', 'airtel', 'orange', 'mpesa', 'airtel', 'mpesa'];
const SUITES = [['paid', 'preparing', 'shipped', 'delivered'], ['paid'], [], ['paid', 'preparing', 'shipped'], ['paid', 'preparing'], []];
const AGE = [9, 6, 4, 2, 1, 0];

for (let i = 0; i < CLIENTS.length; i++) {
  const [name, phone, zoneId, address] = CLIENTS[i];
  const devis = await (await fetch(BASE + '/api/sokoyetu/devis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: PANIERS[i], zoneId }) })).json();
  const r = await fetch(BASE + '/api/sokoyetu/commander', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    token: jeton(), termsAccepted: true, customer: { name, phone }, shipping: { zoneId, address, landmark: i === 0 ? 'En face de la paroisse' : '' },
    items: PANIERS[i], discountCode: '', payment: { method: METHODES[i], ref: `TX${2410 + i}.${(1000 + i * 37).toString(36).toUpperCase()}`, sender: i % 2 ? '' : phone }, total: devis.total, note: i === 1 ? 'Appelez avant de passer, merci.' : ''
  }) });
  const o = await r.json();
  if (!r.ok) { console.error(name, r.status, o); continue; }
  for (const action of SUITES[i]) await fetch(`${BASE}/api/sokoyetu/commandes/${o.id}`, { method: 'POST', headers: h, body: JSON.stringify({ action }) });
  if (AGE[i]) {
    const rec = await (await fetch(`${BASE}/api/collections/orders/records/${o.id}`, { headers: h })).json();
    const decale = AGE[i] * JOUR + i * 3600e3;
    const doc = { ...rec.doc, createdAt: rec.doc.createdAt - decale, timeline: (rec.doc.timeline || []).map((e) => ({ ...e, at: e.at - decale })) };
    await fetch(`${BASE}/api/collections/orders/records/${o.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ doc }) });
  }
  console.log(`#${o.order.number} ${name} · ${o.order.total} $ · ${SUITES[i].join(' → ') || 'à vérifier'}`);
}
