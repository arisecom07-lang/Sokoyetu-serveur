/*
 * Sokoyetu — règles métier communes.
 *
 * Un seul fichier, exécuté à l'identique par :
 *   - le serveur PocketBase (copié dans pb_hooks/lib/regles.js, chargé avec require) ;
 *   - la boutique et l'administration (intégré au paquet JavaScript) ;
 *   - la démo hors serveur.
 * Le serveur reste seul juge : prix, stock, remises, livraison et total sont toujours recalculés chez lui.
 *
 * Contraintes : CommonJS sans dépendance, pas de classes Unicode \p{…} (ignorées par le moteur du serveur).
 */
'use strict';

/* ---------- Constantes ---------- */

const OPERATEURS = {
  mpesa: { label: 'M-Pesa', sub: 'Vodacom', color: '#E11D2A', init: 'M' },
  airtel: { label: 'Airtel Money', sub: 'Airtel', color: '#D9001B', init: 'A' },
  orange: { label: 'Orange Money', sub: 'Orange', color: '#F07800', init: 'O' },
  illico: { label: 'Illico Cash', sub: 'Rawbank', color: '#B8860B', init: 'I' }
};

const ZONES_DEFAUT = [
  { id: 'bukavu', name: 'Bukavu', fee: 2, days: 1, pickup: false },
  { id: 'goma', name: 'Goma', fee: 5, days: 2, pickup: false },
  { id: 'retrait', name: 'Retrait en boutique', fee: 0, days: 0, pickup: true }
];

const CONFIG_DEFAUT = {
  name: 'Sokoyetu',
  tagline: 'Vos achats en Chine, livrés chez vous',
  ownerName: '',
  city: 'Bukavu',
  announcement: 'Livraison à Bukavu et Goma · Paiement Mobile Money',
  fxRate: 2800,
  showCDF: true,
  importDays: 20,
  freeShippingOver: 0,
  whatsapp: '',
  lowStock: 3,
  returns: 'Échange possible sous 7 jours sur les articles non portés, avec leur étiquette.',
  zones: ZONES_DEFAUT,
  payments: {
    mpesa: { enabled: true, number: '', accountName: '', ussd: '' },
    airtel: { enabled: true, number: '', accountName: '', ussd: '' },
    orange: { enabled: true, number: '', accountName: '', ussd: '' },
    illico: { enabled: false, number: '', accountName: '', ussd: '' }
  },
  legal: { company: '', address: '', email: '', rccm: '', idnat: '', nif: '', texts: {}, updatedAt: 0 },
  analytics: { provider: '', id: '' },
  setup: {}
};

const MAX_LIGNES = 50;
const MAX_QTE = 20;
const ALPHABET_NUMERO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* ---------- Outils ---------- */

