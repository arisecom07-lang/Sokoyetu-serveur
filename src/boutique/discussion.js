// Sokoyetu (boutique) — discussion avec la boutique : le service client dans l'application, gratuit (ni SMS ni WhatsApp).
// Le client écrit depuis son compte, sinon depuis ce téléphone ; la réponse arrive ici, et en notification gratuite.
import { signal, computed } from '@preact/signals';
import { requete } from '../commun/js/api.js';
import { Local } from '../commun/js/stockage.js';
import { client, suivis } from './etat.js';
import { jetonAppareil, notifications } from './notifications.js';

/* À qui appartient la discussion gardée sur ce téléphone : le compte connecté, sinon l'appareil (''). */
const proprietaire = () => (client.peek() ? client.peek().id : '');
const enCache = Local.lire('discussion', null);
const cacheValide = !!enCache && enCache.qui === proprietaire() && Array.isArray(enCache.messages);

/* Messages, du plus ancien au plus récent (les derniers sont gardés sur le téléphone : affichés tout de suite, même hors connexion). */
export const fil = signal(cacheValide ? enCache.messages : []);
/* Moment où l'équipe a lu la discussion (« Vu » sous le dernier message du client). */
export const luParBoutique = signal(cacheValide ? Number(enCache.lu) || 0 : 0);
export const filCharge = signal(false);
/* Réponses de la boutique pas encore lues : compte, pied de page. */
export const messagesNonLus = computed(() => notifications.value.filter((n) => n.type === 'message' && !n.lu).length);

let qui = proprietaire(); let discussion = cacheValide ? enCache.id || '' : '';
function garder(messages, lu, id) {
  fil.value = messages; luParBoutique.value = lu; discussion = id;
  Local.ecrire('discussion', { qui, id, lu, messages: messages.slice(-80) });
}

/*
 * Réponse du serveur : les nouveaux messages s'ajoutent (complet : la liste est remplacée). Renvoie false quand il faut
 * tout relire (la discussion a changé : celle de l'appareil a rejoint le compte).
 */
function appliquer(r, complet) {
  const d = r && r.discussion; const l = (r && r.messages) || [];
  if (!d) { garder([], 0, ''); return true; }
  if (complet) { garder(l, d.luBoutique, d.id); return true; }
  if (d.id !== discussion) return false;
  const ids = new Set(fil.value.map((m) => m.id));
  garder([...fil.value, ...l.filter((m) => !ids.has(m.id))], d.luBoutique, d.id);
  return true;
}
const lire = (apres) => requete('sokoyetu/discussion', { method: 'POST', corps: { appareil: jetonAppareil(), apres } });

let enCours = null;
/* Lecture de la discussion (et des réponses de la boutique) : tout au premier appel, puis seulement les nouveaux messages. */
export function chargerFil({ complet } = {}) {
  if (enCours) return enCours;
  enCours = (async () => {
    try {
      const moi = proprietaire();
      const change = moi !== qui; qui = moi;
      const dernier = !complet && !change && fil.value.length ? fil.value[fil.value.length - 1].id : 0;
      if (!appliquer(await lire(dernier), !dernier)) appliquer(await lire(0), true);
      // Lire la discussion vaut lecture des notifications de réponse.
      if (notifications.value.some((n) => n.type === 'message' && !n.lu)) notifications.value = notifications.value.map((n) => (n.type === 'message' ? { ...n, lu: true } : n));
    } finally { filCharge.value = true; enCours = null; }
  })();
  return enCours;
}

/* Le client écrit : { texte, produit, commande, nom }. La commande jointe est prouvée par son jeton de suivi. */
export async function envoyerMessage({ texte, produit, commande, nom }) {
  const t = commande ? (suivis.value.find((s) => s.id === commande) || {}).t || '' : '';
  if (proprietaire() !== qui) { qui = proprietaire(); garder([], 0, ''); }
  const dernier = fil.value.length ? fil.value[fil.value.length - 1].id : 0;
  const r = await requete('sokoyetu/discussion/envoyer', { method: 'POST', corps: { appareil: jetonAppareil(), texte, produit, commande, t, nom, apres: dernier } });
  if (!appliquer(r, !dernier)) appliquer(await lire(0), true);
}

/* « Effacer mes données de ce téléphone » : la copie de la discussion est oubliée (elle reste chez la boutique). */
export function oublierDiscussion() { Local.retirer('discussion'); fil.value = []; luParBoutique.value = 0; discussion = ''; qui = proprietaire(); }
