/*
 * Sokoyetu — assistant IA des fiches produits (administration).
 * Une photo d'article → titre, description, caractéristiques, couleurs, tailles, rayon,
 * et le cadre de l'article sur la photo (l'administration recadre et éclaire la photo à partir de ce cadre).
 * Import depuis un fournisseur : la photo est donnée par son adresse, avec le texte de la page (souvent en chinois) à traduire.
 * Appel direct à l'API Claude (pas de SDK dans PocketBase). Clé : variable ANTHROPIC_API_KEY,
 * enregistrée sur le serveur avec « sudo /opt/sokoyetu/ia.sh VOTRE_CLE ».
 */
const MODELE = 'claude-opus-5-5';
const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Essais seulement : adresse d'un faux service (tests/claude-simule.mjs).
const URL_API = () => String($os.getenv('ANTHROPIC_URL') || 'https://api.anthropic.com').replace(/\/+$/, '');

// Rectangle de l'article en millièmes de la largeur et de la hauteur de la photo (0 = bord gauche ou haut, 1000 = bord droit ou bas).
const CADRE = {
  type: 'object',
  properties: { gauche: { type: 'integer' }, haut: { type: 'integer' }, droite: { type: 'integer' }, bas: { type: 'integer' } },
  required: ['gauche', 'haut', 'droite', 'bas'],
  additionalProperties: false
};

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    details: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'], additionalProperties: false } },
    colors: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, hex: { type: 'string' } }, required: ['name', 'hex'], additionalProperties: false } },
    sizes: { type: 'array', items: { type: 'string' } },
    collectionIds: { type: 'array', items: { type: 'string' } },
    newCollection: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    alt: { type: 'string' },
    cadre: CADRE
  },
  required: ['title', 'description', 'details', 'colors', 'sizes', 'collectionIds', 'newCollection', 'tags', 'alt', 'cadre'],
  additionalProperties: false
};

const REGLE_CADRE = 'le plus petit rectangle qui contient tout l’article à vendre (avec ses accessoires vendus avec lui, sans le décor, les mains ni les autres objets), en millièmes de la photo : gauche et droite de 0 (bord gauche) à 1000 (bord droit), haut et bas de 0 (bord du haut) à 1000 (bord du bas). Ne coupe aucune partie de l’article ; s’il y a plusieurs exemplaires ou coloris côte à côte, le rectangle les contient tous.';

function consigne(ctx) {
  const rayons = (ctx.collections || []).map((c) => `- ${c.id} : ${c.name}`).join('\n') || '(aucun rayon pour l’instant)';
  return `Tu rédiges les fiches produits de ${ctx.shop}, une boutique en ligne de ${ctx.city} (RDC) qui importe ses articles de Chine et livre à Bukavu et à Goma.
Regarde la photo de l’article et écris sa fiche en français simple, chaleureux et précis, pour des clients congolais qui achètent depuis leur téléphone.

Règles :
- Décris seulement ce que la photo montre ou ce qui est très probable. N’invente ni marque, ni dimensions, ni chiffres techniques, ni prix.
- title : 60 caractères au plus, précis (type d’article, matière ou style, couleur si l’article n’existe qu’en une couleur). Pas d’émoji, pas de majuscules partout.
- description : 2 à 4 phrases : à quoi sert l’article, pour qui, ce qui le rend agréable à utiliser.
- details : 3 à 6 caractéristiques (par exemple Matière, Style, Usage, Fermeture, Entretien). Si une valeur est incertaine, ajoute « (probable) ».
- colors : les couleurs visibles de l’article lui-même (1 à 4), avec un nom simple en français et un code hexadécimal #RRGGBB proche.
- sizes : seulement pour un vêtement ou des chaussures (par exemple S, M, L, XL ou 39 à 43), sinon une liste vide.
- collectionIds : les identifiants des rayons ci-dessous qui conviennent. Si aucun ne convient, liste vide et propose un nom de rayon court dans newCollection (sinon newCollection vide).
- tags : 5 à 8 mots-clés de recherche.
- alt : une courte description de la photo (120 caractères au plus).
- cadre : ${REGLE_CADRE}

Rayons existants (identifiant : nom) :
${rayons}${ctx.hint ? `\n\nIndication du vendeur : ${ctx.hint}` : ''}${ctx.texte ? `\n\nTexte de la page du fournisseur (souvent en chinois ou en anglais, parfois mal encodé) : sers-t’en pour la matière, les couleurs et les tailles proposées, traduis-le, ne le recopie pas, et ignore les prix, quantités minimales, noms d’usine et promesses publicitaires :\n${ctx.texte}` : ''}`;
}

function nettoyerReponse(r, ctx) {
  const s = (v, n) => String(v == null ? '' : v).replace(/[ \t]+\n/g, '\n').trim().slice(0, n);
  const ids = {}; (ctx.collections || []).forEach((c) => { ids[c.id] = true; });
  const hex = (h) => { h = String(h || '').trim(); return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : ''; };
  const uniques = (l) => l.filter((v, i, a) => v && a.indexOf(v) === i);
  const out = {
    title: s(r.title, 120),
    description: s(r.description, 3000),
    details: (Array.isArray(r.details) ? r.details : []).map((d) => d && s(d.name, 30) && s(d.value, 80) ? `${s(d.name, 30)} : ${s(d.value, 80)}` : '').filter(Boolean).slice(0, 8).join('\n'),
    colors: (Array.isArray(r.colors) ? r.colors : []).map((c) => ({ name: s(c && c.name, 24).replace(/[.|]/g, ''), hex: hex(c && c.hex) })).filter((c) => c.name && c.hex).slice(0, 6),
    sizes: uniques((Array.isArray(r.sizes) ? r.sizes : []).map((x) => s(x, 14).replace(/[.|]/g, ''))).slice(0, 12),
    collectionIds: uniques((Array.isArray(r.collectionIds) ? r.collectionIds : []).map(String).filter((id) => ids[id])),
    newCollection: s(r.newCollection, 40),
    tags: uniques((Array.isArray(r.tags) ? r.tags : []).map((t) => s(t, 30).toLowerCase())).slice(0, 10).join(', '),
    alt: s(r.alt, 140),
    cadre: nettoyerCadre(r.cadre)
  };
  if (!out.title && !out.description) throw { code: 'invalid_json' };
  return out;
}

