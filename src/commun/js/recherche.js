/*
 * Sokoyetu — recherche dans le catalogue, tolérante aux fautes.
 *
 * Retrouve l'article malgré les accents et les majuscules, les pluriels, une lettre oubliée, en trop, doublée ou inversée
 * (« mntre », « monter » → montre), les sons proches (« telefone » → téléphone, « chosure » → chaussure) et les mots
 * courants d'autres langues à Bukavu et Goma (swahili : « saa » → montre, « viatu » → chaussures ; anglais : « bag »).
 * Tourne dans le navigateur, sur le catalogue déjà chargé : rien n'est envoyé au serveur pendant la frappe.
 *
 * Contraintes : CommonJS sans dépendance (testé avec node --test), pas de classes Unicode \p{…}.
 */
'use strict';

/* Mots trop courants pour aider à trouver un article (français, anglais, swahili). */
const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une', 'en', 'et', 'a', 'au', 'aux', 'pour', 'avec', 'sans', 'sur',
  'par', 'ou', 'the', 'of', 'for', 'and', 'with', 'na', 'ya', 'wa', 'kwa', 'za']);

/*
 * Familles de mots qui désignent la même chose : chercher l'un trouve les autres (un peu moins haut dans la liste).
 * Français, swahili (Bukavu, Goma) et anglais. Un mot par entrée, au singulier.
 */
const SYNONYMES = [
  ['habit', 'vetement', 'nguo', 'clothes'],
  ['robe', 'gauni', 'dress'],
  ['chemise', 'shati', 'shirt'],
  ['tshirt', 'teeshirt', 'polo'],
  ['pantalon', 'suruali', 'jean', 'trousers'],
  ['jupe', 'sketi', 'skirt'],
  ['veste', 'manteau', 'blouson', 'koti', 'jacket', 'coat'],
  ['chaussure', 'soulier', 'viatu', 'kiatu', 'shoe', 'basket', 'sandale', 'escarpin', 'botte', 'mocassin', 'sneaker'],
  ['sac', 'sacoche', 'mkoba', 'bag', 'cartable', 'besace', 'pochette'],
  ['montre', 'saa', 'watch', 'smartwatch'],
  ['bijou', 'jewelry', 'jewellery'],
  ['collier', 'mkufu', 'chaine', 'pendentif', 'necklace'],
  ['bracelet', 'bangili', 'gourmette', 'jonc'],
  ['bague', 'pete', 'alliance', 'ring'],
  ['boucle', 'hereni', 'earring'],
  ['lunette', 'miwani', 'glasses', 'sunglasses'],
  ['chapeau', 'casquette', 'bonnet', 'kofia', 'hat'],
  ['ceinture', 'mkanda', 'belt'],
  ['parfum', 'manukato', 'perfume'],
  ['telephone', 'smartphone', 'simu', 'phone'],
  ['ecouteur', 'oreillette', 'airpod', 'earbud', 'earphone'],
  ['casque', 'headphone', 'headset'],
  ['enceinte', 'baffle', 'speaker', 'hautparleur'],
  ['batterie', 'powerbank'],
  ['chargeur', 'charger'],
  ['ordinateur', 'laptop', 'kompyuta'],
  ['femme', 'dame', 'mwanamke', 'wanawake', 'woman', 'women'],
  ['homme', 'mwanaume', 'wanaume', 'man', 'men'],
  ['enfant', 'mtoto', 'watoto', 'kid'],
  // Couleurs : « rouge » trouve aussi le bordeaux, « or » le doré.
  ['rouge', 'bordeaux', 'nyekundu', 'red'],
  ['noir', 'nyeusi', 'black'],
  ['blanc', 'nyeupe', 'white'],
  ['bleu', 'marine', 'blue'],
  ['vert', 'kijani', 'green'],
  ['jaune', 'njano', 'yellow'],
  ['rose', 'pink'],
  ['marron', 'brun', 'camel', 'chocolat', 'kahawia', 'brown'],
  ['gris', 'kijivu', 'grey', 'gray'],
  ['or', 'dore', 'dhahabu', 'gold'],
  ['argent', 'argente', 'fedha', 'silver']
];

