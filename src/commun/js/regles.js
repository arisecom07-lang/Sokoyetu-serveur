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

/* exemple : format de numéro montré dans le champ du paiement (préfixes courants de l'opérateur). */
const OPERATEURS = {
  mpesa: { label: 'M-Pesa', sub: 'Vodacom', color: '#E11D2A', init: 'M', exemple: '081 234 5678' },
  airtel: { label: 'Airtel Money', sub: 'Airtel', color: '#D9001B', init: 'A', exemple: '099 123 4567' },
  orange: { label: 'Orange Money', sub: 'Orange', color: '#F07800', init: 'O', exemple: '084 123 4567' },
  afrimoney: { label: 'Afrimoney', sub: 'Africell', color: '#6B2C91', init: 'A', exemple: '090 123 4567' },
  illico: { label: 'Illico Cash', sub: 'Rawbank', color: '#B8860B', init: 'I', exemple: '099 123 4567' }
};

/*
 * Fournisseurs de paiement automatique. Le serveur choisit le sien (fichier sokoyetu.env, script paiement.sh) ;
 * sans fournisseur, la boutique n'encaisse pas. « simulation » sert aux essais : aucun argent ne circule.
 */
const FOURNISSEURS = {
  simulation: { label: 'Mode test (simulation)', operateurs: ['mpesa', 'airtel', 'orange', 'afrimoney', 'illico'] },
  flexpay: { label: 'FlexPay', operateurs: ['mpesa', 'airtel', 'orange', 'afrimoney'] }
};

const ZONES_DEFAUT = [
  { id: 'bukavu', name: 'Bukavu', fee: 2, days: 1, pickup: false },
  { id: 'goma', name: 'Goma', fee: 5, days: 2, pickup: false },
  { id: 'retrait', name: 'Retrait en boutique', fee: 0, days: 0, pickup: true }
];

const CONFIG_DEFAUT = {
  name: 'Sokoyetu',
  tagline: 'Commandez et recevez chez vous',
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
    mpesa: { enabled: true }, airtel: { enabled: true }, orange: { enabled: true }, afrimoney: { enabled: false }, illico: { enabled: false }
  },
  /* Paiement automatique : le client paie dans l'application, la commande n'est validée qu'après confirmation du fournisseur. */
  payment: { provider: '', holdMinutes: 30 },
  /* Frais de service de la boutique, ajoutés au montant du panier (articles, après réduction). */
  serviceFeePct: 2,
  /* Relance des paniers : le client avec compte qui laisse son panier reçoit une notification gratuite, hours heures après. */
  cartReminder: { enabled: true, hours: 24 },
  /* Avis des clients : achats livrés seulement ; moderation : chaque avis attend la vérification de la boutique ;
     reminder : notification gratuite quelques jours après la livraison pour demander l'avis du client. */
  reviews: { enabled: true, moderation: false, reminder: true },
  legal: { company: '', address: '', email: '', rccm: '', idnat: '', nif: '', texts: {}, updatedAt: 0 },
  analytics: { provider: '', id: '' },
  setup: {}
};

const MAX_LIGNES = 50;
const MAX_QTE = 20;
const ALPHABET_NUMERO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_TENTATIVES = 5;
/* Secondes à attendre avant une nouvelle demande de paiement quand la précédente est encore en attente sur le téléphone
   (deux demandes valides en même temps = risque d'être débité deux fois). */
const RELANCE_APRES_S = 45;
const JOUR = 864e5;

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
  /* Numéro Mobile Money à débiter : numéro congolais 08… ou 09… (10 chiffres). */
  mobileMoney(s) {
    const t = valider.telephone(s);
    return /^0[89]\d{8}$/.test(t) ? t : '';
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
  /* perKg : supplément par kilo du colis (poids renseigné sur les fiches), 0 = frais fixes. */
  const perKg = Math.max(0, arrondi(z && z.perKg));
  return { id: String((z && z.id) || 'zone-' + (i + 1)).slice(0, 40), name: nettoyer(z && z.name, 40) || 'Zone ' + (i + 1), fee, days, pickup, perKg };
}
function config(brut) {
  const c = fusion(CONFIG_DEFAUT, estObjet(brut) ? brut : {});
  const zones = Array.isArray(c.zones) ? c.zones.filter((z) => z && String(z.name || '').trim()) : [];
  c.zones = (zones.length ? zones : ZONES_DEFAUT).map(zoneNettoyee);
  c.importDays = int(c.importDays) || 20;
  c.lowStock = int(c.lowStock);
  c.freeShippingOver = Math.max(0, arrondi(c.freeShippingOver));
  c.serviceFeePct = Math.min(20, Math.max(0, arrondi(c.serviceFeePct)));
  c.payment = estObjet(c.payment) ? c.payment : {};
  c.payment.provider = FOURNISSEURS[c.payment.provider] ? c.payment.provider : '';
  c.payment.holdMinutes = Math.min(120, Math.max(5, int(c.payment.holdMinutes) || 30));
  const r = estObjet(c.cartReminder) ? c.cartReminder : {};
  c.cartReminder = { enabled: r.enabled !== false, hours: Math.min(72, Math.max(2, int(r.hours) || 24)) };
  const av = estObjet(c.reviews) ? c.reviews : {};
  c.reviews = { enabled: av.enabled !== false, moderation: av.moderation === true, reminder: av.reminder !== false };
  return c;
}
const zoneDe = (cfg, id) => (cfg.zones || []).find((z) => z.id === id) || null;
const estRetrait = (z) => !!z && (typeof z.pickup === 'boolean' ? z.pickup : (!num(z.fee) && !num(z.days)));
/* Opérateurs proposés au client : activés dans les réglages et pris en charge par le fournisseur choisi. */
function moyensDePaiement(cfg) {
  const f = FOURNISSEURS[cfg.payment && cfg.payment.provider];
  if (!f) return [];
  return Object.keys(OPERATEURS).filter((k) => f.operateurs.indexOf(k) >= 0 && cfg.payments && cfg.payments[k] && cfg.payments[k].enabled)
    .map((k) => Object.assign({ k }, OPERATEURS[k]));
}
const fraisService = (cfg, montantPanier) => arrondi(Math.max(0, num(montantPanier)) * num(cfg.serviceFeePct) / 100);

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
const imagePrincipale = (p) => ((p && p.images) || []).find((m) => m && m.type !== 'data') || null;

/* ---------- Prix : variantes, vente flash, prix de gros ---------- */