function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : 0;
}
const int = (v) => Math.max(0, Math.round(num(v)));
const arrondi = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const chiffres = (s) => String(s == null ? '' : s).replace(/\D/g, '');
/* Texte saisi par un visiteur : sans caractères de contrôle (retours à la ligne gardés), espaces regroupés, longueur bornée. */
function nettoyer(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}
const estObjet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const copie = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
function fusion(base, sur) {
  if (!estObjet(base) || !estObjet(sur)) return sur === undefined ? copie(base) : copie(sur);
  const out = copie(base);
  for (const k of Object.keys(sur)) out[k] = estObjet(base[k]) && estObjet(sur[k]) ? fusion(base[k], sur[k]) : copie(sur[k]);
  return out;
}
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? (plusieurs || un + 's') : un}`;
/* « Robe midi fleurie » → « robe-midi-fleurie » (adresses lisibles des articles et rayons). */
function slug(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
function dollars(v) {
  const x = arrondi(v); const neg = x < 0;
  const parts = Math.abs(x).toFixed(2).split('.');
  return (neg ? '−' : '') + '$' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + parts[1];
}

/* ---------- Validation des saisies ---------- */

const valider = {
  /* RDC : 0 + 9 chiffres (08…, 09…), ou format international +… (Rwanda, Burundi, Ouganda…). Renvoie '' si invalide. */
  telephone(s) {
    const brut = String(s == null ? '' : s).trim(); let d = chiffres(brut);
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.indexOf('243') === 0 && d.length === 12) d = '0' + d.slice(3);
    if (/^0[89]\d{8}$/.test(d)) return d;
    if ((/^\+/.test(brut) || /^00/.test(chiffres(brut))) && d.length >= 10 && d.length <= 15) return '+' + d;
    return '';
  },
  nom(s) {
    const v = nettoyer(s, 80).replace(/\s+/g, ' ');
    return v.length >= 2 && v.length <= 60 && /^[A-Za-zÀ-ÖØ-öø-ÿŒœŸ'’ .-]+$/.test(v) && /[A-Za-zÀ-ÖØ-öø-ÿŒœŸ]/.test(v) ? v : '';
  },
  /* Code de transaction Mobile Money, tel qu'il figure dans le SMS. */
  reference(s) {
    const v = String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
    return /^[A-Z0-9][A-Z0-9.\-_/]{3,29}$/.test(v) ? v : '';
  },
  codePromo(s) {
    const v = String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
    return /^[A-Z0-9-]{3,20}$/.test(v) ? v : '';
  },
  /* '' si vide, null si invalide. */
  email(s) {
    const v = String(s == null ? '' : s).trim();
    if (!v) return '';
    return v.length <= 120 && /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
  },
  jeton(s) { return /^[A-Za-z0-9]{24,64}$/.test(String(s || '')) ? String(s) : ''; },
  identifiant(s) { return /^[a-z0-9-]{2,40}$/.test(String(s || '')) ? String(s) : ''; }
};

/* ---------- Configuration ---------- */

function zoneNettoyee(z, i) {
  const fee = Math.max(0, arrondi(z && z.fee)); const days = int(z && z.days);
  const pickup = z && typeof z.pickup === 'boolean' ? z.pickup : (!fee && !days);
  return { id: String((z && z.id) || 'zone-' + (i + 1)).slice(0, 40), name: nettoyer(z && z.name, 40) || 'Zone ' + (i + 1), fee, days, pickup };
}
function config(brut) {
  const c = fusion(CONFIG_DEFAUT, estObjet(brut) ? brut : {});
  const zones = Array.isArray(c.zones) ? c.zones.filter((z) => z && String(z.name || '').trim()) : [];
  c.zones = (zones.length ? zones : ZONES_DEFAUT).map(zoneNettoyee);
  c.importDays = int(c.importDays) || 20;
  c.lowStock = int(c.lowStock);
  c.freeShippingOver = Math.max(0, arrondi(c.freeShippingOver));
  return c;
}
const zoneDe = (cfg, id) => (cfg.zones || []).find((z) => z.id === id) || null;
const estRetrait = (z) => !!z && (typeof z.pickup === 'boolean' ? z.pickup : (!num(z.fee) && !num(z.days)));
function moyensDePaiement(cfg) {
  return Object.keys(OPERATEURS).filter((k) => cfg.payments && cfg.payments[k] && cfg.payments[k].enabled && chiffres(cfg.payments[k].number))
    .map((k) => Object.assign({ k }, OPERATEURS[k], { number: cfg.payments[k].number, accountName: cfg.payments[k].accountName || '', ussd: cfg.payments[k].ussd || '' }));
}

/* ---------- Produits ---------- */

const cleVariante = (couleur, taille) => `${couleur || ''}|${taille || ''}`;
const couleursDe = (p) => ((p && p.options && p.options.colors) || []).filter((c) => c && c.name);
const taillesDe = (p) => ((p && p.options && p.options.sizes) || []).filter(Boolean);
const aDesOptions = (p) => couleursDe(p).length > 0 || taillesDe(p).length > 0;
const estImport = (p) => !!p && p.source === 'import';
const estEnVente = (p) => !!p && p.status !== 'draft';
function clesVariantes(p) {
  const cs = couleursDe(p).map((c) => c.name), ts = taillesDe(p);
  if (cs.length && ts.length) { const out = []; cs.forEach((c) => ts.forEach((t) => out.push(cleVariante(c, t)))); return out; }
  if (cs.length) return cs.map((c) => cleVariante(c, ''));
  if (ts.length) return ts.map((t) => cleVariante('', t));
  return [];
}
function stockDe(p, couleur, taille) {
  if (!aDesOptions(p)) return int(p.stock);
  return int((p.variants || {})[cleVariante(couleursDe(p).length ? couleur : '', taillesDe(p).length ? taille : '')]);
}
function stockTotal(p) {
  if (!aDesOptions(p)) return int(p.stock);
  return clesVariantes(p).reduce((a, k) => a + int((p.variants || {})[k]), 0);
}
const prixBarre = (p) => (num(p.compareAt) > num(p.price) ? arrondi(p.compareAt) : 0);
const pourcentRemise = (p) => (prixBarre(p) ? Math.round((1 - num(p.price) / num(p.compareAt)) * 100) : 0);
const imagePrincipale = (p) => ((p && p.images) || []).find((m) => m && m.type !== 'data') || null;

/* Applique une réservation (sens -1 : stock retiré, vendus ajoutés) ou sa restitution (sens +1) à un produit. */
function ajusterStock(p, entrees, sens) {
  const out = copie(p); let qte = 0;
  for (const e of entrees) {
    qte += int(e.qty);
    if (e.import) continue;
    if (e.key) { out.variants = out.variants || {}; out.variants[e.key] = Math.max(0, int(out.variants[e.key]) + sens * int(e.qty)); }
    else out.stock = Math.max(0, int(out.stock) + sens * int(e.qty));
  }
  out.sold = Math.max(0, int(out.sold) - sens * qte);
  return out;
}

/* ---------- Remises ---------- */

function montantRemise(remise, sousTotal) {
  if (!remise) return 0;
  const v = num(remise.value); const st = arrondi(sousTotal);
  return arrondi(remise.type === 'percent' ? st * Math.min(v, 90) / 100 : Math.min(v, st));
}
/* remise : le document du code promo (ou null s'il n'existe pas). */
function verifierRemise(remise, code, sousTotal, maintenant) {
  const c = valider.codePromo(code);
  const non = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  if (!c || !remise) return non('Ce code n’est pas valide.');
  if (remise.active === false || (remise.endsAt && num(remise.endsAt) < (maintenant || Date.now()))) return non('Ce code n’est plus valable.');
  const v = num(remise.value); if (!(v > 0)) return non('Ce code n’est pas valide.');
  const min = num(remise.minSubtotal);
  if (min && arrondi(sousTotal) < min) return non(`Ce code s’applique dès ${dollars(min)} d’achat.`, { minSubtotal: min });
  const type = remise.type === 'percent' ? 'percent' : 'fixed';
  return { ok: true, code: c, type, value: v, minSubtotal: min, amount: montantRemise({ type, value: v }, sousTotal) };
}

/* ---------- Devis : prix, stock, remise et livraison recalculés depuis le catalogue ---------- */

/*
 * opts = { cfg, produit: (id) => doc|null, lignes: [{ productId, color, size, qty, title? }], zoneId,
 *          code: 'BIENVENUE10', remise: doc|null, maintenant }
 * Renvoie { lignes, problemes, sousTotal, remise, livraison, total, zone }.
 * Chaque problème = { code, message, ligne? } ; aucun problème = la commande peut être payée telle quelle.
 */
function devis(opts) {
  const cfg = opts.cfg; const problemes = [];
  const fusionnees = [];
  for (const l of (Array.isArray(opts.lignes) ? opts.lignes : []).slice(0, MAX_LIGNES)) {
    if (!l) continue;
    const id = String(l.productId || '').slice(0, 40);
    const color = nettoyer(l.color, 40), size = nettoyer(l.size, 20);
    const deja = fusionnees.find((x) => x.productId === id && x.color === color && x.size === size);
    const q = Math.floor(num(l.qty));
    if (deja) deja.qty += q; else fusionnees.push({ productId: id, color, size, qty: q, title: nettoyer(l.title, 120) });
  }
  const lignes = fusionnees.map((l, i) => {
    const qty = Math.max(1, Math.min(MAX_QTE, l.qty || 1));
    const p = l.productId ? opts.produit(l.productId) : null;
    if (!p) {
      problemes.push({ code: 'article', ligne: i, message: `« ${l.title || 'Un article'} » n’est plus en vente.` });
      return { productId: l.productId, title: l.title || 'Article retiré', color: l.color, size: l.size, qty, price: 0, cost: 0, source: 'local', image: null, issue: 'retiré' };
    }
    const cs = couleursDe(p).map((c) => c.name), ts = taillesDe(p);
    const ligne = {
      productId: l.productId, title: String(p.title || 'Article').slice(0, 120),
      color: cs.length ? l.color : '', size: ts.length ? l.size : '', qty,
      price: arrondi(p.price), cost: arrondi(p.cost), source: estImport(p) ? 'import' : 'local', image: imagePrincipale(p)
    };
    if (!estEnVente(p)) { ligne.issue = 'retiré'; problemes.push({ code: 'article', ligne: i, message: `« ${ligne.title} » n’est plus en vente.` }); }
    else if (cs.length && cs.indexOf(ligne.color) < 0) { ligne.issue = 'option'; problemes.push({ code: 'option', ligne: i, message: `Choisissez une couleur disponible pour « ${ligne.title} ».` }); }
    else if (ts.length && ts.indexOf(ligne.size) < 0) { ligne.issue = 'option'; problemes.push({ code: 'option', ligne: i, message: `Choisissez une taille disponible pour « ${ligne.title} ».` }); }
    else if (!(ligne.price > 0)) { ligne.issue = 'prix'; problemes.push({ code: 'prix', ligne: i, message: `Le prix de « ${ligne.title} » n’est pas disponible.` }); }
    else if (!estImport(p)) {
      const st = stockDe(p, ligne.color, ligne.size); ligne.available = st;
      if (st < qty) {
        ligne.issue = 'stock';
        problemes.push({ code: 'stock', ligne: i, message: st > 0 ? `Plus que ${pluriel(st, 'exemplaire')} de « ${ligne.title} »${ligne.color || ligne.size ? ` (${[ligne.color, ligne.size].filter(Boolean).join(' / ')})` : ''}.` : `« ${ligne.title} »${ligne.color || ligne.size ? ` (${[ligne.color, ligne.size].filter(Boolean).join(' / ')})` : ''} est épuisé.` });
      }
    }
    return ligne;
  });
  const sousTotal = arrondi(lignes.reduce((a, l) => a + l.price * l.qty, 0));

  let remise = null;
  if (opts.code) {
    const r = verifierRemise(opts.remise || null, opts.code, sousTotal, opts.maintenant);
    if (r.ok) remise = { code: r.code, type: r.type, value: r.value, amount: r.amount };
    else problemes.push({ code: 'remise', message: r.reason });
  }
  const zone = zoneDe(cfg, opts.zoneId);
  if (!zone) problemes.push({ code: 'zone', message: 'Choisissez une zone de livraison.' });
  let livraison = zone ? arrondi(zone.fee) : 0;
  const net = sousTotal - (remise ? remise.amount : 0);
  if (num(cfg.freeShippingOver) > 0 && net >= num(cfg.freeShippingOver)) livraison = 0;
  const total = arrondi(Math.max(0, net + livraison));
  return { lignes, problemes, sousTotal, remise, livraison, total, zone };
}

/* ---------- Commande ---------- */

class ErreurCommande extends Error {
  constructor(message, champ) { super(message); this.champ = champ || ''; }
}

/* Ce qui sera retiré du stock à la commande : seulement les lignes sans problème. */
function reservations(lignes, produit) {
  return lignes.filter((l) => !l.issue).map((l) => {
    const p = produit(l.productId);
    return { productId: l.productId, key: p && aDesOptions(p) ? cleVariante(l.color, l.size) : '', qty: int(l.qty), import: l.source === 'import' };
  });
}

/*
 * Construit la commande d'un client à partir de sa saisie (corps de la requête).
 * Les erreurs de saisie (nom, téléphone, adresse, paiement…) bloquent : ErreurCommande.
 * Un changement de catalogue survenu après le paiement (stock, prix, code promo) ne bloque pas :
 * la commande est enregistrée avec ses « points à vérifier », pour que l'argent envoyé ne soit jamais perdu.
 */
function preparerCommande(opts) {
  const cfg = opts.cfg; const d = estObjet(opts.saisie) ? opts.saisie : {};
  const now = opts.maintenant || Date.now();
  const stop = (m, champ) => { throw new ErreurCommande(m, champ); };
  if (!d.termsAccepted) stop('Acceptez les conditions de vente pour confirmer.', 'terms');
  const client = estObjet(d.customer) ? d.customer : {}; const liv = estObjet(d.shipping) ? d.shipping : {}; const pay = estObjet(d.payment) ? d.payment : {};
  const name = valider.nom(client.name); if (!name) stop('Indiquez votre nom (2 à 60 lettres).', 'name');
  const phone = valider.telephone(client.phone); if (!phone) stop('Numéro de téléphone invalide. Exemple : 099 123 4567.', 'phone');
  const zone = zoneDe(cfg, liv.zoneId); if (!zone) stop('Choisissez une zone de livraison.', 'zone');
  const retrait = estRetrait(zone);
  const address = nettoyer(liv.address, 120); if (!retrait && address.length < 4) stop('Indiquez votre adresse de livraison.', 'address');
  if (!Array.isArray(d.items) || !d.items.length) stop('Votre panier est vide.');
  if (d.items.length > MAX_LIGNES) stop('Trop d’articles dans une seule commande.');
  for (const it of d.items) { const q = Number(it && it.qty); if (!(q >= 1 && q <= MAX_QTE && Math.floor(q) === q)) stop('Quantité invalide dans le panier.'); }
  const moyen = moyensDePaiement(cfg).find((m) => m.k === pay.method);
  if (!moyen) stop('Ce mode de paiement n’est pas disponible. Choisissez-en un autre.', 'method');
  const ref = valider.reference(pay.ref); if (!ref) stop('Code de transaction invalide : 4 à 30 lettres ou chiffres, tel qu’il figure dans le SMS.', 'ref');
  let sender = phone;
  if (String(pay.sender || '').trim()) { sender = valider.telephone(pay.sender); if (!sender) stop('Numéro d’envoi invalide.', 'sender'); }

  const dv = devis({ cfg, produit: opts.produit, lignes: d.items, zoneId: zone.id, code: d.discountCode, remise: opts.remise, maintenant: now });
  const problemes = dv.problemes.filter((p) => p.code !== 'zone').map((p) => p.message);
  const annonce = d.total === undefined || d.total === null || d.total === '' ? null : arrondi(d.total);
  if (annonce === null || Math.abs(annonce - dv.total) > 0.009) problemes.push(`Le client a vu un total de ${annonce === null ? '?' : dollars(annonce)} ; le total recalculé est de ${dollars(dv.total)}. Vérifiez le montant reçu.`);
  const reserve = reservations(dv.lignes, opts.produit);

  const doc = {
    number: opts.numero, createdAt: now, termsAcceptedAt: now, phone: chiffres(phone),
    customer: { name, phone },
    shipping: { zoneId: zone.id, zoneName: zone.name, pickup: retrait, address: retrait ? '' : address, landmark: retrait ? '' : nettoyer(liv.landmark, 80) },
    note: nettoyer(d.note, 300),
    items: dv.lignes.map((l) => { const o = Object.assign({}, l); delete o.available; return o; }),
    subtotal: dv.sousTotal, discount: dv.remise ? { code: dv.remise.code, amount: dv.remise.amount } : null,
    shippingFee: dv.livraison, total: dv.total, declaredTotal: annonce,
    payment: { method: moyen.k, label: moyen.label, ref, sender, status: 'pending' },
    fulfillment: 'unfulfilled', status: 'open', issues: problemes,
    stockApplied: true, reserved: reserve,
    timeline: [{ at: now, text: 'Commande passée par le client' }].concat(problemes.length ? [{ at: now, text: 'Points à vérifier signalés automatiquement' }] : [])
  };
  return { commande: doc, reserve };
}

function numeroCommande(aleatoire) {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET_NUMERO[Math.floor((aleatoire ? aleatoire() : Math.random()) * ALPHABET_NUMERO.length) % ALPHABET_NUMERO.length];
  return s;
}

/* ---------- Statuts ---------- */

const estAnnulee = (o) => o.status === 'cancelled';
const estPayee = (o) => !!o.payment && o.payment.status === 'paid';
const estRetraitCmd = (o) => !!(o.shipping && o.shipping.pickup);
const aVerifier = (o) => o.status === 'open' && !!o.payment && o.payment.status === 'pending';
const aPreparer = (o) => o.status === 'open' && estPayee(o) && (o.fulfillment === 'unfulfilled' || o.fulfillment === 'preparing' || !o.fulfillment);
const aExpedier = (o) => o.status === 'open' && estPayee(o) && o.fulfillment === 'shipped';
const aTraiter = (o) => aVerifier(o) || aPreparer(o);

function statutClient(o) {
  const r = estRetraitCmd(o);
  if (estAnnulee(o)) return { label: o.payment && o.payment.status === 'refunded' ? 'Annulée · remboursée' : 'Annulée', ton: 'danger', etape: -1 };
  if (o.fulfillment === 'delivered') return { label: r ? 'Retirée' : 'Livrée', ton: 'ok', etape: 4 };
  if (o.fulfillment === 'shipped') return { label: r ? 'Prête au retrait' : 'En route', ton: 'info', etape: 3 };
  if (o.fulfillment === 'preparing') return { label: 'En préparation', ton: 'info', etape: 2 };
  if (estPayee(o)) return { label: 'Paiement confirmé', ton: 'ok', etape: 1 };
  return { label: 'Paiement en vérification', ton: 'warn', etape: 0 };
}
function etapesSuivi(o) {
  const r = estRetraitCmd(o);
  return [
    { titre: 'Commande reçue', icone: 'recu' },
    { titre: 'Paiement confirmé', icone: 'portefeuille' },
    { titre: 'En préparation', icone: 'colis' },
    { titre: r ? 'Prête au retrait' : 'En route', icone: r ? 'boutique' : 'camion' },
    { titre: r ? 'Retirée' : 'Livrée', icone: 'coche' }
  ];
}

/* ---------- Étapes de commande (administration, exécutées par le serveur) ---------- */

const ACTIONS = {
  paid: 'Paiement confirmé', preparing: 'Préparation commencée', shipped: 'Commande expédiée', delivered: 'Commande livrée',
  cancel: 'Commande annulée', reopen: 'Commande rouverte', refund: 'Remboursement effectué', note: 'Note enregistrée'
};

/* Réservations d'une ancienne commande, enregistrée avant que le stock ne soit réservé à la commande. */
function reservationsAnciennes(o, produit) {
  return (o.items || []).filter((i) => i && i.productId).map((i) => {
    const p = produit(i.productId);
    return { productId: i.productId, key: p && aDesOptions(p) ? cleVariante(i.color, i.size) : '', qty: int(i.qty), import: i.source === 'import' || estImport(p) };
  });
}

/*
 * Renvoie { commande, stock: 'reserver' | 'restituer' | '', entrees } ; lève ErreurCommande si l'étape n'est pas possible.
 * opts = { maintenant, note, produit }
 */
function etapeCommande(o, action, opts) {
  opts = opts || {};
  const now = opts.maintenant || Date.now();
  const stop = (m) => { throw new ErreurCommande(m); };
  if (!ACTIONS[action]) stop('Action inconnue.');
  const c = copie(o); c.timeline = Array.isArray(c.timeline) ? c.timeline : []; c.payment = c.payment || {};
  let stock = ''; let entrees = [];
  const reserver = () => {
    if (c.stockApplied) return;
    entrees = Array.isArray(c.reserved) && c.reserved.length ? c.reserved : reservationsAnciennes(c, opts.produit || (() => null));
    c.reserved = entrees; c.stockApplied = true; stock = 'reserver';
  };
  const retrait = estRetraitCmd(c);
  const ouverte = c.status !== 'cancelled';
  if (action === 'paid') {
    if (!ouverte) stop('Cette commande est annulée.');
    if (c.payment.status === 'paid') stop('Le paiement est déjà confirmé.');
    c.payment.status = 'paid'; c.payment.paidAt = now; reserver();
  } else if (action === 'preparing') {
    if (!ouverte || c.payment.status !== 'paid') stop('Confirmez d’abord le paiement.');
    if (c.fulfillment && c.fulfillment !== 'unfulfilled') stop('La préparation a déjà commencé.');
    c.fulfillment = 'preparing'; c.preparingAt = now; reserver();
  } else if (action === 'shipped') {
    if (!ouverte || c.payment.status !== 'paid') stop('Confirmez d’abord le paiement.');
    if (c.fulfillment === 'shipped' || c.fulfillment === 'delivered') stop('La commande est déjà partie.');
    c.fulfillment = 'shipped'; c.shippedAt = now; reserver();
  } else if (action === 'delivered') {
    if (!ouverte || c.payment.status !== 'paid') stop('Confirmez d’abord le paiement.');
    if (c.fulfillment === 'delivered') stop('La commande est déjà livrée.');
    c.fulfillment = 'delivered'; c.deliveredAt = now; reserver();
  } else if (action === 'cancel') {
    if (!ouverte) stop('La commande est déjà annulée.');
    if (c.fulfillment === 'delivered') stop('Une commande livrée ne peut plus être annulée.');
    c.status = 'cancelled'; c.cancelledAt = now;
    if (c.stockApplied) { entrees = Array.isArray(c.reserved) ? c.reserved : reservationsAnciennes(c, opts.produit || (() => null)); stock = 'restituer'; }
    c.stockApplied = false;
  } else if (action === 'reopen') {
    if (ouverte) stop('La commande est déjà ouverte.');
    c.status = 'open'; delete c.cancelledAt; reserver();
  } else if (action === 'refund') {
    if (ouverte || c.payment.status !== 'paid') stop('Seule une commande annulée et payée peut être remboursée.');
    c.payment.status = 'refunded'; c.payment.refundedAt = now;
  } else if (action === 'note') {
    c.adminNote = nettoyer(opts.note, 1000);
    return { commande: c, stock: '', entrees: [] };
  }
  let texte = ACTIONS[action];
  if (action === 'shipped' && retrait) texte = 'Commande prête au retrait';
  if (action === 'delivered' && retrait) texte = 'Commande retirée par le client';
  c.timeline.push({ at: now, text: texte });
  return { commande: c, stock, entrees };
}

/* Contrôle des montants d'une commande (utile pour les commandes anciennes ou saisies à la main). */
function incoherences(o) {
  const out = (Array.isArray(o.issues) ? o.issues : []).slice();
  const items = o.items || [];
  const st = arrondi(items.reduce((a, i) => a + num(i.price) * int(i.qty), 0));
  if (Math.abs(st - num(o.subtotal)) > 0.01) out.push(`Le sous-total (${dollars(o.subtotal)}) ne correspond pas aux articles (${dollars(st)}).`);
  const calc = arrondi(st - num(o.discount && o.discount.amount) + num(o.shippingFee));
  if (Math.abs(calc - num(o.total)) > 0.01) out.push(`Le total (${dollars(o.total)}) ne correspond pas au calcul (${dollars(calc)}).`);
  return out.filter((v, i, a) => a.indexOf(v) === i);
}

function margeCommande(o) {
  const couts = (o.items || []).reduce((a, i) => a + num(i.cost) * int(i.qty), 0);
  return { couts: arrondi(couts), marge: arrondi(num(o.subtotal) - num(o.discount && o.discount.amount) - couts), connue: (o.items || []).every((i) => num(i.cost) > 0) };
}

module.exports = {
  OPERATEURS, ZONES_DEFAUT, CONFIG_DEFAUT, MAX_LIGNES, MAX_QTE, ACTIONS,
  num, int, arrondi, chiffres, nettoyer, estObjet, copie, fusion, pluriel, slug, dollars, valider,
  config, zoneDe, estRetrait, moyensDePaiement,
  cleVariante, couleursDe, taillesDe, aDesOptions, estImport, estEnVente, clesVariantes, stockDe, stockTotal, prixBarre, pourcentRemise, imagePrincipale, ajusterStock,
  montantRemise, verifierRemise, devis,
  ErreurCommande, reservations, preparerCommande, numeroCommande,
  estAnnulee, estPayee, estRetraitCmd, aVerifier, aPreparer, aExpedier, aTraiter, statutClient, etapesSuivi,
  etapeCommande, reservationsAnciennes, incoherences, margeCommande
};
