/*
 * Sokoyetu — fidélité : cagnotte et parrainage (réglages loyalty et referral, fermés tant que la boutique ne les ouvre pas).
 *
 * Cagnotte : chaque commande livrée rapporte loyalty.pct % de ses articles payés (gain fixé à la commande, doc.loyalty) au
 * téléphone du client : celui de son compte, sinon celui de la commande (le client qui crée ensuite son compte la retrouve).
 * Connecté à son compte, il l'utilise sur ses commandes suivantes, jusqu'à la moitié des articles (regles.devis).
 * Solde = gains (sokoyetu_cagnotte, un par commande, jamais deux fois) − ce que le compte a utilisé sur ses commandes non
 * annulées (doc.wallet.used) : une commande annulée rend aussitôt ce qu'elle avait pris. Le solde est relu dans la
 * transaction de la commande : deux commandes simultanées ne dépensent jamais deux fois la même cagnotte.
 *
 * Parrainage : chaque client a son code (clients.parrain_code) et son lien /?parrain=CODE. Le filleul, connecté à un compte
 * qui n'a encore jamais commandé, reçoit referral.welcome $ sur sa première commande (dès referral.min $ d'achat, sans code
 * promo) ; le parrain gagne referral.reward $ dans sa cagnotte quand cette commande est livrée, et en est prévenu.
 * Notifications gratuites seulement (lib/notifications.js).
 */
const S = require(`${__hooks}/lib/serveur.js`); const R = S.R;

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_GESTE = 100;               // la boutique offre au plus 100 $ d'un coup (geste commercial)

function lignes(app, sql, params, modele) {
  const l = arrayOf(new DynamicModel(modele));
  app.db().newQuery(sql).bind(params || {}).all(l);
  return l;
}
// -0 : nombre à virgule (montants) ; 0 : nombre entier.
const somme = (app, sql, params) => Number(lignes(app, sql, params, { n: -0 })[0].n) || 0;
/* Valeur d'un document de commande lue en SQL (jamais d'erreur sur un document illisible). */
const champ = (chemin) => `(CASE WHEN json_valid(doc) THEN json_extract(doc, '${chemin}') END)`;

/* Gains d'un téléphone (chiffres seulement, comme orders.phone). */
const gains = (app, tel) => (tel ? somme(app, 'SELECT COALESCE(SUM(montant), 0) AS n FROM sokoyetu_cagnotte WHERE telephone = {:t}', { t: tel }) : 0);
/* Ce qu'un compte a utilisé sur ses commandes non annulées. */
const utilise = (app, client) => (client ? somme(app, `SELECT COALESCE(SUM(CAST(${champ('$.wallet.used')} AS REAL)), 0) AS n FROM orders WHERE client = {:c} AND status != 'cancelled'`, { c: client }) : 0);
const telephoneDe = (compte) => R.chiffres(compte.getString('phone'));

/* Solde de la cagnotte d'un compte client, au cent près ; jamais négatif. */
function solde(app, compte) {
  if (!compte) return 0;
  return Math.max(0, R.arrondi(gains(app, telephoneDe(compte)) - utilise(app, compte.id)));
}

/* Le compte n'a encore jamais commandé (connecté, ou sans compte avec son téléphone) : seules comptent les commandes non annulées. */
function premiereCommande(app, compte) {
  return !somme(app, "SELECT COUNT(*) AS n FROM orders WHERE status != 'cancelled' AND (client = {:c} OR (phone != '' AND phone = {:p}))", { c: compte.id, p: telephoneDe(compte) });
}

function parrainDuCode(app, code) {
  const c = R.codeParrainValide(code);
  if (!c) return null;
  try { return app.findFirstRecordByData('clients', 'parrain_code', c); } catch (e) { return null; }
}

