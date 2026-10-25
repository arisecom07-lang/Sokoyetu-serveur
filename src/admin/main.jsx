// Sokoyetu — l'administration (admin.sokoyakwetu.com), application séparée de la boutique, reliée à la même base.
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { appliquerTheme } from '../commun/js/theme.js';
import { Toasts, Feuilles, Annonceur, toast } from '../commun/js/interface.jsx';
import { dollars } from '../commun/js/outils.js';
import { Local } from '../commun/js/stockage.js';
import { route, aller } from './routeur.js';
import { compte, charger, suivreEnDirect, verifierSession, quandNouvelleCommande, aTraiter, cfg, seDeconnecter, gererErreur } from './etat.js';
import { BarreLaterale, NavBasAdmin } from './composants/cadre.jsx';
import { Connexion, Tableau } from './pages/accueil.jsx';
import { Commandes, Commande } from './pages/commandes.jsx';
import { Produits, FicheProduit } from './pages/produits.jsx';
import { Rayons, Bannieres, Remises, FicheCatalogue } from './pages/catalogue.jsx';
import { Clients, Client, Plus, Compte } from './pages/clients.jsx';
import { Reglages } from './pages/reglages.jsx';

function page(segs) {
  const [a, b] = segs;
  if (!a) return Tableau;
  if (a === 'commandes') return b ? Commande : Commandes;
  if (a === 'produits') return b ? FicheProduit : Produits;
  if (a === 'clients') return b ? Client : Clients;
  if (a === 'rayons') return b ? () => <FicheCatalogue type="rayons" /> : Rayons;
  if (a === 'bannieres') return b ? () => <FicheCatalogue type="bannieres" /> : Bannieres;
  if (a === 'remises') return b ? () => <FicheCatalogue type="remises" /> : Remises;
  if (a === 'reglages') return b ? Reglages : Plus;
  if (a === 'plus') return Plus;
  if (a === 'compte') return Compte;
  return Tableau;
}

/* Petit carillon à l'arrivée d'une commande (autorisé après le premier geste sur la page). */
let audio = null;
document.addEventListener('pointerdown', () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { } }, { once: true });
function carillon() {
  if (!audio || Local.lire('sonCommandes', true) === false) return;
  const t = audio.currentTime;
  [[880, 0], [1320, 0.14]].forEach(([f, d]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
    o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.55);
  });
}
quandNouvelleCommande((o) => {
  toast(`Nouvelle commande #${o.number} · ${dollars(o.total)}`, { icone: 'cloche', duree: 6000 });
  carillon();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((r) => r.showNotification(`Nouvelle commande #${o.number}`, { body: `${o.customer && o.customer.name} · ${dollars(o.total)} · ${o.payment && o.payment.label}`, icon: 'icone-192.png', tag: 'commande-' + o.id, data: { url: '/#/commandes/' + o.id } })).catch(() => { });
  }
});

function App() {
  const connecte = !!compte.value;
  const n = aTraiter.value;
  useEffect(() => {
    document.title = `${n ? `(${n}) ` : ''}${cfg.value.name} · Gestion`;
    try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { }); } catch (e) { }
  }, [n, cfg.value.name]);
  useEffect(() => {
    if (!connecte) return;
    verifierSession();
    charger().then(suivreEnDirect).catch((e) => { if (e.status === 401 || e.status === 403) seDeconnecter(); else gererErreur(e, 'Chargement impossible. Vérifiez votre connexion.'); });
  }, [connecte]);
  if (!connecte) return <><Connexion /><Toasts /><Annonceur /></>;
  const Page = page(route.value.segs);
  return (
    <>
      <a class="lien-evitement" href="#contenu" onClick={(e) => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>Aller au contenu</a>
      <div class="admin">
        <BarreLaterale />
        <main class="admin-contenu" id="contenu" tabIndex={-1}><div class="admin-in" key={route.value.cle}><Page /></div></main>
      </div>
      <NavBasAdmin />
      <Feuilles />
      <Toasts />
      <Annonceur />
    </>
  );
}

appliquerTheme();
const racine = document.getElementById('app');
racine.textContent = '';
render(<App />, racine);
if ('serviceWorker' in navigator && !(typeof __DEMO__ !== 'undefined' && __DEMO__) && (location.protocol === 'https:' || /localhost$/.test(location.hostname))) {
  navigator.serviceWorker.register('/sw.js').catch(() => { });
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.url) aller(e.data.url.replace(/^\/#/, '')); });
}
