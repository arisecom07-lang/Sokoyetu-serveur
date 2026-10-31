// Sokoyetu (boutique) — notifications gratuites : centre de notifications (cloche) et notifications du téléphone (Web Push).
// Ni SMS ni WhatsApp. Le client sans compte est prévenu aussi : ses commandes portent le jeton de cet appareil.
import { signal, computed, effect } from '@preact/signals';
import { requete, DEMO } from '../commun/js/api.js';
import { Local } from '../commun/js/stockage.js';
import { secret } from '../commun/js/outils.js';
import { commandes, client } from './etat.js';
import { langue as langueChoisie } from '../commun/js/langue.js';

/* Jeton de cet appareil, tiré au sort une fois (le serveur n'en garde que l'empreinte). */
export function jetonAppareil() {
  let j = Local.lire('appareil', '');
  if (!/^[A-Za-z0-9]{32}$/.test(j || '')) { j = secret(32); Local.ecrire('appareil', j); }
  return j;
}
/* Les notifications s'écrivent dans la langue de la boutique sur ce téléphone (le serveur les rédige à la lecture). */
export const langue = () => langueChoisie.peek();

export const notifications = signal(Local.lire('notifications', []) || []);
export const nonLues = computed(() => notifications.value.filter((n) => !n.lu).length);

/* « Prévenez-moi » : articles épuisés (ou options : variante « Rouge|M ») dont ce client attend le retour. */
export const alertes = signal(Array.isArray(Local.lire('alertes', [])) ? Local.lire('alertes', []) : []);
const garderAlertes = (l) => { if (!Array.isArray(l)) return; alertes.value = l; Local.ecrire('alertes', l); };
/* Une alerte sur l'article entier vaut pour chacune de ses options. */
export const alerteActive = (produit, variante) => alertes.value.some((a) => a.produit === produit && (!a.variante || a.variante === (variante || '')));
export async function basculerAlerte(produit, variante) {
  const v = variante || '';
  const active = alertes.value.find((a) => a.produit === produit && (a.variante === v || !a.variante));
  const r = await requete(active ? 'sokoyetu/alertes/retirer' : 'sokoyetu/alertes', { method: 'POST', corps: { appareil: jetonAppareil(), produit, variante: active ? active.variante : v } });
  garderAlertes(r && r.alertes);
  return !active;
}

let deja = new Set(notifications.value.map((n) => n.id));
/* Démo : pas de service de notification, la boutique montre elle-même la notification quand elle n'est pas à l'écran. */
function montrerSurLeTelephone(nouvelles) {
  if (!DEMO || pushEtat.value !== 'actif' || !document.hidden) return;
  nouvelles.slice(0, 3).forEach((n) => { try { new Notification(n.titre, { body: n.texte, icon: 'icone-192.png', tag: n.url || String(n.id) }); } catch (e) { } });
}

let enCours = null;
export function chargerNotifications() {
  if (enCours) return enCours;
  enCours = (async () => {
    try {
      const k = langue();
      const r = await requete('sokoyetu/notifications', { method: 'POST', corps: { appareil: jetonAppareil(), langue: k } });
      if (k !== langue()) { bientot(0); return; } // langue changée pendant la lecture : la liste est relue dans la nouvelle
      const l = (r && r.notifications) || [];
      garderAlertes(r && r.alertes);
      montrerSurLeTelephone(l.filter((n) => !n.lu && !deja.has(n.id)));
      deja = new Set(l.map((n) => n.id));
      notifications.value = l;
      Local.ecrire('notifications', l.slice(0, 30));
    } catch (e) { /* hors connexion : la dernière liste reste affichée */ }
    finally { enCours = null; }
  })();
  return enCours;
}
let attente = 0;
const bientot = (ms = 1500) => { clearTimeout(attente); attente = setTimeout(chargerNotifications, ms); };

export async function marquerLues() {
  if (!nonLues.value) return;
  notifications.value = notifications.value.map((n) => ({ ...n, lu: true }));
  Local.ecrire('notifications', notifications.value.slice(0, 30));
  try { await requete('sokoyetu/notifications/lues', { method: 'POST', corps: { appareil: jetonAppareil() } }); } catch (e) { }
}

/* « Effacer mes données de ce téléphone » : notifications, alertes et jeton de l'appareil oubliés (un nouveau sera tiré). */
export function oublierNotifications() {
  ['notifications', 'alertes', 'appareil'].forEach((k) => Local.retirer(k));
  notifications.value = []; alertes.value = []; deja = new Set();
}

/* ---------- Notifications du téléphone ---------- */