const MAX_PALIERS = 4;
/* Prix d'une variante : son prix propre s'il est renseigné (ex. XL plus cher), sinon le prix de l'article. */
function prixVariante(p, couleur, taille) {
  const propre = num(((p && p.variantPrices) || {})[cleVariante(couleursDe(p).length ? couleur : '', taillesDe(p).length ? taille : '')]);
  return arrondi(propre > 0 ? propre : num(p && p.price));
}
/* Prix des variantes renseignées (pour « dès $… » sur les cartes). */
function prixPossibles(p) {
  const l = clesVariantes(p).map((k) => num(((p && p.variantPrices) || {})[k])).filter((v) => v > 0);
  return clesVariantes(p).length > l.length || !l.length ? l.concat([arrondi(p && p.price)]) : l;
}
/* Vente flash en cours : { pct, fin } ou null. flash = { pct, startsAt?, endsAt } sur la fiche. */
function venteFlash(p, maintenant) {
  const f = p && p.flash; const now = maintenant || Date.now();
  if (!estObjet(f)) return null;
  const pct = Math.min(90, int(f.pct)); const fin = num(f.endsAt);
  if (!pct || !fin || fin <= now || num(f.startsAt) > now) return null;
  return { pct, fin };
}
/* Paliers de prix de gros, triés : [{ min: 3, pct: 5 }, { min: 6, pct: 10 }] (min : pièces de cet article dans la commande). */
function paliersGros(p) {
  const vus = {};
  return (Array.isArray(p && p.wholesale) ? p.wholesale : []).map((x) => ({ min: Math.min(MAX_QTE, int(x && x.min)), pct: Math.min(50, int(x && x.pct)) }))
    .filter((x) => x.min >= 2 && x.pct > 0 && !vus[x.min] && (vus[x.min] = true)).sort((a, b) => a.min - b.min).slice(0, MAX_PALIERS);
}
function remiseGros(p, qte) {
  let pct = 0;
  paliersGros(p).forEach((x) => { if (int(qte) >= x.min) pct = Math.max(pct, x.pct); });
  return pct;
}
/* Prix unitaire payé : prix de la variante, moins la vente flash, moins le prix de gros (qte : pièces de cet article dans la commande). */
function prixUnitaire(p, couleur, taille, qte, maintenant) {
  let v = prixVariante(p, couleur, taille);
  const f = venteFlash(p, maintenant); if (f) v = v * (100 - f.pct) / 100;
  const g = remiseGros(p, qte); if (g) v = v * (100 - g) / 100;
  return arrondi(v);
}
/*
 * Prix montré au client pour une pièce : { prix, barre, pct, flash, des }.
 * Sans couleur ni taille choisies, prend le prix le plus bas des variantes (des : « dès $… »).
 * barre : ancien prix (prix barré de la fiche, ou prix avant la vente flash).
 */
function prixAffiche(p, couleur, taille, maintenant) {
  if (!p) return { prix: 0, barre: 0, pct: 0, flash: null, des: false };
  const choisi = (!couleursDe(p).length || couleur) && (!taillesDe(p).length || taille);
  const possibles = prixPossibles(p);
  const base = choisi ? prixVariante(p, couleur, taille) : Math.min.apply(null, possibles);
  const des = !choisi && possibles.some((v) => Math.abs(v - base) > 0.009);
  const f = venteFlash(p, maintenant);
  const prix = arrondi(f ? base * (100 - f.pct) / 100 : base);
  const ancien = Math.max(num(p.compareAt) > num(p.price) && Math.abs(base - num(p.price)) < 0.009 ? num(p.compareAt) : 0, f ? base : 0);
  const barre = ancien > prix ? arrondi(ancien) : 0;
  return { prix, barre, pct: barre ? Math.round((1 - prix / barre) * 100) : 0, flash: f, des };
}
const prixBarre = (p, maintenant) => prixAffiche(p, '', '', maintenant).barre;
const pourcentRemise = (p, maintenant) => prixAffiche(p, '', '', maintenant).pct;
/* Poids d'expédition d'une pièce, en kilos (0 si non renseigné). */
const poidsDe = (p) => Math.min(1000, Math.max(0, num(p && p.weight)));

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
 * Renvoie { lignes, problemes, sousTotal, remise, livraison, frais, fraisPct, total, zone }.
 * frais : frais de service de la boutique (cfg.serviceFeePct % du panier, après réduction).
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
  const maintenant = opts.maintenant || Date.now();
  // Prix de gros : toutes les pièces d'un même article comptent, quelles que soient la couleur et la taille.
  const parArticle = {};
  fusionnees.forEach((l) => { parArticle[l.productId] = (parArticle[l.productId] || 0) + Math.max(1, Math.min(MAX_QTE, l.qty || 1)); });
  let poids = 0;
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
      price: 0, cost: arrondi(p.cost), source: estImport(p) ? 'import' : 'local', image: imagePrincipale(p)
    };
    ligne.price = prixUnitaire(p, ligne.color, ligne.size, parArticle[l.productId], maintenant);
    const base = prixVariante(p, ligne.color, ligne.size);
    if (ligne.price < base) {
      const f = venteFlash(p, maintenant); const g = remiseGros(p, parArticle[l.productId]);
      ligne.basePrice = base;
      if (f) ligne.flash = f.pct;
      if (g) ligne.wholesale = g;
    }
    if (poidsDe(p)) { ligne.weight = poidsDe(p); poids += poidsDe(p) * qty; }
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
  poids = Math.round(poids * 1000) / 1000;
  let livraison = zone ? arrondi(num(zone.fee) + (estRetrait(zone) ? 0 : num(zone.perKg) * poids)) : 0;
  const net = Math.max(0, sousTotal - (remise ? remise.amount : 0));
  if (num(cfg.freeShippingOver) > 0 && net >= num(cfg.freeShippingOver)) livraison = 0;
  const frais = fraisService(cfg, net);
  const total = arrondi(net + livraison + frais);
  return { lignes, problemes, sousTotal, remise, livraison, frais, fraisPct: num(cfg.serviceFeePct), total, zone, poids };
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

/* Livraison estimée : délai de la zone, plus le délai d'import si un article vient de Chine. Au moins un jour, sauf retrait. */
function livraisonEstimee(cfg, lignes, zone, maintenant) {
  const importe = (lignes || []).some((l) => l && l.source === 'import');
  let jours = int(zone && zone.days) + (importe ? int(cfg.importDays) : 0);
  if (!jours && !estRetrait(zone)) jours = 1;
  return { days: jours, at: (maintenant || Date.now()) + jours * JOUR, import: importe };
}

/*
 * Prépare la commande d'un client à partir de sa saisie (corps de la requête), avant la demande de paiement.
 * Tout ce qui empêcherait de livrer exactement ce qui est payé bloque ici (ErreurCommande) : saisie invalide,
 * stock, prix ou code promo changés, total différent de celui affiché. Le client ne paie jamais un autre montant.
 * La commande naît « en attente de paiement », stock réservé ; elle n'est validée qu'à la confirmation du fournisseur.
 */
