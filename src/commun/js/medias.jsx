// Sokoyetu — photos : adresses, tailles adaptées à l'écran, chargement progressif, compression avant envoi.
import { useRef, useState } from 'preact/hooks';
import { urlFichierServeur } from './api.js';
import { Icone } from './icones.jsx';
import { t } from './langue.js';

/* Photos d'exemple livrées avec le site (dossier photos/ de la boutique) : adresses absolues sur le site, relatives dans la démo. */
const BASE = typeof __DEMO__ !== 'undefined' && __DEMO__ ? (typeof __APP__ !== 'undefined' && __APP__ === 'admin' ? '../boutique/' : '') : '/';
const local = (src) => (/^(https?:|data:|blob:|\/)/.test(src) ? src : BASE + src);

export function urlMedia(m, largeur) {
  if (!m) return '';
  if (m.type === 'pb') return urlFichierServeur(m, largeur ? `${largeur}x0` : '');
  if (m.type === 'url' && m.src) {
    if (largeur && largeur <= 400 && m.srcset) { const petit = String(m.srcset).split(',')[0].trim().split(' ')[0]; if (petit) return local(petit); }
    return local(m.src);
  }
  if (m.type === 'blob' && m.src) return m.src;
  return '';
}
export function srcsetMedia(m) {
  if (!m) return '';
  if (m.type === 'pb') return [400, 800, 1200].map((w) => `${urlFichierServeur(m, w + 'x0')} ${w}w`).join(', ');
  if (m.type === 'url' && m.srcset) return String(m.srcset).split(',').map((p) => { const [u, w] = p.trim().split(/\s+/); return `${local(u)} ${w || ''}`.trim(); }).join(', ');
  return '';
}

/* <Photo m={media} alt="…" tailles="50vw" /> */
export function Photo({ m, alt = '', classe = '', tailles = '(min-width: 1100px) 280px, (min-width: 720px) 30vw, 50vw', prioritaire = false, style }) {
  const [erreur, setErreur] = useState(false);
  const [charge, setCharge] = useState(false);
  const ref = useRef(null);
  const src = urlMedia(m, prioritaire ? 800 : 400);
  if (!m || !src || erreur) return <div class={'media-vide ' + classe} role={alt ? 'img' : undefined} aria-label={alt || undefined} style={style}><Icone n="image" /></div>;
  const srcset = srcsetMedia(m);
  return (
    <img ref={(el) => { ref.current = el; if (el && el.complete && el.naturalWidth && !charge) setCharge(true); }}
      class={'media ' + classe + (charge || prioritaire ? '' : ' charge-en-cours')} src={src} srcset={srcset || undefined} sizes={srcset ? tailles : undefined}
      width={m.w || undefined} height={m.h || undefined} alt={m.alt || alt} loading={prioritaire ? 'eager' : 'lazy'} decoding="async"
      fetchpriority={prioritaire ? 'high' : undefined} onLoad={() => setCharge(true)} onError={() => setErreur(true)} style={style} />
  );
}

/* Redimensionne et compresse une photo avant envoi (WebP si possible, sinon JPEG). */
export async function compresser(fichier, max = 1600, qualite = 0.82) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', qualite));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', Math.min(0.9, qualite + 0.04)));
    return { blob, w, h, avant: fichier.size, apres: blob.size };
  } finally { URL.revokeObjectURL(url); }
}

export const taille = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');
