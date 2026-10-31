// Sokoyetu — notifications du téléphone de bout en bout, avec un faux service de notification (comme Google ou Mozilla) :
// le serveur lui envoie un signal sans contenu signé par sa clé VAPID (vérifiée ici par OpenSSL), puis le « téléphone »
// vient chercher le texte comme le ferait le service worker. Un abonnement révoqué (410) est oublié.
//   npm run build && SOKOYETU_PUSH_ESSAI=http://127.0.0.1:8099 SOKOYETU_SIMULATION_DELAI=1 DATA=.local/essai-push bash outils/serveur-local.sh
//   node tests/push.mjs        (attend la tournée des notifications : jusqu'à une minute)
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const SERVICE = 'http://127.0.0.1:8099';
const recus = [];
const etape = (t) => console.log('✓ ' + t);

async function api(chemin, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(BASE + chemin, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch (e) { }
  return { status: r.status, json, texte };
}
const secret = () => crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 32);
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Faux service de notification : vérifie l'en-tête VAPID comme le ferait Google, répond 201 (ou 410 pour /push/revoque…).
const service = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(req.headers.authorization || '');
    let ok = false, jeton = null;
    if (m) {
      const [entete, contenu, signature] = m[1].split('.');
      const k = Buffer.from(m[2], 'base64url');
      const cle = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: k.subarray(1, 33).toString('base64url'), y: k.subarray(33).toString('base64url') }, format: 'jwk' });
      ok = crypto.verify('sha256', Buffer.from(entete + '.' + contenu), { key: cle, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
      jeton = { entete: JSON.parse(Buffer.from(entete, 'base64url')), contenu: JSON.parse(Buffer.from(contenu, 'base64url')), cle: m[2] };
    }
    recus.push({ url: req.url, methode: req.method, ok, jeton, ttl: req.headers.ttl, urgence: req.headers.urgency, corps });
    if (!ok) { res.writeHead(403); res.end('invalid JWT'); return; }
    res.writeHead(req.url.startsWith('/push/revoque') ? 410 : 201); res.end();
  });
});
await new Promise((ok) => service.listen(8099, '127.0.0.1', ok));

// Catalogue de test minimal (compte administrateur du serveur local).
const admin = (await api('/api/collections/admins/auth-with-password', { method: 'POST', body: { identity: 'admin@sokoyetu.test', password: 'Sokoyetu-2026' } })).json.token;
const ecrire = async (col, id, doc) => {
  const r = await api(`/api/collections/${col}/records/${id}`, { method: 'PATCH', headers: { Authorization: admin }, body: { doc } });
  if (r.status === 404) await api(`/api/collections/${col}/records`, { method: 'POST', headers: { Authorization: admin }, body: { id, doc } });
};
await ecrire('config', 'store', { name: 'Sokoyetu', city: 'Bukavu', payments: { mpesa: { enabled: true } }, freeShippingOver: 0 });
await ecrire('products', 'p-push', { title: 'Montre d’essai', price: 15, status: 'active', source: 'import', images: [] });

const appareil = secret();
const cleVapid = (await api('/api/sokoyetu/push/cle')).json.cle;
const abonnement = (chemin) => ({ endpoint: SERVICE + chemin + secret(), keys: { auth: crypto.randomBytes(16).toString('base64url'), p256dh: Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString('base64url') } });
const bon = abonnement('/push/'), revoque = abonnement('/push/revoque-');
for (const ab of [bon, revoque]) assert.equal((await api('/api/sokoyetu/push/abonner', { method: 'POST', body: { abonnement: ab, appareil, langue: 'fr' } })).status, 200);
etape('deux téléphones abonnés (le second sera révoqué par son navigateur)');

const t = secret();
const c = await api('/api/sokoyetu/commander', { method: 'POST', body: { token: t, termsAccepted: true, appareil, customer: { name: 'Client Push', phone: '0871234567' }, shipping: { zoneId: 'bukavu', address: 'Av. Lumumba 12' }, items: [{ productId: 'p-push', qty: 1 }], payment: { method: 'mpesa', phone: '0871234567' }, total: 17.3 } });
assert.equal(c.status, 200, c.texte);
for (let i = 0; i < 40; i++) { const p = await api(`/api/sokoyetu/paiement/${c.json.id}?t=${t}`); if (p.json && p.json.paiement.etat === 'paid') break; await pause(500); }
etape(`commande #${c.json.order.number} payée : notification créée`);

// La tournée des notifications passe chaque minute.
const debut = Date.now();
while (recus.length < 2 && Date.now() - debut < 75000) await pause(1000);
assert.equal(recus.length, 2, 'les deux téléphones ont reçu un signal');
for (const r of recus) {
  assert.equal(r.ok, true, 'signature VAPID valide');
  assert.deepEqual([r.methode, r.corps, r.jeton.entete, r.jeton.contenu.aud, r.jeton.cle, r.urgence], ['POST', '', { typ: 'JWT', alg: 'ES256' }, SERVICE, cleVapid, 'high']);
  assert.ok(r.jeton.contenu.exp * 1000 > Date.now() && r.jeton.contenu.exp * 1000 < Date.now() + 24 * 3600e3);
  assert.match(r.jeton.contenu.sub, /^https:\/\//);
  assert.ok(Number(r.ttl) > 0);
}
etape(`signal reçu en ${Math.round((Date.now() - debut) / 1000)} s, sans contenu, jeton VAPID signé et vérifié par OpenSSL`);

const lu = await api('/api/sokoyetu/push/attente', { method: 'POST', body: { endpoint: bon.endpoint, auth: bon.keys.auth } });
assert.deepEqual(lu.json.notifications.map((n) => [n.titre, n.url]), [['Paiement reçu', `/suivi/${c.json.id}`]]);
etape('le téléphone a lu sa notification : « ' + lu.json.notifications[0].titre + ' — ' + lu.json.notifications[0].texte + ' »');
assert.equal((await api('/api/sokoyetu/push/attente', { method: 'POST', body: { endpoint: revoque.endpoint, auth: revoque.keys.auth } })).status, 404);
etape('abonnement révoqué (410) oublié par le serveur');

// Rien de nouveau : pas de second signal à la tournée suivante.
const n = recus.length;
await pause(62000);
assert.equal(recus.length, n, 'aucun signal en double');
etape('aucun signal en double à la tournée suivante');
service.close();
