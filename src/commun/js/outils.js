// Sokoyetu — petits outils communs (formats, dates, téléphone, presse-papiers).
import R from './regles.js';

export const { num, int, arrondi, chiffres, pluriel, slug, copie } = R;

export const JOUR = 864e5;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* Secret aléatoire (jeton de suivi de commande) : 32 caractères sans ambiguïté. */
export function secret(n = 32) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return Array.from(b, (x) => A[x % A.length]).join('');
}

export const groupe = (i) => String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/* « $24.90 » — le dollar est la monnaie de référence de la boutique. */
export function dollars(v) {
  const x = arrondi(v); const neg = x < 0;
  const [e, d] = Math.abs(x).toFixed(2).split('.');
  return (neg ? '−' : '') + '$' + groupe(e) + '.' + d;
}
export function dollarsCourt(v) {
  v = num(v);
  if (v >= 10000) return '$' + (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace('.0', '') + 'k';
  return '$' + (Math.round(v) === v ? groupe(v) : v.toFixed(2));
}
/* Équivalent indicatif en francs congolais, arrondi à 50 FC. */
export function francs(v, cfg) {
  if (!cfg || !cfg.showCDF || !num(cfg.fxRate)) return '';
  return '≈ ' + groupe(Math.round(num(v) * num(cfg.fxRate) / 50) * 50) + ' FC';
}

export const debutJour = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const date = (t, o = { day: 'numeric', month: 'short' }) => new Date(t).toLocaleDateString('fr-FR', o);
export const dateHeure = (t) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function ilya(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`;
  return date(t);
}

/* 0991234567 → « 099 123 4567 » ; +243991234567 → « +243 99 123 4567 » */
export function telephone(p) {
  const d = chiffres(p); if (!d) return '';
  if (d.length === 12 && d.startsWith('243')) return `+243 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  if (d.length === 10 && d.startsWith('0')) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return (String(p).trim().startsWith('+') ? '+' : '') + d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}
export function lienWhatsApp(tel, texte) {
  let d = chiffres(tel); if (!d) return '';
  if (d.startsWith('0') && d.length === 10) d = '243' + d.slice(1);
  return `https://wa.me/${d}${texte ? '?text=' + encodeURIComponent(texte) : ''}`;
}
export const lienAppel = (tel) => (chiffres(tel) ? 'tel:' + (String(tel).trim().startsWith('+') ? '+' : '') + chiffres(tel) : '');

export async function copier(texte) {
  try { await navigator.clipboard.writeText(texte); return true; }
  catch (e) {
    try {
      const t = Object.assign(document.createElement('textarea'), { value: texte }); t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e2) { return false; }
  }
}

/* Recherche tolérante : sans accents, sans casse. */
export const normaliser = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function differer(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
export const classes = (...l) => l.filter(Boolean).join(' ');
