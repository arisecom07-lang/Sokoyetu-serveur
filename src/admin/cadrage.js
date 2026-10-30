// Sokoyetu (administration) — cadrage automatique des photos produits.
// L'assistant IA donne le cadre de l'article (millièmes de la photo) ; ici, dans le navigateur, la photo est recadrée
// au format des fiches de la boutique (4:5), l'article centré et en grand, puis éclairée (niveaux, couleurs un peu plus vives).
// Aucun service d'image en plus : rien d'autre que le canvas du navigateur.

export const RATIO = 4 / 5;
const MARGE = 0.09;          // marge autour de l'article, de chaque côté, en part du cadre
const ZOOM_MAX = 0.42;       // le cadre garde au moins 42 % du plus grand cadre 4:5 possible (évite une photo floue)
const COTE_MAX = 1600;

const borne = (v, a, b) => Math.min(b, Math.max(a, v));

/* Géométrie seule (testée sans navigateur) : W×H de la photo, cadre en millièmes → zone { x, y, l, h } en pixels de la photo.
   La zone peut dépasser la photo quand l'article touche un bord : le reste est rempli avec la couleur du fond. */
export function calculerCadrage(W, H, cadre) {
  if (!cadre || !(W > 0) || !(H > 0)) return null;
  const x0 = (cadre.gauche / 1000) * W, x1 = (cadre.droite / 1000) * W, y0 = (cadre.haut / 1000) * H, y1 = (cadre.bas / 1000) * H;
  const ow = x1 - x0, oh = y1 - y0;
  if (!(ow > 4) || !(oh > 4)) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let h = Math.max(oh / (1 - 2 * MARGE), ow / (1 - 2 * MARGE) / RATIO, Math.min(H, W / RATIO) * ZOOM_MAX);
  const l = h * RATIO;
  // On garde le vrai fond de la photo autant que possible : le cadre glisse vers l'intérieur au lieu d'ajouter des bandes.
  const x = borne(cx - l / 2, Math.min(0, W - l), Math.max(0, W - l));
  const y = borne(cy - h / 2, Math.min(0, H - h), Math.max(0, H - h));
  return { x, y, l, h };
}

/* Niveaux automatiques : table de correspondance 0-255 à partir de l'histogramme de luminance. */
export function tableLumiere(histo, total) {
  const seuil = (p) => { let n = 0; for (let i = 0; i < 256; i++) { n += histo[i]; if (n >= total * p) return i; } return 255; };
  const bas = seuil(0.005), haut = seuil(0.995);
  let moyenne = 0; for (let i = 0; i < 256; i++) moyenne += i * histo[i]; moyenne /= total || 1;
  // Le ton le plus clair (souvent le fond) monte vers un blanc doux ; le noir ne descend que d'un peu, pour ne pas boucher les ombres.
  const depart = Math.min(bas, 20);
  const gain = haut - depart > 20 ? borne(245 / (haut - depart), 1, 1.55) : 1;
  // Photo sombre : on l'éclaircit doucement (gamma), sans jamais l'assombrir.
  const m = borne(((moyenne - depart * (gain > 1)) * gain) / 255, 0.05, 0.95);
  const gamma = m < 0.5 ? borne(Math.log(0.52) / Math.log(m), 0.72, 1) : 1;
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(255 * Math.pow(borne(((i - (gain > 1 ? depart : 0)) * gain) / 255, 0, 1), gamma));
  return t;
}

const charger = (fichier) => new Promise((ok, ko) => {
  const url = URL.createObjectURL(fichier); const i = new Image();
  i.onload = () => { URL.revokeObjectURL(url); ok(i); }; i.onerror = (e) => { URL.revokeObjectURL(url); ko(e); }; i.src = url;
});

/* Couleur du fond : médiane des pixels du pourtour de la photo. */
function couleurFond(img) {
  const n = 48; const c = document.createElement('canvas'); c.width = n; c.height = n;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data; const r = [], g = [], b = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i > 1 && j > 1 && i < n - 2 && j < n - 2) continue;
    const k = (j * n + i) * 4; r.push(d[k]); g.push(d[k + 1]); b.push(d[k + 2]);
  }
  const med = (l) => l.sort((a, z) => a - z)[l.length >> 1];
  return [med(r), med(g), med(b)];
}

