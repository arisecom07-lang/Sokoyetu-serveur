// Sokoyetu (boutique) — avis des clients : articles reçus à noter, avis donnés, avis publiés d'un article.
// Seul un client qui a reçu l'article le note : commande livrée, prouvée par son compte, ce téléphone ou le lien de suivi.
import { signal, computed } from '@preact/signals';
import { requete } from '../commun/js/api.js';
import { suivis, chargerCatalogue } from './etat.js';
import { jetonAppareil } from './notifications.js';

/* Articles reçus que ce client peut noter (les plus récents d'abord), avec l'avis qu'il en a déjà donné. */
export const aNoter = signal([]);
export const aNoterCharge = signal(false);
/* Articles reçus pas encore notés (compte, page « Mes avis »). */
export const restantsANoter = computed(() => aNoter.value.filter((a) => !a.avis).length);
/* L'article reçu par ce client, s'il peut le noter (fiche article). */
export const articleANoter = (produit) => aNoter.value.find((a) => a.produit === produit) || null;

let enCours = null; let charge = 0;
/* Lu une fois, puis de nouveau après 5 minutes (ou tout de suite : force). */
export function chargerANoter({ force } = {}) {
  if (enCours) return enCours;
  if (!force && charge && Date.now() - charge < 300000) return Promise.resolve();
  enCours = requete('sokoyetu/avis/a-donner', { method: 'POST', corps: { appareil: jetonAppareil(), suivis: suivis.peek().map((s) => ({ id: s.id, t: s.t })) } })
    .then((r) => { aNoter.value = (r && r.articles) || []; charge = Date.now(); })
    .finally(() => { aNoterCharge.value = true; enCours = null; });
  return enCours;
}

/* Le client donne (ou modifie) son avis : { produit, commande, note, texte }. La commande est prouvée par son lien de suivi. */
export async function donnerAvis({ produit, commande, note, texte }) {
  const s = suivis.peek().find((x) => x.id === commande);
  const r = await requete('sokoyetu/avis/donner', { method: 'POST', corps: { appareil: jetonAppareil(), produit, commande, t: s ? s.t : '', note, texte } });
  aNoter.value = aNoter.value.map((a) => (a.produit === produit ? { ...a, avis: r.avis } : a));
  chargerCatalogue();   // la note moyenne de l'article (cartes, fiche) suit
  return r.avis;
}

/* Avis publiés d'un article (page n, une seule note si donnée) et leur résumé. */
export const avisPublies = (produit, page = 0, note = 0) => requete(`sokoyetu/avis?produit=${encodeURIComponent(produit)}&page=${page}${note ? '&note=' + note : ''}`);
