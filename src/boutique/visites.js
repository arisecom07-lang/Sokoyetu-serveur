// Sokoyetu (boutique) — fréquentation comptée par notre propre serveur : visiteurs en ligne, articles vus, mis au panier ou en favori.
// L'appareil n'est reconnu que par un identifiant tiré au sort (ni nom, ni téléphone). Rien n'est envoyé si le visiteur
// a refusé la mesure d'audience, ou si son navigateur demande de ne pas être suivi.
import { effect } from '@preact/signals';
import { requete } from '../commun/js/api.js';
import { Local } from '../commun/js/stockage.js';
import { consentement } from './mesure.js';
import { route } from './routeur.js';
import { panier, favoris } from './etat.js';

const RYTHME = 45000;

function identifiant() {
  let v = Local.lire('visiteur', '');
  if (!/^[a-z0-9]{16,40}$/.test(v || '')) {
    const o = new Uint8Array(24); crypto.getRandomValues(o);
    v = Array.from(o, (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
    Local.ecrire('visiteur', v);
  }
  return v;
}
const refuse = () => (consentement.value && consentement.value.mesure === false) || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
const articleAffiche = () => (route.value.nom === 'produit' ? route.value.params.id || '' : '');

let dernierEtat = '';
function envoyer(a, p) {
  if (refuse() || document.visibilityState === 'hidden') return;
  const corps = { v: identifiant(), p: p || articleAffiche() };
  if (a) corps.a = a;
  // Contenu du panier et des favoris : envoyé seulement quand il a changé.
  const etat = { panier: [...new Set(panier.value.map((l) => l.productId))], favoris: [...favoris.value] };
  const sig = JSON.stringify(etat);
  if (sig !== dernierEtat) Object.assign(corps, etat);
  requete('sokoyetu/visite', { method: 'POST', corps, delai: 10000 }).then(() => { if (corps.panier) dernierEtat = sig; }).catch(() => { });
}

/*
 * Une recherche faite (texte et nombre d'articles trouvés) : elle nourrit les recherches populaires proposées à tous,
 * et montre à la boutique ce que ses clients cherchent sans le trouver. Une seule fois par mot et par visite.
 */
const recherchesEnvoyees = new Set();
export function signalerRecherche(texte, n) {
  const t = String(texte || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const cle = t.toLowerCase();
  if (t.length < 2 || recherchesEnvoyees.has(cle) || refuse() || document.visibilityState === 'hidden') return;
  recherchesEnvoyees.add(cle);
  requete('sokoyetu/visite', { method: 'POST', corps: { v: identifiant(), p: '', a: 'recherche', q: t, n: Math.max(0, Math.round(n) || 0) }, delai: 10000 }).catch(() => { recherchesEnvoyees.delete(cle); });
}

export function suivreVisites() {
  if (suivreVisites.fait) return; suivreVisites.fait = true;
  // Article ouvert (y compris en arrivant directement sur sa page) ; autres pages : simple signal de présence.
  let cle = '';
  effect(() => {
    const r = route.value; if (r.cle === cle) return; cle = r.cle;
    setTimeout(() => envoyer(r.nom === 'produit' ? 'vue' : '', ''), 0);
  });
  // Un article qui entre dans le panier (ou dont la quantité augmente) ou dans les favoris.
  let avantPanier = new Map(panier.value.map((l) => [l.cle, l.qty]));
  effect(() => {
    const l = panier.value; const ajouts = l.filter((x) => x.qty > (avantPanier.get(x.cle) || 0)).map((x) => x.productId);
    avantPanier = new Map(l.map((x) => [x.cle, x.qty]));
    [...new Set(ajouts)].forEach((id) => setTimeout(() => envoyer('panier', id), 0));
  });
  let avantFavoris = new Set(favoris.value);
  effect(() => {
    const s = favoris.value; const ajouts = [...s].filter((id) => !avantFavoris.has(id));
    avantFavoris = new Set(s);
    ajouts.forEach((id) => setTimeout(() => envoyer('favori', id), 0));
  });
  setInterval(() => envoyer('', ''), RYTHME);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') envoyer('', ''); });
}
