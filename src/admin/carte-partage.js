// Sokoyetu (administration) — image d'aperçu des liens partagés (WhatsApp, Facebook…) : la marque à gauche, l'article à droite.
// Dessinée dans le navigateur quand un article est enregistré, envoyée comme une photo, puis annoncée par le serveur (og:image).
// Ni prix ni stock sur l'image : ils changent sans que l'article soit réenregistré (ventes flash, commandes). Le titre du lien les donne.
import { CABAS_GRAND } from '../commun/js/cabas.js';

export const LARGEUR = 1200;
export const HAUTEUR = 630;
const VERSION = 1;              // à augmenter quand le dessin change : chaque image est refaite au prochain enregistrement de l'article
const PANNEAU = 520;            // largeur de la partie marque
const MARGE = 72;
const EBENE = '#1E1611', CREME = '#FFF8F1', OR = '#C8902E', OR_CLAIR = '#E2B65C';

/* Villes livrées (zones de livraison hors retrait), sinon la ville de la boutique : « BUKAVU · GOMA ». */
function villes(c) {
  const l = (c.zones || []).filter((z) => z && !z.pickup && z.name).map((z) => String(z.name).trim());
  const t = l.join(' · ');
  return (l.length && l.length <= 3 && t.length <= 26 ? t : String(c.city || '')).toUpperCase();
}

/* Ce qui figure sur l'image : quand l'empreinte change (autre photo, autre nom de boutique…), l'image est refaite. */
export function empreinteCarte(m, c) {
  return [VERSION, m && (m.id || m.src) || '', m && m.f || '', c.name, c.tagline, villes(c)].join('|');
}

/* Bande qui prolonge un bord de la photo : le bord, réduit à quelques pixels puis étiré (couleurs fondues, sans stries). */
function bande(x, img, sx, sy, sw, sh, dx, dy, dw, dh, vertical) {
  const p = document.createElement('canvas'); p.width = vertical ? 2 : 32; p.height = vertical ? 32 : 2;
  const q = p.getContext('2d'); q.imageSmoothingQuality = 'high'; q.drawImage(img, sx, sy, sw, sh, 0, 0, p.width, p.height);
  x.drawImage(p, 0, 0, p.width, p.height, dx, dy, dw, dh);
}
/*
 * Photo entière dans son cadre, jamais rognée ; les bandes laissées libres prolongent ses bords.
 * Sur un fond de studio, la jonction ne se voit pas. Une photo à peine plus large que le cadre le remplit (bords rognés).
 */
function poserPhoto(x, img, X, Y, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const large = iw / ih > W / H;
  const k = large && iw / ih < (W / H) * 1.25 ? H / ih : Math.min(W / iw, H / ih);
  const w = Math.round(iw * k), h = Math.round(ih * k);
  const dx = X + Math.floor((W - w) / 2), dy = Y + Math.floor((H - h) / 2);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  const e = 0.04; // part de la photo prise pour chaque bord
  if (dx > X) {
    bande(x, img, 0, 0, iw * e, ih, X, dy, dx - X + 1, h, true);
    bande(x, img, iw * (1 - e), 0, iw * e, ih, dx + w - 1, dy, X + W - dx - w + 1, h, true);
  }
  if (dy > Y) {
    bande(x, img, 0, 0, iw, ih * e, dx, Y, w, dy - Y + 1, false);
    bande(x, img, 0, ih * (1 - e), iw, ih * e, dx, dy + h - 1, w, Y + H - dy - h + 1, false);
  }
  x.save(); x.beginPath(); x.rect(X, Y, W, H); x.clip(); x.drawImage(img, dx, dy, w, h); x.restore();
}
/* Le cabas (crème, point or) : X, Y = coin haut gauche, h = hauteur. */
function cabas(x, X, Y, h) {
  const k = h / 201;
  x.save(); x.translate(X - 38 * k, Y - 39 * k); x.scale(k, k); x.translate(0, 6);
  x.fillStyle = CREME; x.fill(new Path2D(CABAS_GRAND), 'evenodd');
  x.beginPath(); x.arc(204, 50, 15, 0, Math.PI * 2); x.fillStyle = OR; x.fill();
  x.restore();
}
/* Texte sur une ligne, ou deux lignes équilibrées (pas de mot seul en bas) ; « … » si même deux lignes ne suffisent pas. */
function lignes(x, texte, largeur) {
  const t = String(texte || '').trim().replace(/\s+/g, ' ');
  if (!t) return [];
  if (x.measureText(t).width <= largeur) return [t];
  const mots = t.split(' '); let meilleur = null;
  for (let i = 1; i < mots.length; i++) {
    const a = mots.slice(0, i).join(' '), b = mots.slice(i).join(' ');
    const m = Math.max(x.measureText(a).width, x.measureText(b).width);
    if (m <= largeur && (!meilleur || m < meilleur.m)) meilleur = { m, l: [a, b] };
  }
  if (meilleur) return meilleur.l;
  const out = []; let l = '';
  for (const m of mots) { const e = l ? l + ' ' + m : m; if (x.measureText(e).width <= largeur || !l) l = e; else { out.push(l); l = m; } }
  out.push(l);
  if (out.length > 2) { out.length = 2; let d = out[1]; while (d && x.measureText(d + '…').width > largeur) d = d.slice(0, -1).trimEnd(); out[1] = d + '…'; }
  return out;
}
function espacement(x, px) { if ('letterSpacing' in x) x.letterSpacing = px + 'px'; }