const autonome = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
const estIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const possible = () => (DEMO ? 'Notification' in window : 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext);

/* 'actif', 'inactif', 'bloque' (refusées dans le navigateur), 'ios' (iPhone : installer l'application d'abord), 'indisponible'. */
function etatDepart() {
  if (!possible()) return estIOS && !autonome() ? 'ios' : 'indisponible';
  if (Notification.permission === 'denied') return 'bloque';
  return DEMO && Notification.permission === 'granted' && Local.lire('pushDemo', false) ? 'actif' : 'inactif';
}
export const pushEtat = signal(etatDepart());
export const promos = signal(!!Local.lire('pushPromos', false));

const octets = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const memeCle = (sub, cle) => {
  try { const a = new Uint8Array(sub.options.applicationServerKey); const b = octets(cle); return a.length === b.length && a.every((x, i) => x === b[i]); } catch (e) { return true; }
};
async function abonnementActuel() {
  if (DEMO || !possible()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
const enregistrer = (sub) => requete('sokoyetu/push/abonner', { method: 'POST', corps: { abonnement: sub.toJSON(), appareil: jetonAppareil(), langue: langue(), promos: promos.value } });

/* Au démarrage : l'abonnement du navigateur existe-t-il encore ? (le serveur est prévenu de tout changement). */
export async function verifierPush() {
  if (DEMO || !possible()) return;
  try {
    const sub = await abonnementActuel();
    pushEtat.value = sub && Notification.permission === 'granted' ? 'actif' : Notification.permission === 'denied' ? 'bloque' : 'inactif';
    if (sub && Notification.permission === 'granted') await enregistrer(sub);
  } catch (e) { }
}

/* Demande l'autorisation, s'abonne auprès du service de notification du navigateur et enregistre l'abonnement. */
export async function activerPush() {
  if (!possible()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { pushEtat.value = permission === 'denied' ? 'bloque' : 'inactif'; return false; }
  if (DEMO) { Local.ecrire('pushDemo', true); pushEtat.value = 'actif'; return true; }
  const reg = await navigator.serviceWorker.ready;
  const { cle } = await requete('sokoyetu/push/cle');
  let sub = await reg.pushManager.getSubscription();
  if (sub && !memeCle(sub, cle)) { await sub.unsubscribe().catch(() => { }); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets(cle) });
  await enregistrer(sub);
  pushEtat.value = 'actif';
  return true;
}
export async function desactiverPush() {
  if (DEMO) { Local.ecrire('pushDemo', false); pushEtat.value = 'inactif'; return; }
  const sub = await abonnementActuel().catch(() => null);
  if (sub) {
    const j = sub.toJSON();
    await sub.unsubscribe().catch(() => { });
    await requete('sokoyetu/push/desabonner', { method: 'POST', corps: { endpoint: j.endpoint, auth: j.keys && j.keys.auth } }).catch(() => { });
  }
  pushEtat.value = 'inactif';
}
/* Annonces de la boutique (promotions, nouveautés) : facultatives. */
export async function changerPromos(v) {
  promos.value = !!v; Local.ecrire('pushPromos', !!v);
  const sub = await abonnementActuel().catch(() => null);
  if (sub) await enregistrer(sub);
}

/* ---------- Suivi ---------- */

/* Démarrage : liste à jour, et de nouveau dès qu'une commande suivie change, qu'on se connecte ou qu'on revient sur la page. */
export function suivreNotifications() {
  chargerNotifications();
  verifierPush();
  let empreinte = '';
  effect(() => {
    const e = [...commandes.value.values()].map((o) => `${o.id}:${o.status}:${o.fulfillment}:${o.payment && o.payment.status}`).sort().join('|');
    if (empreinte && e !== empreinte) bientot();
    empreinte = e;
  });
  let compte = client.peek() ? client.peek().id : '';
  effect(() => {
    const id = client.value ? client.value.id : '';
    if (id === compte) return;
    compte = id; bientot(200);
    abonnementActuel().then((sub) => sub && enregistrer(sub)).catch(() => { });
  });
  // Autre langue : la liste est relue dans celle-ci, et le téléphone sera prévenu dans celle-ci aussi.
  let vue = langueChoisie.peek();
  effect(() => {
    const k = langueChoisie.value;
    if (k === vue) return;
    vue = k; bientot(200);
    abonnementActuel().then((sub) => sub && enregistrer(sub)).catch(() => { });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') bientot(300); });
  // Le service worker a montré une notification pendant que la boutique était ouverte : la liste suit.
  if (!DEMO && 'serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'notifications') bientot(100); });
}