/* Code de parrainage du compte, créé au premier besoin (6 caractères tirés au sort, jamais deux fois le même). */
function codeDe(app, compte) {
  if (compte.getString('parrain_code')) return compte.getString('parrain_code');
  for (let i = 0; i < 10; i++) {
    // Sans réenregistrer le compte (son panier peut changer au même moment) ; l'index unique refuse un code déjà pris.
    try { app.db().newQuery("UPDATE clients SET parrain_code = {:k} WHERE id = {:id} AND parrain_code = ''").bind({ k: $security.randomStringWithAlphabet(6, ALPHABET), id: compte.id }).execute(); }
    catch (e) { continue; }
    let code = ''; try { code = app.findRecordById('clients', compte.id).getString('parrain_code'); } catch (e) { return ''; }
    if (code) return code;
  }
  return '';
}

/* Lien de parrainage ouvert (?code=K7M2QX) : prénom du parrain (« Grâce M. ») et cadeau du filleul ; { ok: false } sinon. */
function lien(app, code) {
  const cfg = S.configuration(app);
  const p = cfg.referral.enabled ? parrainDuCode(app, code) : null;
  if (!p) return { ok: false };
  return { ok: true, code: p.getString('parrain_code'), prenom: p.getString('name') ? R.nomPublic(p.getString('name')) : '', bienvenue: cfg.referral.welcome, min: cfg.referral.min };
}

/*
 * Cagnotte et cadeau de bienvenue d'une commande (devis, commande), pour le compte connecté (ou null) ; b : la saisie,
 * { parrain: code du lien ouvert }. Renvoie { cagnotte: solde utilisable, titulaire: téléphone du compte,
 * parrainage: { code, montant, min, recompense, parrain, parrainTel } ou null, raison: pourquoi le cadeau ne s'applique pas }.
 */
function pourCommande(app, compte, b, cfg) {
  const out = { cagnotte: 0, titulaire: compte ? telephoneDe(compte) : '', parrainage: null, raison: '' };
  if (compte && cfg.loyalty.enabled) out.cagnotte = solde(app, compte);
  const code = R.codeParrainValide(b && b.parrain);
  if (!code) return out;
  const p = cfg.referral.enabled ? parrainDuCode(app, code) : null;
  if (!p) out.raison = 'code';
  else if (!compte) out.raison = 'compte';
  else if (p.id === compte.id || telephoneDe(p) === out.titulaire) out.raison = 'soi-meme';
  else if (!premiereCommande(app, compte)) out.raison = 'deja-client';
  else out.parrainage = { code, montant: cfg.referral.welcome, min: cfg.referral.min, recompense: cfg.referral.reward, parrain: p.id, parrainTel: telephoneDe(p) };
  return out;
}

/* Un gain dans la cagnotte d'un téléphone ; false s'il y est déjà (même cle). Toujours dans une transaction. */
function crediter(app, m) {
  if (!m.telephone || !(R.num(m.montant) > 0)) return false;
  if (somme(app, 'SELECT COUNT(*) AS n FROM sokoyetu_cagnotte WHERE cle = {:k}', { k: m.cle })) return false;
  app.db().newQuery('INSERT INTO sokoyetu_cagnotte (telephone, montant, type, commande, details, cle, cree) VALUES ({:t}, {:m}, {:y}, {:c}, {:d}, {:k}, {:n})')
    .bind({ t: m.telephone, m: R.arrondi(m.montant), y: m.type, c: m.commande || '', d: JSON.stringify(m.details || {}), k: m.cle, n: Date.now() }).execute();
  return true;
}

/*
 * Commande enregistrée (serveur.enregistrerCommande, même transaction) : à la livraison, le gain promis rejoint la cagnotte
 * du client (annoncé avec la livraison, regles.evenementsCommande), et la récompense du parrain la sienne, qui en est prévenu.
 */
