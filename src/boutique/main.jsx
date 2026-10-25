// Sokoyetu — la boutique (sokoyakwetu.com). Aucune fonction d'administration ici : l'administration est une application séparée.
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { appliquerTheme } from '../commun/js/theme.js';
import { Icone } from '../commun/js/icones.jsx';
import { Toasts, Feuilles, Annonceur } from '../commun/js/interface.jsx';
import { route, sens, convertirAncienLien, lien } from './routeur.js';
import { chargerCatalogue, suivreCatalogue, actualiserMesCommandes, suivreCommande, synchroniserCompte, cfg, horsLigne } from './etat.js';
import { NavBas } from './composants/cadre.jsx';
import { BarreMiseAJour, enregistrerServiceWorker } from './installation.jsx';
import { consentement, consentir, mesureConfiguree, chargerMesure } from './mesure.js';
import { suivreVisites } from './visites.js';
import { Accueil } from './pages/accueil.jsx';
import { Rayons, Rayon, Nouveautes, Recherche, Favoris } from './pages/catalogue.jsx';
import { Produit } from './pages/produit.jsx';
import { Panier } from './pages/panier.jsx';
import { Commander } from './pages/commander.jsx';
import { Paiement } from './pages/paiement.jsx';
import { Merci, Compte, Commandes, Suivi, Retrouver } from './pages/compte.jsx';
import { Connexion } from './pages/connexion.jsx';
import { Infos } from './pages/infos.jsx';
import { Introuvable } from './pages/introuvable.jsx';

const PAGES = { accueil: Accueil, rayons: Rayons, rayon: Rayon, nouveautes: Nouveautes, recherche: Recherche, favoris: Favoris, produit: Produit, panier: Panier, commander: Commander, paiement: Paiement, merci: Merci, compte: Compte, commandes: Commandes, retrouver: Retrouver, connexion: Connexion, suivi: Suivi, infos: Infos };
/* Ce qui occupe le bas de l'écran du téléphone : navigation, barre d'action, ou les deux. */
const BAS = { produit: 'barre', commander: 'barre', panier: 'nav-barre', paiement: '', merci: '', recherche: '' };

function Consentement() {
  const c = cfg.value;
  if (consentement.value || !mesureConfiguree(c)) return null;
  return (
    <div class="consentement" role="region" aria-label="Mesure d’audience">
      <p>Acceptez-vous une mesure d’audience anonyme pour nous aider à améliorer la boutique ? <a class="lien" href={lien('/infos/cookies')}>En savoir plus</a></p>
      <div class="rangee"><button class="btn btn-secondaire btn-s" onClick={() => consentir(false)}>Refuser</button><button class="btn btn-primaire btn-s" onClick={() => { consentir(true); chargerMesure(c); }}>Accepter</button></div>
    </div>
  );
}

function App() {
  const r = route.value;
  const Page = PAGES[r.nom] || Introuvable;
  const bas = r.nom in BAS ? BAS[r.nom] : 'nav';
  useEffect(() => { document.body.dataset.bas = bas; }, [bas]);
  useEffect(() => { chargerMesure(cfg.value); }, [cfg.value.analytics && cfg.value.analytics.id, consentement.value]);
  return (
    <>
      <a class="lien-evitement" href="#contenu" onClick={(e) => { e.preventDefault(); const m = document.getElementById('contenu'); if (m) { m.setAttribute('tabindex', '-1'); m.focus(); } }}>Aller au contenu</a>
      {horsLigne.value ? <div class="bandeau-hors-ligne" role="status"><Icone n="info" />Hors connexion : vous voyez la dernière version enregistrée.</div> : null}
      <div class={'appli' + (sens.value ? ' sens-' + sens.value : '')} key={r.cle}><Page /></div>
      {bas.includes('nav') ? <NavBas /> : null}
      <Consentement />
      <BarreMiseAJour />
      <Feuilles />
      <Toasts />
      <Annonceur />
    </>
  );
}

appliquerTheme();
if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('vt');
const suivi = convertirAncienLien();
if (suivi) suivreCommande(suivi.id, suivi.t);
const racine = document.getElementById('app');
racine.textContent = '';
render(<App />, racine);
chargerCatalogue().then(() => { suivreCatalogue(); actualiserMesCommandes(); suivreVisites(); synchroniserCompte(); });
enregistrerServiceWorker();
