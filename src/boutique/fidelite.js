// Sokoyetu (boutique) — cagnotte de fidélité et parrainage (serveur : lib/fidelite.js).
// La cagnotte s'utilise connecté à son compte ; un lien de parrainage ouvert reste gardé 30 jours sur ce téléphone.
import { signal, computed } from '@preact/signals';
import R from '../commun/js/regles.js';
import { requete } from '../commun/js/api.js';
import { Local } from '../commun/js/stockage.js';
import { cfg, client, comptesOuverts } from './etat.js';
import { route, naviguer } from './routeur.js';

/* Ouverte par la boutique, et utilisable : les comptes clients sont ouverts (connexion par code). */
export const cagnotteOuverte = computed(() => !!(cfg.value.loyalty && cfg.value.loyalty.enabled) && comptesOuverts.value);
export const parrainageOuvert = computed(() => cagnotteOuverte.value && !!(cfg.value.referral && cfg.value.referral.enabled));

/* Cagnotte du client connecté : { solde, aVenir, premiere, mouvements, parrainage } ; null tant qu'elle n'est pas lue. */
export const cagnotte = signal(null);
let pour = '';
export async function chargerCagnotte() {
  const c = client.peek();
  if (!c || !cagnotteOuverte.peek()) { cagnotte.value = null; pour = ''; return null; }
  if (pour !== c.id) cagnotte.value = null;
  pour = c.id;
  const r = await requete('sokoyetu/cagnotte');
  if (client.peek() && client.peek().id === c.id) cagnotte.value = r;
  return r;
}

/* Lien de parrainage ouvert sur ce téléphone : { code, prenom, montant, min, le } (cadeau de la première commande). */
const garde = Local.lire('parrain', null);
export const parrain = signal(garde && R.codeParrainValide(garde.code) && Date.now() - (garde.le || 0) < R.PARRAIN_JOURS * R.JOUR ? garde : null);
export function oublierParrain() { parrain.value = null; Local.retirer('parrain'); }
/* Lien ouvert ou code saisi (p : réponse du serveur, route « parrainage ») : le cadeau est gardé sur ce téléphone. */
export function garderParrain(p) {
  parrain.value = { code: p.code, prenom: p.prenom, montant: p.bienvenue, min: p.min, le: Date.now() };
  Local.ecrire('parrain', parrain.value);
  return parrain.value;
}

/* Arrivée avec un lien de parrainage (…?parrain=K7M2QX) : le cadeau est gardé, puis annoncé une fois (annoncer). */
export async function lireLienParrainage(annoncer) {
  const r = route.peek();
  if (!r.query.has('parrain')) return;
  const code = R.codeParrainValide(r.query.get('parrain'));
  const q = new URLSearchParams(r.query); q.delete('parrain');
  naviguer(r.chemin + (q.toString() ? '?' + q : ''), { remplacer: true, garderDefilement: true });
  if (!code || !parrainageOuvert.peek() || (parrain.peek() && parrain.peek().code === code)) return;
  try {
    const p = await requete('sokoyetu/parrainage?code=' + encodeURIComponent(code));
    if (!p || !p.ok) return;
    garderParrain(p);
    if (annoncer) annoncer(parrain.value);
  } catch (e) { /* hors connexion : le lien pourra être rouvert */ }
}

/* Cadeau de bienvenue de la commande en cours, estimé sur ce téléphone (le serveur le confirme avant le paiement). */
export function parrainageEstime() {
  const p = parrain.value; const c = cagnotte.value;
  if (!p || !parrainageOuvert.value || !client.value || !c || !c.premiere) return null;
  if (c.parrainage && c.parrainage.code === p.code) return null;
  return { code: p.code, montant: p.montant, min: p.min };
}

/* Lien à partager par le parrain : la boutique, avec son code. */
export const lienParrainage = (code) => new URL((typeof __DEMO__ !== 'undefined' && __DEMO__ ? '#/' : '/') + '?parrain=' + code, location.href).href;