function apresCommande(app, rec, avant, apres) {
  if (!apres || apres.status === 'cancelled' || apres.fulfillment !== 'delivered' || (avant && avant.fulfillment === 'delivered')) return;
  const l = apres.loyalty;
  if (l && l.phone) crediter(app, { telephone: l.phone, montant: l.amount, type: 'achat', commande: rec.id, details: { numero: apres.number }, cle: 'achat:' + rec.id });
  const r = apres.referral;
  if (!r || !r.byPhone) return;
  const filleul = R.nomPublic(apres.customer && apres.customer.name);
  if (!crediter(app, { telephone: r.byPhone, montant: r.reward, type: 'parrainage', commande: rec.id, details: { numero: apres.number, filleul }, cle: 'parrainage:' + rec.id })) return;
  const N = require(`${__hooks}/lib/notifications.js`);
  let client = '';
  try { client = app.findRecordById('clients', r.by).id; } catch (e) { client = N.compteDuTelephone(app, r.byPhone); }
  N.creer(app, { client, appareil: '', type: 'parrainage', details: { filleul, montant: R.arrondi(r.reward) }, url: '/compte/cagnotte', cle: 'parrainage:' + rec.id });
}

/* La cagnotte du client connecté (page « Ma cagnotte ») : solde, gains à venir, historique, et son parrainage. */
function vue(app, compte) {
  const cfg = S.configuration(app);
  const tel = telephoneDe(compte);
  const out = { ouverte: cfg.loyalty.enabled, pct: cfg.loyalty.pct, part: R.PART_CAGNOTTE, solde: solde(app, compte), aVenir: 0, premiere: premiereCommande(app, compte), mouvements: [], parrainage: null };
  lignes(app, 'SELECT montant, type, details, cree FROM sokoyetu_cagnotte WHERE telephone = {:t} ORDER BY cree DESC, id DESC LIMIT {:n}', { t: tel, n: R.MOUVEMENTS_CAGNOTTE }, { montant: -0, type: '', details: '', cree: 0 })
    .forEach((x) => {
      let d = {}; try { d = JSON.parse(String(x.details || '{}')) || {}; } catch (e) { }
      out.mouvements.push({ type: String(x.type), montant: R.arrondi(x.montant), numero: d.numero || '', filleul: d.filleul || '', motif: d.motif || '', le: Number(x.cree) });
    });
  // Commandes du compte, et passées sans compte avec son téléphone : cagnotte utilisée, gains promis pas encore versés.
  app.findRecordsByFilter('orders', 'client = {:c} || (phone != "" && phone = {:p})', '-created', 300, 0, { c: compte.id, p: tel }).forEach((o) => {
    const d = S.lire(o);
    if (d.status === 'cancelled') return;
    if (o.getString('client') === compte.id && d.wallet && R.num(d.wallet.used) > 0) out.mouvements.push({ type: 'utilise', montant: -R.arrondi(d.wallet.used), numero: d.number || '', le: R.int(d.createdAt) });
    if (d.loyalty && d.loyalty.phone === tel && d.fulfillment !== 'delivered' && R.estPayee(d)) out.aVenir += R.num(d.loyalty.amount);
  });
  out.mouvements.sort((a, b) => b.le - a.le);
  out.mouvements = out.mouvements.slice(0, R.MOUVEMENTS_CAGNOTTE);
  out.aVenir = R.arrondi(out.aVenir);
  if (cfg.referral.enabled) {
    const f = lignes(app, "SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS s FROM sokoyetu_cagnotte WHERE telephone = {:t} AND type = 'parrainage'", { t: tel }, { n: 0, s: -0 })[0];
    // Premières commandes de ses filleuls, payées et pas encore livrées : la récompense arrive à la livraison.
    const enCours = lignes(app, `SELECT COALESCE(${champ('$.customer.name')}, '') AS nom, COALESCE(${champ('$.referral.reward')}, 0) AS recompense FROM orders
      WHERE status = 'open' AND pay_status = 'paid' AND etape != 'delivered' AND ${champ('$.referral.by')} = {:c} ORDER BY created DESC LIMIT 20`, { c: compte.id }, { nom: '', recompense: -0 })
      .map((x) => ({ filleul: R.nomPublic(x.nom), montant: R.arrondi(x.recompense) }));
    out.parrainage = { code: codeDe(app, compte), bienvenue: cfg.referral.welcome, recompense: cfg.referral.reward, min: cfg.referral.min, filleuls: Number(f.n) || 0, gagne: R.arrondi(f.s), enCours };
  }
  return out;
}