/* ---------- Mots : normalisation, racine, son ---------- */

/* « Écouteurs » → « ecouteurs » : sans accents ni majuscules. */
function normaliser(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}
/* Les mots d'un texte : [{ brut: 'connectée', n: 'connectee' }] (minuscules, accents gardés pour l'affichage). */
function decouper(s) {
  return String(s == null ? '' : s).toLowerCase().split(/[^0-9a-zà-öø-ÿœæ]+/).filter(Boolean).map((brut) => ({ brut, n: normaliser(brut) }));
}
/* Racine : pluriel et e final retirés (« montres » → « montr », « chaussures » → « chaussur »), des deux côtés de la comparaison. */
function racine(n) {
  let r = n;
  if (r.length > 3 && /[sx]$/.test(r)) r = r.slice(0, -1);
  if (r.length > 4 && r[r.length - 1] === 'e') r = r.slice(0, -1);
  return r;
}
/* Son approximatif (français) : « telefone » et « téléphone », « chosure » et « chaussure », « bracelé » et « bracelet ». */
function son(n) {
  const m = n.length > 3 && /[sx]$/.test(n) ? n.slice(0, -1) : n;
  return m.replace(/[cs]h/g, '9').replace(/ph/g, 'f').replace(/q(u)?/g, 'k').replace(/c([eiy])/g, 's$1').replace(/c/g, 'k')
    .replace(/z/g, 's').replace(/w/g, 'v').replace(/y/g, 'i').replace(/eau|au/g, 'o').replace(/ai|ei/g, 'e').replace(/en/g, 'an')
    .replace(/h/g, '').replace(/(.)\1+/g, '$1').replace(/[tdspx]$/, '').replace(/e$/, '');
}
/* Lettres à changer pour passer de a à b (inversion de deux lettres voisines comprise), ou max + 1 si c'est plus que max. */
function distance(a, b, max) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let avant = null, prec = [];
  for (let j = 0; j <= lb; j++) prec.push(j);
  for (let i = 1; i <= la; i++) {
    const cour = [i]; let min = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, avant[j - 2] + 1);
      cour.push(v); if (v < min) min = v;
    }
    if (min > max) return max + 1;
    avant = prec; prec = cour;
  }
  return prec[lb] > max ? max + 1 : prec[lb];
}

/* Familles de synonymes, par racine : racine → numéro de famille ; et le lexique (racine → son) pour les reconnaître mal écrits. */
const FAMILLE = new Map(); const FAMILLES = []; const LEXIQUE = new Map();
SYNONYMES.forEach((l, i) => {
  FAMILLES.push(l.map((m) => racine(normaliser(m))));
  l.forEach((m) => { const n = normaliser(m), r = racine(n); FAMILLE.set(r, i); LEXIQUE.set(r, son(n)); });
});

/*
 * Qualité de la ressemblance entre un mot cherché (q : { n, r, s }) et un mot connu (racine r, son s, forme n) :
 * 1 identique · 0,9 début du mot (dernier mot, en cours de frappe) · 0,85 même son · 0,75 une faute · 0,55 deux fautes
 * (mots longs) · 0,6 début du mot avec une faute · 0 sinon. Les mots de trois lettres ou moins doivent être exacts.
 */
function qualite(q, r, s, n, dernier) {
  if (r === q.r || n === q.n) return 1;
  if (dernier && q.n.length >= 2 && (n.indexOf(q.n) === 0 || r.indexOf(q.n) === 0)) return q.n.length >= 3 ? 0.9 : 0.5;
  if (q.n.length >= 3 && s === q.s) return 0.85;
  if (q.r.length >= 4) {
    const max = q.r.length >= 7 ? 2 : 1; const d = distance(q.r, r, max);
    if (d === 1) return 0.75;
    if (d === 2 && max === 2) return 0.55;
  }
  if (dernier && q.n.length >= 4 && n.length > q.n.length && distance(q.n, n.slice(0, q.n.length), 1) === 1) return 0.6;
  return 0;
}

/* ---------- Index du catalogue ---------- */

