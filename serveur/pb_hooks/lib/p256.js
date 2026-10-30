/*
 * Sokoyetu — courbe elliptique P-256 et signature ES256 (ECDSA + SHA-256), en JavaScript pur (BigInt) :
 * le serveur signe ainsi les jetons VAPID des notifications du téléphone (lib/push.js), sans bibliothèque extérieure.
 * Aucune dépendance au serveur : l'empreinte SHA-256 et le hasard sont fournis par l'appelant (hexadécimal),
 * ce qui permet de vérifier ce module avec Node (tests/push.test.js).
 */
const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');
const G = { x: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), y: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5') };
const ZERO = BigInt(0), UN = BigInt(1), DEUX = BigInt(2), TROIS = BigInt(3), QUATRE = BigInt(4), HUIT = BigInt(8);

const mod = (a, m) => { const r = a % m; return r < ZERO ? r + m : r; };
function puissance(b, e, m) {
  let r = UN; b = mod(b, m);
  while (e > ZERO) { if (e & UN) r = (r * b) % m; b = (b * b) % m; e >>= UN; }
  return r;
}
const inverse = (a, m) => puissance(a, m - DEUX, m); // m premier (P et N le sont)

/* Points en coordonnées jacobiennes (X, Y, Z) : une seule inversion à la fin. Z = 0 : point à l'infini. */
function doubler(p) {
  if (p.z === ZERO || p.y === ZERO) return { x: ZERO, y: UN, z: ZERO };
  const delta = (p.z * p.z) % P, gamma = (p.y * p.y) % P, beta = (p.x * gamma) % P;
  const alpha = (TROIS * mod(p.x - delta, P) * ((p.x + delta) % P)) % P;
  const x = mod(alpha * alpha - HUIT * beta, P);
  const z = mod((p.y + p.z) * (p.y + p.z) - gamma - delta, P);
  const y = mod(alpha * mod(QUATRE * beta - x, P) - HUIT * ((gamma * gamma) % P), P);
  return { x, y, z };
}
/* p (jacobien) + q (affine). */
function ajouter(p, q) {
  if (p.z === ZERO) return { x: q.x, y: q.y, z: UN };
  const z1z1 = (p.z * p.z) % P;
  const u2 = (q.x * z1z1) % P, s2 = (((q.y * p.z) % P) * z1z1) % P;
  const h = mod(u2 - p.x, P), r = mod(DEUX * (s2 - p.y), P);
  if (h === ZERO) return r === ZERO ? doubler(p) : { x: ZERO, y: UN, z: ZERO };
  const hh = (h * h) % P, i = (QUATRE * hh) % P, j = (h * i) % P, v = (p.x * i) % P;
  const x = mod(r * r - j - DEUX * v, P);
  const y = mod(r * mod(v - x, P) - DEUX * ((p.y * j) % P), P);
  const z = mod((p.z + h) * (p.z + h) - z1z1 - hh, P);
  return { x, y, z };
}
function affine(p) {
  if (p.z === ZERO) return null;
  const zi = inverse(p.z, P), zi2 = (zi * zi) % P;
  return { x: (p.x * zi2) % P, y: (((p.y * zi2) % P) * zi) % P };
}
/* k·Q (Q affine), bit à bit du plus fort au plus faible. */
function multiplier(k, q) {
  let r = { x: ZERO, y: UN, z: ZERO };
  for (let i = k.toString(2).length - 1; i >= 0; i--) {
    r = doubler(r);
    if ((k >> BigInt(i)) & UN) r = ajouter(r, q);
  }
  return affine(r);
}
const surLaCourbe = (q) => !!q && mod(q.y * q.y - (q.x * q.x * q.x - TROIS * q.x + B), P) === ZERO;

/* Nombre en 32 octets (gros-boutiste). */
function octets32(n) {
  const h = n.toString(16).padStart(64, '0'); const o = [];
  for (let i = 0; i < 64; i += 2) o.push(parseInt(h.slice(i, i + 2), 16));
  return o;
}
const versNombre = (hex) => BigInt('0x' + (String(hex || '').replace(/[^0-9a-f]/gi, '') || '0'));

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/* Base64 « url » sans remplissage, depuis des octets. */
function base64url(o) {
  let s = '';
  for (let i = 0; i < o.length; i += 3) {
    const n = (o[i] << 16) | ((o[i + 1] || 0) << 8) | (o[i + 2] || 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < o.length ? B64[(n >> 6) & 63] : '') + (i + 2 < o.length ? B64[n & 63] : '');
  }
  return s;
}
/* Texte ASCII (en-tête et contenu d'un jeton) en base64url. */
const texteBase64url = (t) => base64url(Array.from(String(t), (c) => c.charCodeAt(0) & 255));

/* Clé privée tirée au hasard (64 chiffres hexadécimaux fournis par l'appelant) → { prive (hex), public (base64url, 65 octets non compressés) }. */
function cles(hasardHex) {
  const d = mod(versNombre(hasardHex), N - UN) + UN;
  const q = multiplier(d, G);
  return { prive: d.toString(16).padStart(64, '0'), public: base64url([4].concat(octets32(q.x), octets32(q.y))) };
}
/* Clé publique (base64url) d'une clé privée (hex). */
function clePublique(priveHex) {
  const q = multiplier(versNombre(priveHex), G);
  return base64url([4].concat(octets32(q.x), octets32(q.y)));
}

/*
 * Signature ECDSA d'une empreinte SHA-256 (hex) : 64 octets r‖s en base64url (format JWS « ES256 »).
 * hasard() renvoie 64 chiffres hexadécimaux tirés au sort (un nouveau nombre k à chaque signature).
 */
function signer(empreinteHex, priveHex, hasard) {
  const z = versNombre(empreinteHex), d = versNombre(priveHex);
  for (let essai = 0; essai < 16; essai++) {
    const k = mod(versNombre(hasard()), N - UN) + UN;
    const p = multiplier(k, G);
    const r = mod(p.x, N); if (r === ZERO) continue;
    const s = mod(inverse(k, N) * (z + r * d), N); if (s === ZERO) continue;
    return base64url(octets32(r).concat(octets32(s)));
  }
  throw new Error('Signature impossible');
}

module.exports = { cles, clePublique, signer, base64url, texteBase64url, surLaCourbe, multiplier, G };