/* Fondu de la couleur du fond sur le bord de la photo, du côté où le cadre dépasse : pas de raccord visible. */
function fondre(x, [r, g, b], cote, a, z, L, H) {
  const plein = `rgba(${r},${g},${b},1)`, vide = `rgba(${r},${g},${b},0)`;
  const larg = Math.max(8, Math.round((cote === 'g' || cote === 'd' ? L : H) * 0.05));
  let gr;
  if (cote === 'g') { gr = x.createLinearGradient(a, 0, a + larg, 0); }
  if (cote === 'd') { gr = x.createLinearGradient(z, 0, z - larg, 0); }
  if (cote === 'h') { gr = x.createLinearGradient(0, a, 0, a + larg); }
  if (cote === 'b') { gr = x.createLinearGradient(0, z, 0, z - larg); }
  gr.addColorStop(0, plein); gr.addColorStop(1, vide); x.fillStyle = gr;
  if (cote === 'g') x.fillRect(a, 0, larg, H);
  if (cote === 'd') x.fillRect(z - larg, 0, larg, H);
  if (cote === 'h') x.fillRect(0, a, L, larg);
  if (cote === 'b') x.fillRect(0, z - larg, L, larg);
}

/* Photo d'origine + cadre de l'assistant → { blob, w, h, avant, apres } au format 4:5, ou null si le cadre est inutilisable. */
export async function cadrerPhoto(fichier, cadre, qualite = 0.85) {
  const img = await charger(fichier);
  const W = img.naturalWidth, H = img.naturalHeight;
  const z = calculerCadrage(W, H, cadre);
  if (!z) return null;
  const k = Math.min(1, COTE_MAX / z.h);
  const L = Math.round(z.l * k), Ht = Math.round(z.h * k);
  const c = document.createElement('canvas'); c.width = L; c.height = Ht;
  const x = c.getContext('2d');
  const fond = couleurFond(img);
  x.fillStyle = `rgb(${fond.join(',')})`; x.fillRect(0, 0, L, Ht);
  x.imageSmoothingQuality = 'high';
  // Partie de la photo visible dans le cadre, puis sa place dans le canvas.
  const sx = Math.max(0, z.x), sy = Math.max(0, z.y), sx1 = Math.min(W, z.x + z.l), sy1 = Math.min(H, z.y + z.h);
  const dx = (sx - z.x) * k, dy = (sy - z.y) * k, dl = (sx1 - sx) * k, dh = (sy1 - sy) * k;
  x.drawImage(img, sx, sy, sx1 - sx, sy1 - sy, dx, dy, dl, dh);
  if (dx > 0.5) fondre(x, fond, 'g', dx, 0, L, Ht);
  if (dx + dl < L - 0.5) fondre(x, fond, 'd', 0, dx + dl, L, Ht);
  if (dy > 0.5) fondre(x, fond, 'h', dy, 0, L, Ht);
  if (dy + dh < Ht - 0.5) fondre(x, fond, 'b', 0, dy + dh, L, Ht);
  eclairer(x, L, Ht);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', qualite));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', Math.min(0.9, qualite + 0.04)));
  return { blob, w: L, h: Ht, avant: fichier.size, apres: blob.size };
}

/* Lumière et couleurs : niveaux automatiques, puis couleurs 6 % plus vives. */
function eclairer(x, L, H) {
  const im = x.getImageData(0, 0, L, H); const d = im.data;
  const histo = new Uint32Array(256); let total = 0;
  for (let i = 0; i < d.length; i += 16) { histo[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; total++; }
  const t = tableLumiere(histo, total);
  const S = 1.06;
  for (let i = 0; i < d.length; i += 4) {
    const r = t[d[i]], g = t[d[i + 1]], b = t[d[i + 2]];
    const y = (r * 77 + g * 150 + b * 29) >> 8;
    d[i] = y + (r - y) * S; d[i + 1] = y + (g - y) * S; d[i + 2] = y + (b - y) * S;
  }
  x.putImageData(im, 0, 0);
}