function preparerCommande(opts) {
  const cfg = opts.cfg; const d = estObjet(opts.saisie) ? opts.saisie : {};
  const now = opts.maintenant || Date.now();
  const stop = (m, champ) => { throw new ErreurCommande(m, champ); };
  if (!d.termsAccepted) stop('Acceptez les conditions de vente pour payer.', 'terms');
  const client = estObjet(d.customer) ? d.customer : {}; const liv = estObjet(d.shipping) ? d.shipping : {}; const pay = estObjet(d.payment) ? d.payment : {};
  const name = valider.nom(client.name); if (!name) stop('Indiquez votre nom (2 à 60 lettres).', 'name');
  const phone = valider.telephone(client.phone); if (!phone) stop('Numéro de téléphone invalide. Exemple : 099 123 4567.', 'phone');
  const zone = zoneDe(cfg, liv.zoneId); if (!zone) stop('Choisissez une zone de livraison.', 'zone');
  const retrait = estRetrait(zone);
  const address = nettoyer(liv.address, 120); if (!retrait && address.length < 4) stop('Indiquez votre adresse de livraison.', 'address');
  if (!Array.isArray(d.items) || !d.items.length) stop('Votre panier est vide.', 'panier');
  if (d.items.length > MAX_LIGNES) stop('Trop d’articles dans une seule commande.', 'panier');
  for (const it of d.items) { const q = Number(it && it.qty); if (!(q >= 1 && q <= MAX_QTE && Math.floor(q) === q)) stop('Quantité invalide dans le panier.', 'panier'); }
  if (!cfg.payment || !FOURNISSEURS[cfg.payment.provider]) stop('Le paiement en ligne n’est pas encore ouvert. Revenez bientôt.', 'method');
  const moyen = moyensDePaiement(cfg).find((m) => m.k === pay.method);
  if (!moyen) stop('Ce mode de paiement n’est pas disponible. Choisissez-en un autre.', 'method');
  const payeur = valider.mobileMoney(pay.phone || client.phone);
  if (!payeur) stop(`Numéro ${moyen.label} invalide : 10 chiffres, commençant par 08 ou 09.`, 'payphone');

  const dv = devis({ cfg, produit: opts.produit, lignes: d.items, zoneId: zone.id, code: d.discountCode, remise: opts.remise, maintenant: now });
  const bloquants = dv.problemes.filter((p) => p.code !== 'zone');
  if (bloquants.length) stop(bloquants.map((p) => p.message).join(' '), bloquants.some((p) => p.code === 'remise') && bloquants.length === 1 ? 'remise' : 'panier');
  const annonce = d.total === undefined || d.total === null || d.total === '' ? null : arrondi(d.total);
  if (annonce === null || Math.abs(annonce - dv.total) > 0.009) stop(`Le montant à payer est maintenant de ${dollars(dv.total)}. Vérifiez-le avant de payer.`, 'total');
  const reserve = reservations(dv.lignes, opts.produit);
  const fournisseur = cfg.payment.provider;

  const doc = {
    number: opts.numero, createdAt: now, termsAcceptedAt: now, phone: chiffres(phone),
    customer: { name, phone },
    shipping: { zoneId: zone.id, zoneName: zone.name, pickup: retrait, address: retrait ? '' : address, landmark: retrait ? '' : nettoyer(liv.landmark, 80) },
    note: nettoyer(d.note, 300),
    items: dv.lignes.map((l) => { const o = Object.assign({}, l); delete o.available; return o; }),
    subtotal: dv.sousTotal, discount: dv.remise ? { code: dv.remise.code, amount: dv.remise.amount } : null,
    shippingFee: dv.livraison, weight: dv.poids, serviceFee: dv.frais, serviceFeePct: dv.fraisPct, total: dv.total,
    payment: { method: moyen.k, label: moyen.label, phone: payeur, provider: fournisseur, test: fournisseur === 'simulation', status: 'pending', attempts: 0, startedAt: now, providerId: '', reference: '', error: '' },
    expiresAt: now + cfg.payment.holdMinutes * 60000,
    delivery: livraisonEstimee(cfg, dv.lignes, zone, now),
    fulfillment: 'unfulfilled', status: 'open', issues: [],
    stockApplied: true, reserved: reserve,
    timeline: [{ at: now, text: 'Commande enregistrée, en attente du paiement' }]
  };
  return { commande: doc, reserve };
}

