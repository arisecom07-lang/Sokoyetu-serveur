// Sokoyetu — l'administration (admin.sokoyakwetu.com), application séparée de la boutique, reliée à la même base.
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { appliquerTheme } from '../commun/js/theme.js';
import { Toasts, Feuilles, Annonceur, toast } from '../commun/js/interface.jsx';
import { Garde, surveillerErreurs } from '../commun/js/erreurs.jsx';
import R from '../commun/js/regles.js';
import { dollars } from '../commun/js/outils.js';
import { Local } from '../commun/js/stockage.js';
import { route, aller } from './routeur.js';
import { compte, demarrer, verifierSession, quandNouvelleCommande, quandNouveauMessage, aTraiter, aLivrer, aRepondre, cfg, role, peut } from './etat.js';
import { BarreLaterale, NavBasAdmin } from './composants/cadre.jsx';
import { Connexion, Tableau } from './pages/accueil.jsx';
import { Commandes, Commande } from './pages/commandes.jsx';
import { Historique } from './pages/historique.jsx';
import { Produits, FicheProduit } from './pages/produits.jsx';
import { ImportProduits } from './pages/importer.jsx';
import { Rayons, Bannieres, Remises, FicheCatalogue } from './pages/catalogue.jsx';
import { Clients, Client, Plus, Compte } from './pages/clients.jsx';
import { Reglages } from './pages/reglages.jsx';
import { Audience, AudienceArticle } from './pages/audience.jsx';
import { Journal } from './pages/journal.jsx';
import { Equipe, AccesReserve } from './pages/equipe.jsx';
import { Livraisons } from './pages/livraisons.jsx';
import { Annonces } from './pages/annonces.jsx';
import { Messages } from './pages/messages.jsx';

/* Droit nécessaire pour chaque page (regles.DROITS) : sans lui, « accès réservé » (le serveur refuse de toute façon). */
const DROIT_PAGE = { commandes: 'commandes', historique: 'commandes', produits: 'produits', clients: 'clients', audience: 'audience', rayons: 'catalogue', bannieres: 'catalogue', remises: 'remises', reglages: 'reglages', journal: 'journal', equipe: 'equipe', annonces: 'annonces', messages: 'messages' };
function page(segs) {
  const [a, b] = segs;
  if (a === 'plus' || (a === 'reglages' && !b)) return role.value === 'livreur' ? Compte : Plus;
  if (DROIT_PAGE[a] && !peut(DROIT_PAGE[a])) return AccesReserve;
  if (!a) return role.value === 'livreur' ? Livraisons : Tableau;
  if (a === 'livraisons') return peut('livraisons') || peut('commandes') ? Livraisons : AccesReserve;
  if (a === 'equipe') return Equipe;
  if (a === 'commandes') return b ? Commande : Commandes;
  if (a === 'historique') return Historique;
  if (a === 'produits') return b === 'importer' ? ImportProduits : b ? FicheProduit : Produits;
  if (a === 'clients') return b ? Client : Clients;
  if (a === 'audience') return b ? AudienceArticle : Audience;
  if (a === 'rayons') return b ? () => <FicheCatalogue type="rayons" /> : Rayons;
  if (a === 'bannieres') return b ? () => <FicheCatalogue type="bannieres" /> : Bannieres;
  if (a === 'remises') return b ? () => <FicheCatalogue type="remises" /> : Remises;
  if (a === 'reglages') return Reglages;
  if (a === 'compte') return Compte;
  if (a === 'journal') return Journal;
  if (a === 'annonces') return Annonces;
  if (a === 'messages') return Messages;
  return role.value === 'livreur' ? Livraisons : Tableau;
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
  if (role.value === 'livreur') return; // le livreur voit ses livraisons arriver dans sa liste
  toast(`Commande payée #${o.number} · ${dollars(o.total)}`, { icone: 'cloche', duree: 6000 });
  carillon();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((r) => r.showNotification(`Commande payée #${o.number}`, { body: `${o.customer && o.customer.name} · ${dollars(o.total)} · ${o.payment && o.payment.label}`, icon: 'icone-192.png', tag: 'commande-' + o.id, data: { url: '/#/commandes/' + o.id } })).catch(() => { });
  }
});

// Un client écrit : l'équipe est prévenue, sauf si elle a déjà cette discussion sous les yeux (l'alerte part quand elle l'ouvre).
let alerteMessage = null;
quandNouveauMessage((d) => {
  const ouverte = route.value.segs[0] === 'messages' && route.value.segs[1] === d.id && !document.hidden;
  if (ouverte) return;
  alerteMessage = { id: d.id, retirer: toast(`${d.nom || 'Un client'} : « ${R.apercuMessage(d.dernier, 70)} »`, { icone: 'bulle', duree: 6000 }) };
  carillon();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((r) => r.showNotification(`Message de ${d.nom || 'un client'}`, { body: d.dernier, icon: 'icone-192.png', tag: 'discussion-' + d.id, data: { url: '/#/messages/' + d.id } })).catch(() => { });
  }
});
route.subscribe((r) => { if (alerteMessage && r.segs[0] === 'messages' && r.segs[1] === alerteMessage.id) { alerteMessage.retirer(); alerteMessage = null; } });

function App() {
  const connecte = !!compte.value;
  const n = (role.value === 'livreur' ? aLivrer.value : aTraiter.value) + aRepondre.value;
  useEffect(() => {
    document.title = `${n ? `(${n}) ` : ''}${cfg.value.name} · Gestion`;
    try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { }); } catch (e) { }
  }, [n, cfg.value.name]);
  useEffect(() => {
    if (!connecte) return;
    verifierSession();
    demarrer();
  }, [connecte]);
  if (!connecte) return <><Connexion /><Toasts /><Annonceur /></>;
  const Page = page(route.value.segs);
  return (
    <>
      <a class="lien-evitement" href="#contenu" onClick={(e) => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>Aller au contenu</a>
      <div class="admin">
        <BarreLaterale />
        <main class="admin-contenu" id="contenu" tabIndex={-1}><div class="admin-in" key={route.value.cle}><Garde accueil="#/"><Page /></Garde></div></main>
      </div>
      <NavBasAdmin />
      <Feuilles />
      <Toasts />
      <Annonceur />
    </>
  );
}

appliquerTheme();
surveillerErreurs();
const racine = document.getElementById('app');
racine.textContent = '';
render(<App />, racine);
if ('serviceWorker' in navigator && !(typeof __DEMO__ !== 'undefined' && __DEMO__) && (location.protocol === 'https:' || /localhost$/.test(location.hostname))) {
  navigator.serviceWorker.register('/sw.js').catch(() => { });
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.url) aller(e.data.url.replace(/^\/#/, '')); });
}
