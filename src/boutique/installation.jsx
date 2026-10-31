// Sokoyetu (boutique) — application installable (PWA) : installation, fonctionnement hors connexion, mises à jour.
import { signal, computed } from '@preact/signals';
import { Icone } from '../commun/js/icones.jsx';
import { toast } from '../commun/js/interface.jsx';
import { Local } from '../commun/js/stockage.js';
import { JOUR } from '../commun/js/outils.js';
import { cfg } from './etat.js';

const DEMO = typeof __DEMO__ !== 'undefined' && __DEMO__;
export const estIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const autonome = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };

const invite = signal(null);
const masque = signal(Local.lire('installMasque', 0) > Date.now());
export const installable = computed(() => !DEMO && !autonome() && (!!invite.value || estIOS));
export const miseAJour = signal(null);

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite.value = e; });
window.addEventListener('appinstalled', () => { invite.value = null; toast('Application installée', { icone: 'mobile' }); });

export async function installer() {
  const e = invite.value; if (!e) return;
  invite.value = null;
  try { e.prompt(); await e.userChoice; } catch (err) { }
}

export function CarteInstallation() {
  if (!installable.value || masque.value || estIOS) return null;
  const c = cfg.value;
  return (
    <section class="conteneur section">
      <div class="carte-installation">
        <img src={(DEMO ? '' : '/') + 'icone-192.png'} alt="" width="52" height="52" />
        <div><b>Installez l’application {c.name}</b><p>Un geste depuis l’écran d’accueil, rapide même avec une connexion faible.</p></div>
        <div class="rangee">
          <button class="btn btn-primaire btn-s" onClick={installer}>Installer</button>
          <button class="btn-icone" aria-label="Plus tard" onClick={() => { Local.ecrire('installMasque', Date.now() + 21 * JOUR); masque.value = true; }}><Icone n="fermer" /></button>
        </div>
      </div>
    </section>
  );
}

export function enregistrerServiceWorker() {
  if (DEMO || !('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const suivre = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) miseAJour.value = w; });
    if (reg.waiting && navigator.serviceWorker.controller) miseAJour.value = reg.waiting;
    reg.addEventListener('updatefound', () => suivre(reg.installing));
    setInterval(() => reg.update().catch(() => { }), 60 * 60 * 1000);
  }).catch(() => { });
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (recharge) return; if (window.__majDemandee) { recharge = true; location.reload(); } });
}

export function BarreMiseAJour() {
  if (!miseAJour.value) return null;
  return (
    <div class="barre-maj" role="status">
      <Icone n="actualiser" /><span>Nouvelle version disponible</span>
      <button class="btn btn-s btn-doux" onClick={() => { window.__majDemandee = true; try { miseAJour.value.postMessage('skipWaiting'); } catch (e) { location.reload(); } }}>Mettre à jour</button>
    </div>
  );
}