/* Numéro de commande : 6 caractères faciles à lire et à dicter (le serveur vérifie qu'il n'existe pas déjà). */
function numeroCommande(aleatoire) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET_NUMERO[Math.floor((aleatoire ? aleatoire() : Math.random()) * ALPHABET_NUMERO.length) % ALPHABET_NUMERO.length];
  return s;
}
const numeroValide = (s) => /^[A-Z0-9]{5,8}$/.test(String(s || '').trim().replace(/^#/, '').toUpperCase());
const numeroNettoye = (s) => String(s || '').trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase();

/* ---------- Statuts ---------- */

const estAnnulee = (o) => o.status === 'cancelled';
const estPayee = (o) => !!o.payment && o.payment.status === 'paid';
const estRetraitCmd = (o) => !!(o.shipping && o.shipping.pickup);
/* Paiement demandé au client, pas encore confirmé (ou refusé, avec une nouvelle tentative possible). */
const enAttentePaiement = (o) => o.status === 'open' && !!o.payment && (o.payment.status === 'pending' || o.payment.status === 'failed');
/* Commande annulée d'elle-même : le paiement n'est jamais arrivé. */
const nonAboutie = (o) => o.status === 'cancelled' && !!o.payment && o.payment.status === 'expired';
const aVerifier = enAttentePaiement;
const aPreparer = (o) => o.status === 'open' && estPayee(o) && (o.fulfillment === 'unfulfilled' || o.fulfillment === 'preparing' || !o.fulfillment);
const aExpedier = (o) => o.status === 'open' && estPayee(o) && o.fulfillment === 'shipped';
// À traiter par le vendeur : commande payée à préparer, ou client qui a payé deux fois et attend son remboursement.
const aTraiter = (o) => aPreparer(o) || doublonARembourser(o);

function statutClient(o) {
  const r = estRetraitCmd(o);
  if (nonAboutie(o)) return { label: 'Annulée : paiement non reçu', ton: 'danger', etape: -1 };
  if (estAnnulee(o)) return { label: o.payment && o.payment.status === 'refunded' ? 'Annulée · remboursée' : 'Annulée', ton: 'danger', etape: -1 };
  if (o.fulfillment === 'delivered') return { label: r ? 'Retirée' : 'Livrée', ton: 'ok', etape: 4 };
  if (o.fulfillment === 'shipped') return { label: r ? 'Prête au retrait' : 'En route', ton: 'info', etape: 3 };
  if (o.fulfillment === 'preparing') return { label: 'En préparation', ton: 'info', etape: 2 };
  if (estPayee(o)) return { label: 'Payée', ton: 'ok', etape: 1 };
  if (o.payment && o.payment.status === 'failed') return { label: 'Paiement non abouti', ton: 'danger', etape: 0 };
  return { label: 'Paiement en cours', ton: 'warn', etape: 0 };
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

/* ---------- Paiement automatique (exécuté par le serveur, à partir des réponses du fournisseur) ---------- */

/* '' si une nouvelle demande de paiement est possible, sinon la raison. */
function relancePossible(o, maintenant) {
  const now = maintenant || Date.now();
  if (o.status !== 'open') return 'Cette commande est annulée.';
  if (estPayee(o)) return 'Cette commande est déjà payée.';
  if (num(o.expiresAt) && now > num(o.expiresAt)) return 'Le délai de paiement est dépassé. Repassez votre commande.';
  if (int(o.payment && o.payment.attempts) >= MAX_TENTATIVES) return 'Trop de tentatives de paiement pour cette commande. Repassez votre commande.';
  return '';
}
/* Une demande de paiement vient d'être envoyée au fournisseur. opts = { maintenant, providerId, methode, label, telephone } */
function paiementEnvoye(o, opts) {
  const c = copie(o); const now = opts.maintenant || Date.now(); c.payment = c.payment || {}; c.timeline = Array.isArray(c.timeline) ? c.timeline : [];
  const relance = int(c.payment.attempts) > 0;
  if (opts.methode) { c.payment.method = opts.methode; c.payment.label = opts.label || c.payment.label; }
  if (opts.telephone) c.payment.phone = opts.telephone;
  if (c.payment.providerId) c.payment.previous = (Array.isArray(c.payment.previous) ? c.payment.previous : []).concat([c.payment.providerId]).slice(-MAX_TENTATIVES);
  c.payment.status = 'pending'; c.payment.providerId = String(opts.providerId || ''); c.payment.attempts = int(c.payment.attempts) + 1;
  c.payment.startedAt = now; c.payment.error = ''; c.payment.checkedAt = 0;
  c.timeline.push({ at: now, text: `${relance ? 'Nouvelle demande' : 'Demande'} de paiement ${c.payment.label} envoyée au ${c.payment.phone}` });
  return c;
}
/* Double paiement signalé et pas encore remboursé (deux demandes de la même commande validées par le client). */
const doublonARembourser = (o) => !!o && !!o.payment && Array.isArray(o.payment.duplicates) && o.payment.duplicates.length > 0 && !o.payment.duplicatesRefundedAt;
const TEXTE_DOUBLON = 'Paiement reçu deux fois';

/*
 * Le fournisseur confirme le paiement (opts.id : la demande payée). Renvoie { commande, stock, entrees, double } :
 * un paiement arrivé après l'annulation automatique rouvre la commande ; une deuxième demande payée pour une commande
 * déjà payée est notée « à rembourser » (double = true), jamais ignorée.
 */
function paiementConfirme(o, opts) {
  const c = copie(o); const now = opts.maintenant || Date.now(); c.payment = c.payment || {}; c.timeline = Array.isArray(c.timeline) ? c.timeline : [];
  const id = String(opts.id || c.payment.providerId || '');
  if (estPayee(c)) {
    const payee = c.payment.paidId || c.payment.providerId || '';
    const doubles = Array.isArray(c.payment.duplicates) ? c.payment.duplicates : [];
    if (!id || id === payee || doubles.some((x) => x && x.id === id)) return { commande: c, stock: '', entrees: [], double: false };
    const ref = String(opts.reference || id).slice(0, 80);
    c.payment.duplicates = doubles.concat([{ id, reference: ref, at: now }]).slice(-MAX_TENTATIVES);
    delete c.payment.duplicatesRefundedAt;
    c.issues = (Array.isArray(c.issues) ? c.issues : []).concat([`${TEXTE_DOUBLON} (référence ${ref}) : remboursez ${dollars(c.total)} au client sur son numéro ${c.payment.label || 'Mobile Money'}, puis notez-le.`]);
    c.timeline.push({ at: now, text: `Deuxième paiement ${c.payment.label || ''} reçu (référence ${ref}) : à rembourser au client` });
    return { commande: c, stock: '', entrees: [], double: true };
  }
  c.payment.paidId = id;
  let stock = ''; let entrees = [];
  if (c.status === 'cancelled') {
    c.status = 'open'; delete c.cancelledAt; delete c.cancelReason;
    if (!c.stockApplied) { entrees = Array.isArray(c.reserved) ? c.reserved : []; c.stockApplied = true; stock = 'reserver'; }
    c.issues = (c.issues || []).concat(['Paiement confirmé après l’annulation automatique : vérifiez que les articles sont toujours disponibles.']);
  }
  c.payment.status = 'paid'; c.payment.paidAt = now; c.payment.error = '';
  if (opts.reference) c.payment.reference = String(opts.reference).slice(0, 80);
  // Le délai de livraison court à partir du paiement.
  if (c.delivery && c.delivery.days !== undefined) c.delivery = Object.assign({}, c.delivery, { at: now + int(c.delivery.days) * JOUR });
  c.timeline.push({ at: now, text: `Paiement ${c.payment.label} confirmé${c.payment.test ? ' (mode test)' : ''}` });
  return { commande: c, stock, entrees };
}
/* Le fournisseur refuse le paiement (solde insuffisant, code annulé…) : le client peut réessayer tant que la commande n'a pas expiré. */
function paiementEchoue(o, opts) {
  const c = copie(o); const now = opts.maintenant || Date.now(); c.payment = c.payment || {}; c.timeline = Array.isArray(c.timeline) ? c.timeline : [];
  if (estPayee(c) || c.status !== 'open') return c;
  c.payment.status = 'failed'; c.payment.error = nettoyer(opts.raison, 160) || 'Paiement refusé ou annulé.'; c.payment.failedAt = now;
  c.timeline.push({ at: now, text: `Paiement non abouti : ${c.payment.error}` });
  return c;
}
/* Délai dépassé sans paiement : la commande est annulée et ses articles remis en vente. */
function paiementExpire(o, opts) {
  const c = copie(o); const now = (opts && opts.maintenant) || Date.now(); c.payment = c.payment || {}; c.timeline = Array.isArray(c.timeline) ? c.timeline : [];
  if (estPayee(c) || c.status !== 'open') return { commande: c, stock: '', entrees: [] };
  const entrees = c.stockApplied && Array.isArray(c.reserved) ? c.reserved : [];
  c.status = 'cancelled'; c.cancelledAt = now; c.cancelReason = 'paiement'; c.payment.status = 'expired'; c.stockApplied = false;
  c.timeline.push({ at: now, text: 'Paiement non reçu dans le délai : commande annulée, articles remis en vente' });
  return { commande: c, stock: entrees.length ? 'restituer' : '', entrees };
}

/* ---------- Étapes de commande (administration, exécutées par le serveur) ---------- */

const ACTIONS = {
  paid: 'Paiement confirmé manuellement par la boutique', preparing: 'Préparation commencée', shipped: 'Commande expédiée', delivered: 'Commande livrée',
  cancel: 'Commande annulée', reopen: 'Commande rouverte', refund: 'Remboursement effectué', doublon: 'Double paiement remboursé au client', note: 'Note enregistrée'
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
    c.payment.status = 'paid'; c.payment.paidAt = now; c.payment.manual = true; reserver();
  } else if (action === 'preparing') {
    if (!ouverte || c.payment.status !== 'paid') stop('Le paiement n’est pas encore confirmé.');
    if (c.fulfillment && c.fulfillment !== 'unfulfilled') stop('La préparation a déjà commencé.');
    c.fulfillment = 'preparing'; c.preparingAt = now; reserver();
  } else if (action === 'shipped') {
    if (!ouverte || c.payment.status !== 'paid') stop('Le paiement n’est pas encore confirmé.');
    if (c.fulfillment === 'shipped' || c.fulfillment === 'delivered') stop('La commande est déjà partie.');
    c.fulfillment = 'shipped'; c.shippedAt = now; reserver();
  } else if (action === 'delivered') {
    if (!ouverte || c.payment.status !== 'paid') stop('Le paiement n’est pas encore confirmé.');
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
    if (c.payment.status === 'expired') stop('Le paiement de cette commande n’est jamais arrivé : le client doit repasser commande.');
    c.status = 'open'; delete c.cancelledAt; reserver();
  } else if (action === 'refund') {
    if (ouverte || c.payment.status !== 'paid') stop('Seule une commande annulée et payée peut être remboursée.');
    c.payment.status = 'refunded'; c.payment.refundedAt = now;
  } else if (action === 'doublon') {
    if (!doublonARembourser(c)) stop('Aucun double paiement à rembourser pour cette commande.');
    c.payment.duplicatesRefundedAt = now;
    c.issues = (Array.isArray(c.issues) ? c.issues : []).filter((t) => String(t).indexOf(TEXTE_DOUBLON) !== 0);
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
  const calc = arrondi(st - num(o.discount && o.discount.amount) + num(o.shippingFee) + num(o.serviceFee));
  if (Math.abs(calc - num(o.total)) > 0.01) out.push(`Le total (${dollars(o.total)}) ne correspond pas au calcul (${dollars(calc)}).`);
  return out.filter((v, i, a) => a.indexOf(v) === i);
}

function margeCommande(o) {
  const couts = (o.items || []).reduce((a, i) => a + num(i.cost) * int(i.qty), 0);
  /* Les frais de service reviennent à la boutique : ils s'ajoutent à la marge. */
  return { couts: arrondi(couts), marge: arrondi(num(o.subtotal) - num(o.discount && o.discount.amount) + num(o.serviceFee) - couts), connue: (o.items || []).every((i) => num(i.cost) > 0) };
}

/* ---------- Comptes clients (facultatifs) : connexion par code (WhatsApp ou SMS), panier et favoris sur tous les appareils ---------- */

const MAX_FAVORIS = 200;
const CODE_CHIFFRES = 6;
const codeConnexion = (s) => { const v = chiffres(s); return v.length === CODE_CHIFFRES ? v : ''; };
/* Numéro international pour l'envoi du code : 0991234567 → +243991234567. */
function telephoneInternational(s) {
  const t = valider.telephone(s);
  if (!t) return '';
  return t[0] === '+' ? t : '+243' + t.slice(1);
}
const idProduit = (x) => valider.identifiant(x);
function panierCompte(l) {
  const vus = {}; const out = [];
  for (const x of Array.isArray(l) ? l : []) {
    if (!estObjet(x) || !idProduit(x.productId)) continue;
    const ligne = { productId: x.productId, color: nettoyer(x.color, 40), size: nettoyer(x.size, 40), qty: Math.min(MAX_QTE, Math.max(1, int(x.qty))) };
    const cle = `${ligne.productId}|${ligne.color}|${ligne.size}`;
    if (vus[cle] || !int(x.qty)) continue;
    vus[cle] = true; out.push(ligne);
    if (out.length >= MAX_LIGNES) break;
  }
  return out;
}
const favorisCompte = (l) => (Array.isArray(l) ? l : []).map(String).filter((x, i, a) => idProduit(x) && a.indexOf(x) === i).slice(0, MAX_FAVORIS);
/* Coordonnées de livraison et de paiement retenues pour les prochaines commandes. */
function profilCompte(p) {
  const x = estObjet(p) ? p : {};
  return { zoneId: nettoyer(x.zoneId, 40), address: nettoyer(x.address, 120), landmark: nettoyer(x.landmark, 80), payMethod: nettoyer(x.payMethod, 20), payPhone: valider.mobileMoney(x.payPhone) };
}
/* Le compte : panier, favoris, coordonnées, et depuis quand chaque article est au panier ou en favori (« panier:<id> »). */
function docCompte(d) {
  const x = estObjet(d) ? d : {};
  const c = { panier: panierCompte(x.panier), favoris: favorisCompte(x.favoris), profil: profilCompte(x.profil), dates: {} };
  const dates = estObjet(x.dates) ? x.dates : {};
  c.panier.forEach((l) => { if (int(dates['panier:' + l.productId])) c.dates['panier:' + l.productId] = int(dates['panier:' + l.productId]); });
  c.favoris.forEach((id) => { if (int(dates['favori:' + id])) c.dates['favori:' + id] = int(dates['favori:' + id]); });
  return c;
}
/* Articles nouvellement au panier ou en favori : datés de maintenant ; les autres gardent leur date. */
function daterCompte(d, maintenant) {
  const c = docCompte(d); const now = maintenant || Date.now();
  c.panier.forEach((l) => { c.dates['panier:' + l.productId] = c.dates['panier:' + l.productId] || now; });
  c.favoris.forEach((id) => { c.dates['favori:' + id] = c.dates['favori:' + id] || now; });
  return c;
}
/*
 * Première connexion sur un appareil : ce qui y a été mis de côté avant de se connecter rejoint le compte.
 * Panier : une ligne par article, couleur et taille (la plus grande quantité des deux) ; favoris : réunis.
 */
function fusionCompte(compte, appareil) {
  const c = docCompte(compte); const a = estObjet(appareil) ? appareil : {};
  const dates = c.dates;
  const panier = panierCompte(c.panier.concat(panierCompte(a.panier)).reduce((acc, l) => {
    const k = acc.find((y) => y.productId === l.productId && y.color === l.color && y.size === l.size);
    if (k) k.qty = Math.max(k.qty, l.qty); else acc.push(Object.assign({}, l));
    return acc;
  }, []));
  const profil = profilCompte(a.profil);
  Object.keys(c.profil).forEach((k) => { if (c.profil[k]) profil[k] = c.profil[k]; });
  return docCompte({ panier, favoris: c.favoris.concat(favorisCompte(a.favoris)), profil, dates });
}

/* ---------- Panier partagé : le lien contient les articles, rien d'autre (ni nom, ni téléphone) ---------- */

/*
 * « a=montre-curren:2:Noir&a=sac-cuir&a=robe:1::M » : une ligne par « a » (article:quantité:couleur:taille), champs vides
 * de fin omis. Couleur et taille sont encodées (un « : » y devient %3A) : le lien reste court, lisible et sans ambiguïté.
 * Les prix n'y figurent pas : celui qui ouvre le lien voit toujours les prix et le stock du jour.
 */
const MAX_LIGNES_PARTAGE = 30;
function lienPanier(lignes) {
  return panierCompte(lignes).slice(0, MAX_LIGNES_PARTAGE).map((l) => {
    const champs = [l.productId, l.qty > 1 || l.color || l.size ? String(l.qty) : '', l.color, l.size].map((v) => encodeURIComponent(v || ''));
    while (champs.length > 1 && !champs[champs.length - 1]) champs.pop();
    return 'a=' + champs.join(':');
  }).join('&');
}
/* Lignes d'un lien de panier partagé (« ?a=… », tel quel, sans décodage préalable) ; les lignes invalides sont ignorées. */
function panierDepuisLien(recherche) {
  const lignes = [];
  String(recherche || '').replace(/^\?/, '').split('&').forEach((morceau) => {
    if (morceau.indexOf('a=') !== 0 || lignes.length >= MAX_LIGNES_PARTAGE * 2) return;
    let brut = morceau.slice(2);
    // Lien réencodé par une application en chemin (« : » devenu %3A) : on retrouve les séparateurs.
    if (brut.indexOf(':') < 0 && /%3A/i.test(brut)) brut = brut.replace(/%3A/gi, ':');
    const c = brut.split(':').map((v) => { try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return ''; } });
    lignes.push({ productId: c[0], qty: c[1] ? int(c[1]) : 1, color: c[2] || '', size: c[3] || '' });
  });
  return panierCompte(lignes).slice(0, MAX_LIGNES_PARTAGE);
}

/*
 * Ce que montre un panier partagé, aux prix et au stock du jour : le même calcul pour le message envoyé, l'aperçu du lien
 * (serveur) et la page qui s'ouvre. Chaque ligne garde la quantité demandée (demandee) et prend la quantité disponible (qty) ;
 * probleme : 'retiré' (plus en vente), 'option' (couleur ou taille plus proposée), 'prix', 'epuise', ou ''.
 * total : articles disponibles et frais de service, livraison non comprise (choisie à la commande).
 */
function apercuPartage(opts) {
  const cfg = opts.cfg; const maintenant = opts.maintenant || Date.now();
  const zoneId = ((cfg.zones || [])[0] || {}).id;
  const recues = panierCompte(opts.lignes).slice(0, MAX_LIGNES_PARTAGE); // les lignes que porte le lien
  const dv = devis({ cfg, produit: opts.produit, lignes: recues, zoneId, maintenant });
  const lignes = recues.map((l, i) => {
    const d = dv.lignes[i] || {}; const p = opts.produit(l.productId);
    const stock = !p ? 0 : estImport(p) ? MAX_QTE : stockDe(p, d.color, d.size);
    const probleme = !p || d.issue === 'retiré' ? 'retiré' : d.issue === 'option' || d.issue === 'prix' ? d.issue : stock <= 0 ? 'epuise' : '';
    return { productId: l.productId, title: d.title || '', color: d.color || '', size: d.size || '', demandee: l.qty, qty: probleme ? l.qty : Math.min(l.qty, stock), probleme };
  });
  const disponibles = lignes.filter((l) => !l.probleme);
  const sousTotal = devis({ cfg, produit: opts.produit, lignes: disponibles, zoneId, maintenant }).sousTotal;
  const frais = fraisService(cfg, sousTotal);
  return { lignes, disponibles, n: disponibles.reduce((a, l) => a + l.qty, 0), sousTotal, frais, total: arrondi(sousTotal + frais) };
}

/* ---------- Équipe : rôles des comptes de l'administration (le serveur contrôle, l'administration masque le reste) ---------- */

const ROLES = {
  proprietaire: { label: 'Propriétaire', texte: 'Tout : réglages, équipe, réductions, remboursements et chiffres.' },
  vendeur: { label: 'Vendeur', texte: 'Commandes, produits, clients, messages et avis. Ni réglages, ni équipe, ni réductions, ni remboursements.' },
  livreur: { label: 'Livreur', texte: 'Seulement les commandes à livrer : adresse, téléphone, « En route » et « Livrée ».' }
};
/* Rôle d'un compte : les comptes créés avant les rôles (rôle vide) sont ceux du propriétaire. */
const roleNettoye = (r) => (ROLES[r] ? r : 'proprietaire');
const DROITS = {
  proprietaire: ['*'],
  vendeur: ['tableau', 'commandes', 'produits', 'catalogue', 'clients', 'messages', 'avis', 'audience'],
  livreur: ['livraisons']
};
function peut(role, droit) {
  const l = DROITS[roleNettoye(role)];
  return l.indexOf('*') >= 0 || l.indexOf(droit) >= 0;
}
/* Étapes de commande permises : le livreur ne fait que « En route » et « Livrée » ; les remboursements restent au propriétaire. */
function etapePermise(role, action) {
  const r = roleNettoye(role);
  if (r === 'proprietaire') return true;
  if (r === 'livreur') return action === 'shipped' || action === 'delivered';
  return action !== 'refund' && action !== 'doublon';
}
/* Commandes montrées au livreur : payées, ouvertes, à livrer (pas les retraits en boutique). */
const pourLivreur = (o) => !!o && o.status === 'open' && estPayee(o) && !estRetraitCmd(o);

/* ---------- Notifications du client : centre de notifications de la boutique et notifications du téléphone (gratuites) ---------- */

/*
 * Ce que le client apprend quand sa commande change : [{ type, details }]. avant : document enregistré (vide pour une
 * nouvelle commande). Une commande n'est annoncée qu'une fois payée ; celle dont le paiement n'est jamais arrivé l'est
 * à son annulation (« expiree »).
 */
function evenementsCommande(avant, apres) {
  const a = avant || {}, b = apres || {};
  if (!b.number) return [];
  const details = { numero: b.number, zone: (b.shipping && b.shipping.zoneName) || '', moyen: (b.payment && b.payment.label) || '' };
  const ev = (type) => ({ type, details });
  const l = [];
  const ouverte = b.status !== 'cancelled';
  if (ouverte && estPayee(b) && !estPayee(a) && (!a.payment || a.payment.status !== 'refunded')) l.push(ev('payee'));
  if (ouverte && estPayee(b) && a.fulfillment !== b.fulfillment) {
    if (b.fulfillment === 'preparing') l.push(ev('preparation'));
    if (b.fulfillment === 'shipped') l.push(ev(estRetraitCmd(b) ? 'prete' : 'expediee'));
    if (b.fulfillment === 'delivered') l.push(ev(estRetraitCmd(b) ? 'retiree' : 'livree'));
  }
  if (a.status && a.status !== 'cancelled' && b.status === 'cancelled') l.push(ev(nonAboutie(b) ? 'expiree' : 'annulee'));
  if (a.payment && a.payment.status !== 'refunded' && b.payment && b.payment.status === 'refunded') l.push(ev('remboursee'));
  return l;
}

/* Textes des notifications : [titre, texte], {clé} remplacée par le détail de la notification. */
const TEXTES_NOTIFICATIONS = {
  fr: {
    payee: ['Paiement reçu', 'Commande #{numero} confirmée. Nous préparons vos articles.'],
    preparation: ['Commande en préparation', 'Commande #{numero} : vos articles sont en cours de préparation.'],
    expediee: ['Commande en route', 'Commande #{numero} : le livreur est en route ({zone}).'],
    prete: ['Commande prête', 'Commande #{numero} : vos articles vous attendent en boutique.'],
    livree: ['Commande livrée', 'Commande #{numero} remise. Merci pour votre confiance !'],
    retiree: ['Commande retirée', 'Commande #{numero} remise en boutique. Merci pour votre confiance !'],
    annulee: ['Commande annulée', 'Commande #{numero} annulée par la boutique.'],
    expiree: ['Paiement non reçu', 'Commande #{numero} annulée : le paiement n’est pas arrivé à temps.'],
    remboursee: ['Remboursement effectué', 'Commande #{numero} remboursée ({moyen}).'],
    stock: ['De retour en stock', '« {titre} » ({option}) est de nouveau disponible. Les quantités sont limitées : ne tardez pas !'],
    promo: ['{titre}', '{texte}'],
    message: ['Réponse de la boutique', '{texte}'],
    avis: ['Votre avis compte', (d) => (int(d.autres)
      ? `« ${d.titre} » et ${int(d.autres) === 1 ? 'un autre article' : int(d.autres) + ' autres articles'} vous plaisent ? Donnez votre avis en un geste : il aide les autres clients.`
      : `« ${d.titre} » vous plaît ? Donnez votre avis en un geste : il aide les autres clients.`)],
    avis_reponse: ['La boutique vous a répondu', 'Votre avis sur « {titre} » : {texte}'],
    panier: ['Votre panier vous attend', (d) => (int(d.autres)
      ? `« ${d.titre} » et ${int(d.autres) === 1 ? 'un autre article' : int(d.autres) + ' autres articles'} vous attendent dans votre panier, toujours disponibles. Commandez quand vous voulez.`
      : `« ${d.titre} » vous attend dans votre panier, toujours disponible. Commandez quand vous voulez.`)]
  }
};
/* Une notification ({ type, details }) en { titre, texte } dans la langue demandée (le français à défaut) ; null si type inconnu. */
function texteNotification(n, langue) {
  const t = ((TEXTES_NOTIFICATIONS[langue] || {})[n && n.type]) || (TEXTES_NOTIFICATIONS.fr[n && n.type]);
  if (!t) return null;
  const d = (n && n.details) || {};
  const remplir = (x) => (typeof x === 'function' ? x(d) : x.replace(/\{(\w+)\}/g, (_, k) => (d[k] === undefined || d[k] === null ? '' : String(d[k]))).replace(/ \(\)/g, ''));
  return { titre: remplir(t[0]), texte: remplir(t[1]) };
}

/* ---------- Relance des paniers laissés (clients avec compte) ---------- */

const RELANCE_PANIER_JOURS = 7;      // une relance par semaine au plus ; un panier laissé depuis plus longtemps n'est plus relancé
/*
 * Le moment est-il venu de rappeler son panier à ce client ? { titre, autres, depuis } (premier article encore disponible,
 * nombre d'autres, date du dernier ajout au panier), sinon null.
 * doc : compte (docCompte) ; relance : date de la dernière relance ; commandeDepuis(t) : le client a commandé depuis t ;
 * produit(id) : fiche du catalogue. Seuls les articles encore en vente et disponibles comptent.
 */
function relancePanier({ doc, cfg, relance, commandeDepuis, produit, maintenant }) {
  const c = cfg && cfg.cartReminder;
  if (!c || !c.enabled) return null;
  const d = docCompte(doc); const now = maintenant || Date.now();
  if (!d.panier.length) return null;
  const depuis = Math.max.apply(null, d.panier.map((l) => int(d.dates['panier:' + l.productId])));
  if (!depuis || now - depuis < int(c.hours) * 3600e3 || now - depuis > RELANCE_PANIER_JOURS * JOUR) return null;
  if (int(relance) >= depuis || now - int(relance) < RELANCE_PANIER_JOURS * JOUR) return null;
  if (commandeDepuis && commandeDepuis(depuis)) return null;
  const dispo = d.panier.map((l) => ({ l, p: produit(l.productId) }))
    .filter((x) => x.p && estEnVente(x.p) && (estImport(x.p) || stockDe(x.p, x.l.color, x.l.size) > 0));
  if (!dispo.length) return null;
  return { titre: dispo[0].p.title || 'Article', autres: dispo.length - 1, depuis };
}

/* ---------- « Prévenez-moi » au retour en stock, et annonces de la boutique ---------- */

const MAX_ALERTES = 50;              // articles suivis au plus par client
const ANNONCES_PAR_JOUR = 3;         // au-delà, les clients finissent par couper les notifications
/* « Rouge|M » → « Rouge / M » (option d'un article, '' pour l'article entier). */
const libelleVariante = (cle) => String(cle || '').split('|').filter(Boolean).join(' / ');
/* Option suivie : '' (l'article entier, quelle que soit l'option) ou une de ses variantes ; null si elle n'existe pas. */
function varianteAlerte(p, cle) {
  const k = String(cle == null ? '' : cle);
  if (!k || k === '|') return '';
  return aDesOptions(p) && clesVariantes(p).indexOf(k) >= 0 ? k : null;
}
/* L'article (ou cette option) peut de nouveau être commandé : en vente, et en stock ou vendu sur commande. */
function alerteDisponible(p, variante) {
  if (!p || !estEnVente(p)) return false;
  if (estImport(p)) return true;
  return (variante && aDesOptions(p) ? int((p.variants || {})[variante]) : stockTotal(p)) > 0;
}
/* Lien d'une annonce : une page de la boutique (accueil, nouveautés, en stock, import, rayon, article), jamais une adresse extérieure. */
const LIEN_ANNONCE = /^\/(?:nouveautes|en-stock|import-chine|categories|(?:p|c)\/[A-Za-z0-9_-]{1,40}(?:\/[a-z0-9-]{0,60})?)?$/;
/* Annonce saisie par la boutique : { titre, texte, url }, ou ErreurCommande. */
function annonceNettoyee(b) {
  const x = estObjet(b) ? b : {};
  const titre = nettoyer(x.titre, 60).replace(/\s+/g, ' ');
  const texte = nettoyer(x.texte, 180).replace(/\s+/g, ' ');
  const url = String(x.url == null ? '/' : x.url).trim() || '/';
  if (titre.length < 3) throw new ErreurCommande('Donnez un titre à l’annonce (3 caractères au moins).', 'titre');
  if (texte.length < 5) throw new ErreurCommande('Écrivez le message de l’annonce.', 'texte');
  if (!LIEN_ANNONCE.test(url)) throw new ErreurCommande('Lien invalide : choisissez une page de la boutique.', 'url');
  return { titre, texte, url };
}

/* ---------- Discussion avec la boutique (service client dans l'application, gratuit) ---------- */

const MAX_MESSAGE = 1000;            // caractères par message
const MESSAGES_PAR_JOUR = 60;        // messages d'un client en 24 heures (au-delà : abus)
/* Message saisi : { texte, produit, commande } (article ou commande dont il parle, facultatifs), ou ErreurCommande. */
function messageNettoye(b) {
  const x = estObjet(b) ? b : {};
  const texte = nettoyer(x.texte, MAX_MESSAGE + 200).replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_MESSAGE);
  if (!texte) throw new ErreurCommande('Écrivez votre message.', 'texte');
  return { texte, produit: valider.identifiant(x.produit), commande: valider.identifiant(x.commande) };
}
/* Début d'un message sur une ligne (liste des discussions, notification). */
function apercuMessage(texte, max) {
  const n = max || 140; const t = String(texte == null ? '' : texte).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/* ---------- Avis et notes des clients (achats livrés seulement) ---------- */

const MAX_AVIS = 600;                // caractères d'un avis, ou de la réponse de la boutique
const AVIS_PAR_PAGE = 10;
const RAPPEL_AVIS_JOURS = [2, 14];   // rappel gratuit au client entre 2 et 14 jours après la livraison
/* Raisons de masquer un avis (montrées au client qui l'a écrit) : jamais parce qu'il est négatif. */
const MOTIFS_AVIS = {
  injurieux: 'Propos injurieux ou déplacés',
  personnel: 'Données personnelles (téléphone, adresse…)',
  hors_sujet: 'Sans rapport avec l’article',
  faux: 'Avis douteux (pas l’avis d’un client)',
  autre: 'Ne respecte pas les règles des avis'
};
const texteLong = (s) => nettoyer(s, MAX_AVIS + 200).replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_AVIS);
/* Avis saisi : { note (1 à 5 étoiles), texte (facultatif) }, ou ErreurCommande. */
function avisNettoye(b) {
  const x = estObjet(b) ? b : {};
  const note = Number(x.note);
  if (!(note >= 1 && note <= 5 && Math.round(note) === note)) throw new ErreurCommande('Choisissez une note, de 1 à 5 étoiles.', 'note');
  return { note, texte: texteLong(x.texte) };
}
/* Réponse publique de la boutique à un avis ('' : réponse retirée). */
const reponseAvisNettoyee = (s) => texteLong(s);
/* Nom montré sous un avis : « Aline F. » (prénom et initiale du nom), jamais le nom complet ni le téléphone. */
function nomPublic(nom) {
  const mots = nettoyer(nom, 80).replace(/\s+/g, ' ').split(' ').filter((m) => /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(m));
  if (!mots.length) return 'Client';
  const premier = mots[0] === mots[0].toUpperCase() ? mots[0].charAt(0) + mots[0].slice(1).toLowerCase() : mots[0].charAt(0).toUpperCase() + mots[0].slice(1);
  return mots.length > 1 ? `${premier} ${mots[mots.length - 1].charAt(0).toUpperCase()}.` : premier;
}
/* Moyenne et nombre d'avis depuis la répartition { 5: n, 4: n, … } : { note (à 0,1 près), nombre, repartition }. */
function resumeAvis(compte) {
  const rep = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }; let somme = 0, n = 0;
  [1, 2, 3, 4, 5].forEach((v) => { const k = Math.max(0, int(compte && compte[v])); rep[v] = k; somme += v * k; n += k; });
  return { note: n ? Math.round((somme / n) * 10) / 10 : 0, nombre: n, repartition: rep };
}
/* État d'un avis enregistré : publié tout de suite, sauf quand la boutique vérifie les avis, ou qu'un avis masqué est réécrit. */
const etatAvis = (cfg, avant) => ((cfg.reviews && cfg.reviews.moderation) || (avant && avant.etat === 'masque') ? 'attente' : 'publie');
/* Option achetée, montrée sous un avis : « Bordeaux, taille M », « Taille M » ou « Bordeaux ». */
function optionAchetee(couleur, taille) {
  const c = nettoyer(couleur, 40); const t = nettoyer(taille, 30);
  return [c, t ? (c ? 'taille ' : 'Taille ') + t : ''].filter(Boolean).join(', ');
}
/* Articles d'une commande livrée que le client peut noter : un par article, avec l'option achetée. */
function articlesANoter(o) {
  if (!o || o.fulfillment !== 'delivered') return [];
  const vus = {}; const l = [];
  (o.items || []).forEach((i) => {
    if (!i || !valider.identifiant(i.productId) || vus[i.productId]) return;
    vus[i.productId] = true;
    l.push({ produit: i.productId, titre: String(i.title || 'Article').slice(0, 120), variante: optionAchetee(i.color, i.size) });
  });
  return l;
}
/* Rappel « Votre avis compte » d'une commande livrée : { titre, autres } (articles pas encore notés), sinon null. */
function rappelAvis({ cfg, o, notes, maintenant }) {
  const r = cfg && cfg.reviews;
  if (!r || !r.enabled || !r.reminder || !o || o.fulfillment !== 'delivered') return null;
  const age = (maintenant || Date.now()) - int(o.deliveredAt);
  if (!int(o.deliveredAt) || age < RAPPEL_AVIS_JOURS[0] * JOUR || age > RAPPEL_AVIS_JOURS[1] * JOUR) return null;
  const reste = articlesANoter(o).filter((a) => !(notes && notes(a.produit)));
  return reste.length ? { titre: reste[0].titre, autres: reste.length - 1 } : null;
}