/*
 * indexer(produits, rayonsDe) : à refaire quand le catalogue change. rayonsDe(p) → noms des rayons de l'article.
 * Poids des champs : titre 3, rayon et mots-clés 2, couleur 1,5, caractéristiques 1, description 0,5.
 */
function indexer(produits, rayonsDe) {
  const vocab = new Map();       // racine → { r, s, n, formes, docs }
  const expressions = new Map(); // forme normalisée → { texte, n, docs, poids, mots }
  const docs = [];
  const noter = (r, brut, n, i, w) => {
    let v = vocab.get(r);
    if (!v) { v = { r, s: son(n), n, formes: new Map(), docs: new Set(), poids: 0 }; vocab.set(r, v); }
    v.formes.set(brut, (v.formes.get(brut) || 0) + 1); v.docs.add(i); if (w > v.poids) v.poids = w;
  };
  const expression = (texte, poids, i) => {
    const t = String(texte || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const n = normaliser(t).replace(/[^0-9a-z]+/g, ' ').trim();
    if (n.length < 2 || n.length > 40) return;
    let e = expressions.get(n);
    if (!e) { e = { texte: t, n, docs: new Set(), poids, mots: decouper(t).filter((m) => !MOTS_VIDES.has(m.n)).map((m) => racine(m.n)) }; expressions.set(n, e); }
    e.docs.add(i); if (poids > e.poids) e.poids = poids;
  };
  (produits || []).forEach((p, i) => {
    const poids = new Map();
    const champ = (texte, w) => decouper(texte).forEach((m) => {
      if (MOTS_VIDES.has(m.n)) return;
      const r = racine(m.n);
      if ((poids.get(r) || 0) < w) poids.set(r, w);
      noter(r, m.brut, m.n, i, w);
    });
    const rayons = (rayonsDe ? rayonsDe(p) : []).filter(Boolean);
    const couleurs = ((p.options && p.options.colors) || []).map((c) => c && c.name).filter(Boolean);
    champ(p.title, 3); rayons.forEach((x) => champ(x, 2)); champ(p.tags, 2); couleurs.forEach((x) => champ(x, 1.5));
    champ(p.details, 1); champ(p.description, 0.5);
    docs.push({ p, poids, titre: normaliser(p.title).replace(/[^0-9a-z]+/g, ' ').trim() });
    // Suggestions : rayons, mots-clés, et le début du titre (« montre », « montre connectée »…), jamais coupé sur un petit mot.
    rayons.forEach((x) => expression(x, 3, i));
    String(p.tags || '').split(/[,;]/).forEach((x) => expression(x, 2, i));
    const titre = String(p.title || '').toLowerCase().split(/[,;:(/|]| - /)[0]; const re = /[0-9a-zà-öø-ÿœæ]+/g; let m, k = 0;
    while ((m = re.exec(titre)) && k++ < 5) { if (!MOTS_VIDES.has(normaliser(m[0]))) expression(titre.slice(0, m.index + m[0].length), 1, i); }
  });
  // Forme affichée de chaque mot : la plus fréquente (à égalité, celle qui porte des accents).
  vocab.forEach((v) => {
    let meilleur = '', nb = -1;
    v.formes.forEach((k, f) => { if (k > nb || (k === nb && normaliser(f) !== f && normaliser(meilleur) === meilleur)) { meilleur = f; nb = k; } });
    v.mot = meilleur; v.n = normaliser(meilleur);
  });
  return { docs, vocab, expressions: [...expressions.values()] };
}

/* ---------- Comprendre une recherche ---------- */

/* Chaque mot cherché et les mots du catalogue qui lui ressemblent (racine → qualité), synonymes compris. */
function analyser(index, requete) {
  const mots = decouper(requete).filter((m) => !MOTS_VIDES.has(m.n));
  return mots.map((m, i) => {
    const q = { brut: m.brut, n: m.n, r: racine(m.n) }; q.s = son(q.n);
    const dernier = i === mots.length - 1 && !/\s$/.test(String(requete));
    const matchs = new Map(); let exact = false;
    let juste = false; // le mot (ou son début) est écrit tel quel dans un titre, un rayon, des mots-clés ou une couleur
    index.vocab.forEach((v) => {
      const k = qualite(q, v.r, v.s, v.n, dernier);
      // Un mot qui n'est que dans les descriptions doit être exact (ou commencé) : pas de « rouge » → « route ».
      if (!k || (v.poids < 1 && k !== 1 && k !== 0.9 && k !== 0.5)) return;
      matchs.set(v.r, Math.max(matchs.get(v.r) || 0, k)); if (k === 1) exact = true;
      if ((k === 1 || k === 0.9) && v.poids >= 1.5) juste = true;
    });
    // Mot bien écrit : ses voisins à une faute près ne comptent pas (« robe » ne trouve pas « rose »).
    if (juste) matchs.forEach((k, r) => { if (k === 0.75 || k === 0.6 || k === 0.55) matchs.delete(r); });
    // Synonymes : le mot cherché (même mal écrit) appartient à une famille → les mots de la famille présents au catalogue.
    const familles = new Set();
    LEXIQUE.forEach((s, r) => { if (qualite(q, r, s, r, dernier && q.n.length >= 4) >= (juste ? 0.85 : 0.75)) familles.add(FAMILLE.get(r)); });
    matchs.forEach((k, r) => { if (k >= 0.75 && FAMILLE.has(r)) familles.add(FAMILLE.get(r)); });
    familles.forEach((f) => FAMILLES[f].forEach((r) => { if (index.vocab.has(r) && (matchs.get(r) || 0) < 0.7) matchs.set(r, 0.7); }));
    return { q, dernier, matchs, exact };
  });
}

/* Mot du catalogue le plus proche d'un mot mal écrit (pour « Résultats pour … ») : la meilleure ressemblance, puis le plus courant. */
function correction(index, a) {
  if (a.exact) return null;
  let meilleur = null;
  a.matchs.forEach((k, r) => {
    const v = index.vocab.get(r); if (v.poids < 1.5) return;
    const d = distance(a.q.r, r, 3);
    if (!meilleur || k > meilleur.k || (k === meilleur.k && (d < meilleur.d || (d === meilleur.d && v.docs.size > meilleur.v.docs.size)))) meilleur = { k, v, d };
  });
  if (!meilleur || meilleur.k === 0.9 || meilleur.k === 0.5) return null; // simple début de mot : pas une faute
  return meilleur.v.mot;
}

/* Articles qui ressemblent à la recherche analysée, du plus proche au moins proche ; complet : tous les mots trouvés. */
function trouver(index, analyse, requete) {
  const phrase = normaliser(requete).replace(/[^0-9a-z]+/g, ' ').trim();
  const trouves = [];
  index.docs.forEach((d, i) => {
    let score = 0, n = 0;
    analyse.forEach((a) => {
      let meilleur = 0;
      d.poids.forEach((w, r) => { const k = a.matchs.get(r); if (k && k * w > meilleur) meilleur = k * w; });
      if (meilleur) { n++; score += meilleur; }
    });
    if (!n) return;
    if (phrase && d.titre.indexOf(phrase) === 0) score += 2; else if (phrase && d.titre.indexOf(phrase) > 0) score += 1;
    trouves.push({ p: d.p, score, n, i });
  });
  const max = trouves.reduce((m, x) => Math.max(m, x.n), 0);
  const gardes = trouves.filter((x) => x.n === max);
  const haut = gardes.reduce((m, x) => Math.max(m, x.score), 0);
  // Les articles beaucoup moins proches que le meilleur (un mot de la description seulement) sont écartés.
  const liste = gardes.filter((x) => x.score >= haut * 0.3).sort((a, b) => b.score - a.score || a.i - b.i);
  return { resultats: liste.map(({ p, score }) => ({ p, score })), complet: max === analyse.length || !liste.length };
}

/*
 * chercher(index, requete) → { resultats: [{ p, score }], complet, correction, mots }
 * complet : chaque mot cherché a été trouvé dans l'article ; sinon, les articles qui en ont le plus (« articles proches »).
 * correction : la recherche telle que comprise, quand un mot a été corrigé (« monter » → « montre ») ; les résultats sont
 * alors ceux de la recherche corrigée, pour qu'ils correspondent à ce qui est annoncé.
 */
function chercher(index, requete) {
  const analyse = analyser(index, requete);
  if (!analyse.length || !index.docs.length) return { resultats: [], complet: true, correction: '', mots: 0 };
  const corriges = analyse.map((a) => correction(index, a));
  const texte = corriges.some(Boolean) ? analyse.map((a, i) => corriges[i] || a.q.brut).join(' ') : '';
  if (texte) {
    const t = trouver(index, analyser(index, texte), texte);
    if (t.complet && t.resultats.length) return Object.assign(t, { correction: texte, mots: analyse.length });
  }
  return Object.assign(trouver(index, analyse, requete), { correction: texte, mots: analyse.length });
}

/*
 * suggestions(index, requete, populaires) → ['montre', 'montre connectée', …] : ce qu'on cherche sans doute, d'après les
 * rayons, les mots-clés et les titres du catalogue, mal écrit compris ; les recherches fréquentes des clients passent devant.
 */
function suggestions(index, requete, populaires, max) {
  const qn = normaliser(requete).replace(/[^0-9a-z]+/g, ' ').trim();
  if (qn.length < 2) return [];
  const analyse = analyser(index, requete);
  const pop = new Set((populaires || []).map((t) => normaliser(t).replace(/[^0-9a-z]+/g, ' ').trim()));
  const notes = [];
  index.expressions.forEach((e) => {
    if (e.n === qn) return;
    let score = 0;
    if (e.n.indexOf(qn) === 0) score = 3;
    else if (analyse.length && analyse.every((a) => e.mots.some((r) => a.matchs.get(r) >= 0.55))) {
      score = 1 + analyse.reduce((s, a) => s + Math.max.apply(null, e.mots.map((r) => a.matchs.get(r) || 0)), 0) / analyse.length;
    }
    if (!score) return;
    score += Math.log(1 + e.docs.size) * 0.4 + e.poids * 0.15 + (pop.has(e.n) ? 1.5 : 0) - e.n.split(' ').length * 0.05;
    notes.push({ texte: e.texte, score });
  });
  notes.sort((a, b) => b.score - a.score || a.texte.length - b.texte.length);
  const vus = new Set(); const out = [];
  for (const x of notes) {
    const k = decouper(x.texte).filter((m) => !MOTS_VIDES.has(m.n)).map((m) => racine(m.n)).join(' ');
    if (vus.has(k)) continue; vus.add(k); out.push(x.texte); if (out.length >= (max || 6)) break;
  }
  return out;
}

/*
 * Recherches fréquentes des clients (venues du serveur) qu'on peut montrer à tous : seulement celles dont chaque mot existe
 * au catalogue (ou en est un synonyme) et qui trouvent des articles. Écrites avec les accents du catalogue.
 */
function populairesSures(index, termes, max) {
  const out = [];
  (termes || []).forEach((t) => {
    if (out.length >= (max || 8)) return;
    const mots = decouper(t).filter((m) => !MOTS_VIDES.has(m.n));
    if (!mots.length || mots.some((m) => { const r = racine(m.n); return !index.vocab.has(r) && !(FAMILLE.has(r) && FAMILLES[FAMILLE.get(r)].some((x) => index.vocab.has(x))); })) return;
    const r = chercher(index, t);
    if (!r.complet || !r.resultats.length) return;
    const n = normaliser(t).replace(/[^0-9a-z]+/g, ' ').trim();
    const e = index.expressions.find((x) => x.n === n);
    const texte = e ? e.texte : decouper(t).map((m) => { const v = index.vocab.get(racine(m.n)); return v && v.n === m.n ? v.mot : m.brut; }).join(' ');
    if (out.indexOf(texte) < 0) out.push(texte);
  });
  return out;
}

module.exports = { MOTS_VIDES, SYNONYMES, normaliser, decouper, racine, son, distance, indexer, analyser, chercher, suggestions, populairesSures };