export async function dessinerCarte(img, c) {
  await Promise.all(['600 92px Fraunces', '600 28px "Plus Jakarta Sans"', '750 22px "Plus Jakarta Sans"'].map((f) => document.fonts.load(f))).catch(() => { });
  const cv = document.createElement('canvas'); cv.width = LARGEUR; cv.height = HAUTEUR;
  const x = cv.getContext('2d');

  // L'article : photo entière, bords prolongés jusqu'aux limites de l'image.
  x.fillStyle = '#F1ECE6'; x.fillRect(PANNEAU, 0, LARGEUR - PANNEAU, HAUTEUR);
  poserPhoto(x, img, PANNEAU, 0, LARGEUR - PANNEAU, HAUTEUR);

  // La marque : ébène, cabas, nom, slogan, villes.
  const fond = x.createLinearGradient(0, 0, PANNEAU, HAUTEUR);
  fond.addColorStop(0, '#36261C'); fond.addColorStop(1, EBENE);
  x.fillStyle = fond; x.fillRect(0, 0, PANNEAU, HAUTEUR);
  x.fillStyle = 'rgba(200, 144, 46, .6)'; x.fillRect(PANNEAU - 2, 0, 2, HAUTEUR);

  const largeur = PANNEAU - MARGE - 44;
  // Le nom : sur une ligne en grand ; trop long, il passe sur deux lignes, puis rapetisse.
  const police = (t) => { x.font = `600 ${t}px Fraunces`; espacement(x, -0.03 * t); };
  let taille = 92, nom;
  for (; ; taille -= 4) {
    police(taille);
    nom = lignes(x, c.name || 'Sokoyetu', largeur);
    const tient = nom.every((l) => x.measureText(l).width <= largeur);
    if ((tient && (nom.length === 1 || taille <= 64)) || taille <= 36) break;
  }
  espacement(x, 0);
  x.font = '600 28px "Plus Jakarta Sans"';
  const slogan = lignes(x, c.tagline, largeur);
  x.font = '750 22px "Plus Jakarta Sans"'; espacement(x, 3.5);
  let ville = villes(c);
  if (x.measureText(ville).width > largeur) ville = String(c.city || '').toUpperCase();
  espacement(x, 0);
  // Hauteurs : cabas 104, nom (capitales ≈ 0,72 du corps, interligne 1,02), slogan 38 par ligne, filet, villes.
  const hNom = taille * 0.72 + (nom.length - 1) * taille * 1.02;
  const bloc = 104 + 44 + hNom + (slogan.length ? 26 + slogan.length * 38 : 0) + (ville ? 40 + 4 + 30 + 16 : 0);
  let y = Math.round((HAUTEUR - bloc) / 2);
  cabas(x, MARGE, y, 104); y += 104 + 44;
  x.textBaseline = 'alphabetic'; x.fillStyle = CREME; police(taille);
  nom.forEach((l, i) => x.fillText(l, MARGE - 4, y + taille * 0.72 + i * taille * 1.02));
  espacement(x, 0); y += hNom;
  if (slogan.length) {
    y += 26; x.font = '600 28px "Plus Jakarta Sans"'; x.fillStyle = 'rgba(255, 248, 241, .86)';
    slogan.forEach((l, i) => x.fillText(l, MARGE, y + 28 + i * 38)); y += slogan.length * 38;
  }
  if (ville) {
    y += 40; x.fillStyle = OR; x.fillRect(MARGE, y, 56, 4); y += 4 + 30;
    x.font = '750 22px "Plus Jakarta Sans"'; espacement(x, 3.5); x.fillStyle = OR_CLAIR;
    x.fillText(ville, MARGE, y + 16); espacement(x, 0);
  }
  return cv;
}

function chargerImage(src) {
  return new Promise((ok, ko) => {
    const img = new Image();
    try { if (new URL(src, location.href).origin !== location.origin) img.crossOrigin = 'anonymous'; } catch (e) { }
    img.onload = () => ok(img); img.onerror = () => ko(new Error('Photo illisible'));
    img.src = src;
  });
}

/* Image d'aperçu en JPEG (léger : WhatsApp n'affiche pas les aperçus trop lourds). */
export async function fabriquerCarte(src, c) {
  const cv = await dessinerCarte(await chargerImage(src), c);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Image d’aperçu impossible à créer');
  return blob;
}