/* Cadre en millièmes, remis dans l'ordre et borné ; null s'il est absent ou trop petit pour être sérieux (moins de 3 % de côté). */
function nettoyerCadre(c) {
  if (!c || typeof c !== 'object') return null;
  const n = (v) => Math.max(0, Math.min(1000, Math.round(Number(v))));
  const v = [c.gauche, c.haut, c.droite, c.bas].map(n);
  if (v.some((x) => !isFinite(x))) return null;
  const out = { gauche: Math.min(v[0], v[2]), haut: Math.min(v[1], v[3]), droite: Math.max(v[0], v[2]), bas: Math.max(v[1], v[3]) };
  if (out.droite - out.gauche < 30 || out.bas - out.haut < 30) return null;
  return out;
}

/* Photo reçue (adresse https ou base64) → bloc image de l'API, sinon erreur image_rejected. */
function blocImage(entree) {
  const adresse = /^https:\/\/[^\s"'<>]{8,1000}$/.test(String(entree.imageUrl || '')) ? String(entree.imageUrl) : '';
  const type = TYPES_IMAGE.indexOf(entree.mediaType) >= 0 ? entree.mediaType : '';
  const image = String(entree.image || '');
  if (!adresse && (!type || !image || image.length > 7000000 || !/^[A-Za-z0-9+/=]+$/.test(image))) throw { code: 'image_rejected', status: 400 };
  return { type: 'image', source: adresse ? { type: 'url', url: adresse } : { type: 'base64', media_type: type, data: image } };
}

/* Un appel à Claude avec une photo et une consigne ; renvoie l'objet JSON demandé ou lève { code, status }. */
function appeler(image, texte, schema, maxTokens) {
  const cle = String($os.getenv('ANTHROPIC_API_KEY') || '').trim();
  if (!cle) throw { code: 'no_key', status: 503 };
  let res;
  try {
    res = $http.send({
      url: URL_API() + '/v1/messages',
      method: 'POST',
      timeout: 90,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: maxTokens,
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: [image, { type: 'text', text: texte }] }]
      })
    });
  } catch (err) { throw { code: 'network', status: 502 }; }
  const j = res.json || {};
  if (res.statusCode === 401 || res.statusCode === 403) throw { code: 'bad_key', status: 502 };
  if (res.statusCode === 429 || res.statusCode === 529) throw { code: 'rate_limited', status: 503 };
  if (res.statusCode === 400 && /image/i.test(String((j.error && j.error.message) || ''))) throw { code: 'image_rejected', status: 400 };
  if (res.statusCode !== 200) throw { code: 'upstream_error', status: 502 };
  if (j.stop_reason === 'refusal') throw { code: 'refused', status: 422 };
  if (j.stop_reason === 'max_tokens') throw { code: 'invalid_json', status: 502 };
  const sortie = (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(sortie); } catch (e) { throw { code: 'invalid_json', status: 502 }; }
}

/* Renvoie la fiche ou lève { code, status } avec un code lisible par l'administration. */
function fiche(entree) {
  if (!String($os.getenv('ANTHROPIC_API_KEY') || '').trim()) throw { code: 'no_key', status: 503 };
  const image = blocImage(entree);
  const ctx = {
    shop: String(entree.shop || 'Sokoyetu').slice(0, 40), city: String(entree.city || 'Bukavu').slice(0, 40),
    hint: String(entree.hint || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    texte: String(entree.texte || '').replace(/[ \t]+/g, ' ').trim().slice(0, 2500),
    collections: (Array.isArray(entree.collections) ? entree.collections : []).slice(0, 80)
      .map((c) => ({ id: String((c && c.id) || '').slice(0, 40), name: String((c && c.name) || '').slice(0, 40) })).filter((c) => c.id && c.name)
  };
  return nettoyerReponse(appeler(image, consigne(ctx), SCHEMA, 16000), ctx);
}

/* Photo ajoutée sans fiche à rédiger : seulement le cadre de l'article ({ cadre } ou { cadre: null }). */
const SCHEMA_CADRE = { type: 'object', properties: { cadre: CADRE }, required: ['cadre'], additionalProperties: false };
function cadre(entree) {
  if (!String($os.getenv('ANTHROPIC_API_KEY') || '').trim()) throw { code: 'no_key', status: 503 };
  const hint = String(entree.hint || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const texte = `Cette photo montre un article vendu par une boutique en ligne.${hint ? ` Article : ${hint}.` : ''}\nDonne cadre : ${REGLE_CADRE}`;
  return { cadre: nettoyerCadre(appeler(blocImage(entree), texte, SCHEMA_CADRE, 2000).cadre) };
}

const active = () => !!String($os.getenv('ANTHROPIC_API_KEY') || '').trim();

module.exports = { fiche, cadre, active, consigne, nettoyerReponse, nettoyerCadre, SCHEMA, MODELE };
