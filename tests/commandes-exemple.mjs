// Sokoyetu — crée quelques commandes de test (statuts variés, réparties sur 10 jours) dans un serveur local.
//   node tests/commandes-exemple.mjs      (après outils/charger-exemple.mjs ; serveur en paiement de test)
import { randomBytes } from 'node:crypto';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const JOUR = 864e5;
const json = { 'Content-Type': 'application/json' };
const connexion = async (col, identity, password) => (await (await fetch(`${BASE}/api/collections/${col}/auth-with-password`, { method: 'POST', headers: json, body: JSON.stringify({ identity, password }) })).json()).token;
const admin = { ...json, Authorization: await connexion('admins', 'admin@sokoyetu.test', 'Sokoyetu-2026') };
// Les commandes ne se retouchent que par le compte technique (dates vieillies pour les graphiques).
const technique = { ...json, Authorization: await connexion('_superusers', 'technique@sokoyetu.test', 'Technique-2026') };
const jeton = () => randomBytes(20).toString('hex');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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
// Paiement : 'paye' (confirmé par le mode test), 'refuse' (numéro en 0000), 'echu' (refusé puis délai dépassé).
const PAIEMENT = ['paye', 'paye', 'refuse', 'paye', 'paye', 'echu'];
const SUITES = [['preparing', 'shipped', 'delivered'], [], [], ['preparing', 'shipped'], ['preparing'], []];
const AGE = [9, 6, 0, 2, 1, 4];

async function etat(id, t) { return (await (await fetch(`${BASE}/api/sokoyetu/paiement/${id}?t=${t}`)).json()); }
async function attendre(id, t, voulu) {
  for (let i = 0; i < 60; i++) { const r = await etat(id, t); if (r.paiement && voulu.includes(r.paiement.etat)) return r; await pause(500); }
  throw new Error('paiement bloqué');
}

for (let i = 0; i < CLIENTS.length; i++) {
  const [name, phone, zoneId, address] = CLIENTS[i];
  const devis = await (await fetch(BASE + '/api/sokoyetu/devis', { method: 'POST', headers: json, body: JSON.stringify({ items: PANIERS[i], zoneId }) })).json();
  const t = jeton();
  const payeur = PAIEMENT[i] === 'paye' ? phone : phone.slice(0, 6) + '0000';
  const r = await fetch(BASE + '/api/sokoyetu/commander', { method: 'POST', headers: json, body: JSON.stringify({
    token: t, termsAccepted: true, customer: { name, phone }, shipping: { zoneId, address, landmark: i === 0 ? 'En face de la paroisse' : '' },
    items: PANIERS[i], discountCode: '', payment: { method: METHODES[i], phone: payeur }, total: devis.total, note: i === 1 ? 'Appelez avant de passer, merci.' : ''
  }) });
  const o = await r.json();
  if (!r.ok) { console.error(name, r.status, o); continue; }
  await attendre(o.id, t, PAIEMENT[i] === 'paye' ? ['paid'] : ['failed']);
  for (const action of SUITES[i]) await fetch(`${BASE}/api/sokoyetu/commandes/${o.id}`, { method: 'POST', headers: admin, body: JSON.stringify({ action }) });
  if (AGE[i] || PAIEMENT[i] === 'echu') {
    const rec = await (await fetch(`${BASE}/api/collections/orders/records/${o.id}`, { headers: admin })).json();
    const d = AGE[i] * JOUR + i * 3600e3; const p = rec.doc.payment || {};
    const avant = (x) => (x ? x - d : x);
    const doc = { ...rec.doc, createdAt: avant(rec.doc.createdAt), expiresAt: PAIEMENT[i] === 'echu' ? Date.now() - 1000 : avant(rec.doc.expiresAt),
      preparingAt: avant(rec.doc.preparingAt), shippedAt: avant(rec.doc.shippedAt), deliveredAt: avant(rec.doc.deliveredAt),
      payment: { ...p, startedAt: avant(p.startedAt), paidAt: avant(p.paidAt), failedAt: avant(p.failedAt) },
      delivery: rec.doc.delivery ? { ...rec.doc.delivery, at: avant(rec.doc.delivery.at) } : rec.doc.delivery,
      timeline: (rec.doc.timeline || []).map((e) => ({ ...e, at: e.at - d })) };
    const x = await fetch(`${BASE}/api/collections/orders/records/${o.id}`, { method: 'PATCH', headers: technique, body: JSON.stringify({ doc }) });
    if (!x.ok) console.error(name, 'dates', x.status, await x.text());
    if (PAIEMENT[i] === 'echu') await etat(o.id, t); // annulée à l'échéance
  }
  const fin = await etat(o.id, t);
  console.log(`#${o.order.number} ${name} · ${o.order.total} $ · ${fin.paiement.etat}${SUITES[i].length ? ' → ' + SUITES[i].join(' → ') : ''}`);
}