/* Administration (fiche d'un client, par téléphone) : solde, gains, cagnotte utilisée, filleuls, derniers mouvements. */
function pourClient(app, tel) {
  const t = R.chiffres(tel);
  let compte = null;
  try { compte = app.findFirstRecordByFilter('clients', 'phone = {:a} || phone = {:b}', { a: t, b: '+' + t }); } catch (e) { }
  const gagne = R.arrondi(gains(app, t)); const depense = compte ? R.arrondi(utilise(app, compte.id)) : 0;
  const mouvements = lignes(app, 'SELECT montant, type, details, cree FROM sokoyetu_cagnotte WHERE telephone = {:t} ORDER BY cree DESC, id DESC LIMIT 20', { t }, { montant: -0, type: '', details: '', cree: 0 })
    .map((x) => { let d = {}; try { d = JSON.parse(String(x.details || '{}')) || {}; } catch (e) { } return { type: String(x.type), montant: R.arrondi(x.montant), numero: d.numero || '', filleul: d.filleul || '', motif: d.motif || '', par: d.par || '', le: Number(x.cree) }; });
  const filleuls = somme(app, "SELECT COUNT(*) AS n FROM sokoyetu_cagnotte WHERE telephone = {:t} AND type = 'parrainage'", { t });
  return { solde: Math.max(0, R.arrondi(gagne - depense)), gagne, utilise: depense, filleuls, compte: !!compte, code: compte ? compte.getString('parrain_code') : '', mouvements };
}

/*
 * Geste de la boutique (propriétaire) : { montant, motif, jeton } ajoutés à la cagnotte du client (jeton : un double appui
 * n'ajoute qu'une fois). Le client en est prévenu (gratuit).
 */
function offrir(app, tel, b, par) {
  const t = R.chiffres(tel);
  const montant = R.arrondi(b && b.montant);
  if (t.length < 6) throw new BadRequestError('Numéro de téléphone manquant.');
  if (!(montant > 0) || montant > MAX_GESTE) throw new BadRequestError(`Montant de 0,01 à ${MAX_GESTE} $.`);
  const jeton = R.valider.jeton(b && b.jeton);
  if (!jeton) throw new BadRequestError('Rechargez la page et réessayez.');
  const motif = R.nettoyer(b && b.motif, 80);
  let fait = false;
  app.runInTransaction((tx) => {
    fait = crediter(tx, { telephone: t, montant, type: 'geste', details: { motif, par: R.nettoyer(par, 80) }, cle: 'geste:' + jeton });
    if (fait) {
      const N = require(`${__hooks}/lib/notifications.js`);
      N.creer(tx, { client: N.compteDuTelephone(tx, t) || N.compteDuTelephone(tx, '+' + t), appareil: '', type: 'cagnotte', details: { montant, motif }, url: '/compte/cagnotte', cle: 'geste:' + jeton });
    }
  });
  return Object.assign({ ajoute: fait }, pourClient(app, t));
}

/*
 * Compte supprimé, ou effacement demandé par le client : sa cagnotte disparaît, et son téléphone est retiré des gains promis
 * (commandes pas encore livrées, parrainages) : ils ne lui seront plus versés.
 */
function effacer(app, tel) {
  const t = R.chiffres(tel);
  if (!t) return;
  app.db().newQuery('DELETE FROM sokoyetu_cagnotte WHERE telephone = {:t}').bind({ t }).execute();
  lignes(app, `SELECT id FROM orders WHERE ${champ('$.loyalty.phone')} = {:t} OR ${champ('$.referral.byPhone')} = {:t}`, { t }, { id: '' }).forEach((x) => {
    let rec; try { rec = app.findRecordById('orders', String(x.id)); } catch (e) { return; }
    const d = S.lire(rec);
    if (d.loyalty && d.loyalty.phone === t) d.loyalty.phone = '';
    if (d.referral && d.referral.byPhone === t) { d.referral.byPhone = ''; d.referral.by = ''; }
    S.enregistrerCommande(app, rec, d);
  });
}

module.exports = { solde, premiereCommande, codeDe, lien, pourCommande, apresCommande, vue, pourClient, offrir, effacer };