module.exports = {
  OPERATEURS, FOURNISSEURS, ZONES_DEFAUT, CONFIG_DEFAUT, MAX_LIGNES, MAX_QTE, MAX_TENTATIVES, RELANCE_APRES_S, ACTIONS, JOUR,
  ROLES, roleNettoye, DROITS, peut, etapePermise, pourLivreur,
  num, int, arrondi, chiffres, nettoyer, estObjet, copie, fusion, pluriel, slug, dollars, valider,
  config, zoneDe, estRetrait, moyensDePaiement, fraisService,
  cleVariante, couleursDe, taillesDe, aDesOptions, estImport, estEnVente, clesVariantes, stockDe, stockTotal, prixBarre, pourcentRemise, imagePrincipale, ajusterStock,
  MAX_PALIERS, prixVariante, prixPossibles, venteFlash, paliersGros, remiseGros, prixUnitaire, prixAffiche, poidsDe,
  montantRemise, verifierRemise, devis,
  ErreurCommande, reservations, livraisonEstimee, preparerCommande, numeroCommande, numeroValide, numeroNettoye,
  estAnnulee, estPayee, estRetraitCmd, enAttentePaiement, nonAboutie, aVerifier, aPreparer, aExpedier, aTraiter, statutClient, etapesSuivi,
  relancePossible, paiementEnvoye, paiementConfirme, paiementEchoue, paiementExpire, doublonARembourser, TEXTE_DOUBLON,
  etapeCommande, reservationsAnciennes, incoherences, margeCommande,
  MAX_FAVORIS, CODE_CHIFFRES, codeConnexion, telephoneInternational, panierCompte, favorisCompte, profilCompte, docCompte, daterCompte, fusionCompte,
  MAX_LIGNES_PARTAGE, lienPanier, panierDepuisLien, apercuPartage,
  evenementsCommande, TEXTES_NOTIFICATIONS, texteNotification,
  MAX_ALERTES, ANNONCES_PAR_JOUR, libelleVariante, varianteAlerte, alerteDisponible, annonceNettoyee,
  RELANCE_PANIER_JOURS, relancePanier,
  MAX_MESSAGE, MESSAGES_PAR_JOUR, messageNettoye, apercuMessage,
  MAX_AVIS, AVIS_PAR_PAGE, RAPPEL_AVIS_JOURS, MOTIFS_AVIS, avisNettoye, reponseAvisNettoyee, nomPublic, resumeAvis, etatAvis, optionAchetee, articlesANoter, rappelAvis
};
