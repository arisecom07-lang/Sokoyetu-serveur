// Sokoyetu — langues de la boutique : français (langue du code, du serveur et de l'administration), anglais, swahili, lingala.
// Le texte français sert de clé : t('Ajouter au panier'). Sans traduction, le français s'affiche.
// Les traductions (src/boutique/langues/en.js, sw.js, ln.js) deviennent un fichier par langue au moment de la construction ;
// la boutique ne charge que celui de la langue choisie. L'administration reste en français : ces fonctions y rendent le texte tel quel.
import { signal, batch } from '@preact/signals';
import { Local } from './stockage.js';

/* Chaque langue se présente dans sa propre langue. */
export const LANGUES = [
  { k: 'fr', nom: 'Français', phrase: 'La boutique en français', locale: 'fr-FR' },
  { k: 'en', nom: 'English', phrase: 'The shop in English', locale: 'en-GB' },
  { k: 'sw', nom: 'Kiswahili', phrase: 'Duka kwa Kiswahili', locale: 'sw' },
  { k: 'ln', nom: 'Lingála', phrase: 'Butiki na Lingála', locale: 'ln' }
];
export const langue = signal('fr');
const dico = signal({});
const ADRESSES = typeof __LANGUES__ !== 'undefined' ? __LANGUES__ : {}; // { en: '/assets/langue-en.….json', … }

/* « Payer {0} » + [« $5.00 »] → « Payer $5.00 » ; vars : tableau ({0}, {1}…) ou objet ({n}, {nom}…). */
function remplir(s, vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}
const traduction = (fr) => { const x = dico.value[fr]; return typeof x === 'string' ? x : fr; };

/* Un texte de la boutique dans la langue choisie. */
export function t(fr, vars) { return remplir(traduction(fr), vars); }

/* Même chose dans du JSX, quand un trou reçoit un élément (« Vous payez {0} par carte » avec {0} = <b>$5.00</b>). */
export function tx(fr, vars) {
  const morceaux = traduction(fr).split(/\{(\w+)\}/);
  return morceaux.map((m, i) => (i % 2 ? (vars && vars[m] !== undefined && vars[m] !== null ? vars[m] : '{' + m + '}') : m)).filter((m) => m !== '');
}

/* Singulier ou pluriel : tn(n, '{n} article', '{n} articles'). En français, pluriel au-delà de 1 ; ailleurs, singulier pour 1 seulement. */
export function tn(n, un, plusieurs, vars) {
  const v = Object.assign({ n }, vars);
  const x = dico.value[un];
  if (Array.isArray(x)) return remplir(Number(n) === 1 ? x[0] : x[1], v);
  if (typeof x === 'string') return remplir(x, v); // langue sans pluriel pour ce mot (swahili : « bidhaa {n} »)
  return remplir(Number(n) > 1 ? plusieurs : un, v);
}
/* « 3 articles » : même règle que regles.pluriel, traduite (clé « {n} article »). */
export const pluriel = (n, mot, motPluriel) => tn(n, '{n} ' + mot, '{n} ' + (motPluriel || mot + 's'));

/* Marque un texte gardé tel quel dans une constante, puis traduit là où il s'affiche avec t(). */
export const aTraduire = (fr) => fr;

/*
 * Message reçu du serveur (toujours en français) : traduit s'il est connu, y compris avec des parties variables ;
 * plusieurs phrases à la suite (« « Robe » est épuisé. Choisissez une taille… ») se traduisent une à une.
 */
let motifs = null;
export function traduireMessage(m) {
  if (!m || langue.peek() === 'fr') return m;
  const x = traduirePhrase(m);
  if (x !== null) return x;
  const phrases = String(m).replace(/([.!?])\s+(?=[«A-ZÀ-Ý])/g, '$1\n').split('\n');
  return phrases.length > 1 ? phrases.map((p) => { const y = traduirePhrase(p); return y === null ? p : y; }).join(' ') : m;
}
function traduirePhrase(m) {
  const d = dico.peek();
  if (typeof d[m] === 'string') return d[m];
  if (!motifs) {
    // Le plus précis d'abord (« Numéro {0} invalide : 10 chiffres… » avant « {0} : {1}. ») ; les textes presque sans mots
    // fixes (« {0} min », « {0} sur {1} ») ne servent pas à reconnaître un message.
    motifs = Object.keys(d).filter((k) => /\{\w+\}/.test(k) && typeof d[k] === 'string').map((k) => {
      const noms = [];
      const morceaux = k.split(/\{(\w+)\}/);
      const re = morceaux.map((p, i) => (i % 2 ? (noms.push(p), '(.*?)') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
      const lettres = morceaux.filter((p, i) => !(i % 2)).join('').replace(/[^a-zà-ÿ]/gi, '').length;
      return [new RegExp('^' + re + '$'), noms, d[k], lettres];
    }).filter((x) => x[3] >= 8).sort((a, b) => b[3] - a[3]);
  }
  for (const [re, noms, tr] of motifs) {
    const x = re.exec(m);
    if (x) { const v = {}; noms.forEach((nom, i) => { v[nom] = x[i + 1]; }); return remplir(tr, v); }
  }
  return null;
}

/* Langue des dates et des nombres (Intl) ; le lingala garde les dates en français si le téléphone ne le connaît pas. */
export function locale() {
  const l = LANGUES.find((x) => x.k === langue.value) || LANGUES[0];
  try { if (Intl.DateTimeFormat.supportedLocalesOf([l.locale]).length) return l.locale; } catch (e) { }
  return 'fr-FR';
}

export const langueConnue = (k) => LANGUES.some((l) => l.k === k);
/* Proposée une fois aux téléphones réglés dans une autre langue, et donc écrite dans celle-ci : [question, oui, non]. */
export const PROPOSITIONS = {
  en: ['This shop is also available in English.', 'Switch to English', 'Keep French'],
  sw: ['Duka hili linapatikana pia kwa Kiswahili.', 'Tumia Kiswahili', 'Endelea kwa Kifaransa'],
  ln: ['Butiki oyo ezali mpe na Lingála.', 'Pona Lingála', 'Tikala na Lifalansé']
};
/* Langue préférée du téléphone, si la boutique la parle (proposée une fois, jamais imposée). */
export function langueDuTelephone() {
  const l = String((navigator.languages && navigator.languages[0]) || navigator.language || '').slice(0, 2).toLowerCase();
  return langueConnue(l) ? l : 'fr';
}

/* Charge et applique une langue ; garder : la retenir sur ce téléphone. Renvoie false si elle n'a pas pu se charger. */
export async function choisirLangue(k, { garder = true } = {}) {
  if (!langueConnue(k)) k = 'fr';
  let d = {};
  if (k !== 'fr') {
    if (!ADRESSES[k]) return false;
    try { const r = await fetch(ADRESSES[k]); if (!r.ok) return false; d = await r.json(); } catch (e) { return false; }
  }
  motifs = null;
  batch(() => { dico.value = d; langue.value = k; });
  if (garder) Local.ecrire('langue', k);
  if (typeof document !== 'undefined') document.documentElement.lang = k;
  return true;
}
/* Au démarrage : la langue retenue sur ce téléphone ('' : jamais choisie). */
export const langueRetenue = () => { const k = Local.lire('langue', ''); return langueConnue(k) ? k : ''; };
/* « Garder le français » : retenu, la proposition ne revient plus. */
export const retenirLangue = (k) => Local.ecrire('langue', langueConnue(k) ? k : 'fr');
