/*
 * Sokoyetu — accès aux données pour les hooks PocketBase.
 * Les documents sont stockés en JSON dans le champ « doc » de chaque enregistrement.
 */
const R = require(`${__hooks}/lib/regles.js`);

function lire(rec, champ) {
  try { const s = rec.getString(champ || 'doc'); const v = s ? JSON.parse(s) : {}; return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

function configuration(app) {
  let brut = {};
  try { brut = lire(app.findRecordById('config', 'store')); } catch (e) { }
  return R.config(brut);
}

/* Lecteur de produits avec cache, pour une même requête. */
function lecteurProduits(app) {
  const cache = {};
  return {
    doc(id) {
      if (!id) return null;
      if (!(id in cache)) {
        try { const rec = app.findRecordById('products', id); cache[id] = { rec, doc: lire(rec) }; } catch (e) { cache[id] = null; }
      }
      return cache[id] ? cache[id].doc : null;
    },
    rec(id) { this.doc(id); return cache[id] ? cache[id].rec : null; }
  };
}

function remiseParCode(app, code) {
  const c = R.valider.codePromo(code);
  if (!c) return null;
  try { return lire(app.findFirstRecordByData('discounts', 'code', c)); } catch (e) { return null; }
}

function estGerant(info) {
  try { return !!info && (info.hasSuperuserAuth() || (!!info.auth && info.auth.collection().name === 'admins')); } catch (e) { return false; }
}

function exigerGerant(e) {
  if (!estGerant(e.requestInfo())) throw new ForbiddenError('Réservé à l’administration de la boutique.');
}

function corps(e) {
  const b = e.requestInfo().body;
  return b && typeof b === 'object' ? b : {};
}

/* Applique au catalogue une réservation (sens -1) ou une restitution (sens +1) de stock. */
function appliquerStock(app, entrees, sens) {
  const parProduit = {};
  for (const x of entrees || []) { if (x && x.productId) (parProduit[x.productId] = parProduit[x.productId] || []).push(x); }
  for (const id of Object.keys(parProduit)) {
    let rec; try { rec = app.findRecordById('products', id); } catch (e) { continue; }
    const doc = R.ajusterStock(lire(rec), parProduit[id], sens);
    doc.updatedAt = Date.now();
    rec.set('doc', doc);
    app.save(rec);
  }
}

/* Vue « client » d'une commande : sans coûts d'achat, notes internes ni détails de stock. */
function commandePublique(doc) {
  const d = R.copie(doc);
  const aVerifier = Array.isArray(d.issues) && d.issues.length > 0;
  delete d.adminNote; delete d.issues; delete d.reserved; delete d.stockApplied; delete d.declaredTotal;
  (d.items || []).forEach((i) => { delete i.cost; delete i.available; });
  d.review = aVerifier && d.status !== 'cancelled' && !(d.payment && d.payment.status === 'paid');
  return d;
}

function produitPublic(doc) {
  const d = R.copie(doc);
  delete d.cost;
  return d;
}

function versRecord(rec) {
  return Object.assign({}, lire(rec), { id: rec.id });
}

module.exports = { R, lire, configuration, lecteurProduits, remiseParCode, estGerant, exigerGerant, corps, appliquerStock, commandePublique, produitPublic, versRecord };
