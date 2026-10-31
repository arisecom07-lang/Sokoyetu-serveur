// Sokoyetu — la boutique (sokoyakwetu.com). Aucune fonction d'administration ici : l'administration est une application séparée.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { appliquerTheme } from '../commun/js/theme.js';
import { Icone } from '../commun/js/icones.jsx';
import { Toasts, Feuilles, Annonceur } from '../commun/js/interface.jsx';
import { Garde, surveillerErreurs } from '../commun/js/erreurs.jsx';
import { route, sens, convertirAncienLien, lien } from './routeur.js';
import { chargerCatalogue, suivreCatalogue, actualiserMesCommandes, suivreCommande, synchroniserCompte, cfg, horsLigne } from './etat.js';
import { NavBas, changerLangue } from './composants/cadre.jsx';
import { BarreMiseAJour, enregistrerServiceWorker } from './installation.jsx';
import { consentement, consentir, mesureConfiguree, chargerMesure } from './mesure.js';
import { suivreVisites } from './visites.js';
import { suivreNotifications } from './notifications.js';
import './animations.js';
import { Accueil } from './pages/accueil.jsx';
import { Rayons, Rayon, Nouveautes, Provenance, Recherche, Favoris } from './pages/catalogue.jsx';
import { Produit } from './pages/produit.jsx';
import { Panier, PanierPartage } from './pages/panier.jsx';
import { Commander } from './pages/commander.jsx';
import { Paiement, CarteTest } from './pages/paiement.jsx';
import { Merci, Compte, Commandes, Suivi, Retrouver } from './pages/compte.jsx';
import { Connexion } from './pages/connexion.jsx';
import { Infos } from './pages/infos.jsx';
import { Introuvable } from './pages/introuvable.jsx';
import { Notifications } from './pages/notifications.jsx';
import { Discussion } from './pages/discussion.jsx';
import { MesAvis } from './pages/avis.jsx';
import { MaCagnotte, ouvrirCadeauBienvenue } from './pages/cagnotte.jsx';
import { lireLienParrainage } from './fidelite.js';
import { t, tx, langue, langueRetenue, langueDuTelephone, choisirLangue, retenirLangue, PROPOSITIONS } from '../commun/js/langue.js';

const PAGES = { accueil: Accueil, rayons: Rayons, rayon: Rayon, nouveautes: Nouveautes, 'en-stock': Provenance, 'import-chine': Provenance, recherche: Recherche, favoris: Favoris, produit: Produit, panier: Panier, 'panier-partage': PanierPartage, commander: Commander, paiement: Paiement, 'carte-test': CarteTest, merci: Merci, compte: Compte, commandes: Commandes, retrouver: Retrouver, connexion: Connexion, suivi: Suivi, infos: Infos, notifications: Notifications, discussion: Discussion, avis: MesAvis, cagnotte: MaCagnotte };
/* Ce qui occupe le bas de l'écran du téléphone : navigation, barre d'action, ou les deux. */
const BAS = { produit: 'barre', commander: 'barre', panier: 'nav-barre', 'panier-partage': 'barre', paiement: '', 'carte-test': '', merci: '', recherche: '', discussion: 'barre' };

function Consentement() {
  const c = cfg.value;
  if (consentement.value || !mesureConfiguree(c)) return null;
  return (
    <div class="consentement" role="region" aria-label={t('Mesure d’audience')}>
      <p>{tx('Acceptez-vous une mesure d’audience anonyme pour nous aider à améliorer la boutique ? {0}', [<a class="lien" href={lien('/infos/cookies')}>{t('En savoir plus')}</a>])}</p>
      <div class="rangee"><button class="btn btn-secondaire btn-s" onClick={() => consentir(false)}>{t('Refuser')}</button><button class="btn btn-primaire btn-s" onClick={() => { consentir(true); chargerMesure(c); }}>{t('Accepter')}</button></div>
    </div>
  );
}

/* Téléphone réglé en anglais, en swahili ou en lingala : la boutique propose cette langue, une seule fois (jamais imposée). */
function PropositionLangue({ k, fini }) {
  const [question, oui, non] = PROPOSITIONS[k];
  const repondre = (choisie) => { fini(); if (choisie) changerLangue(k); else retenirLangue('fr'); };
  return (
    <div class="consentement proposition-langue" role="region" aria-label={question} lang={k}>
      <p class="rangee"><Icone n="globe" />{question}</p>
      <div class="rangee"><button class="btn btn-secondaire btn-s" onClick={() => repondre(false)}>{non}</button><button class="btn btn-primaire btn-s" onClick={() => repondre(true)}>{oui}</button></div>
    </div>
  );
}

function App() {
  const [proposee, setProposee] = useState(() => (!langueRetenue() && PROPOSITIONS[langueDuTelephone()] ? langueDuTelephone() : ''));
  const r = route.value;
  const Page = PAGES[r.nom] || Introuvable;
  const bas = r.nom in BAS ? BAS[r.nom] : 'nav';
  useEffect(() => { document.body.dataset.bas = bas; }, [bas]);
  useEffect(() => { chargerMesure(cfg.value); }, [cfg.value.analytics && cfg.value.analytics.id, consentement.value]);
  return (
    <>
      <a class="lien-evitement" href="#contenu" onClick={(e) => { e.preventDefault(); const m = document.getElementById('contenu'); if (m) { m.setAttribute('tabindex', '-1'); m.focus(); } }}>{t('Aller au contenu')}</a>
      {horsLigne.value ? <div class="bandeau-hors-ligne" role="status"><Icone n="info" />{t('Hors connexion : vous voyez la dernière version enregistrée.')}</div> : null}
      <div class={'appli' + (sens.value ? ' sens-' + sens.value : '')} key={r.cle}><Garde accueil={lien('/')}><Page /></Garde></div>
      {bas.includes('nav') ? <NavBas /> : null}
      {proposee && langue.value === 'fr' ? <PropositionLangue k={proposee} fini={() => setProposee('')} /> : <Consentement />}
      <BarreMiseAJour />
      <Feuilles />
      <Toasts />
      <Annonceur />
    </>
  );
}

appliquerTheme();
surveillerErreurs();
if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('vt');
const suivi = convertirAncienLien();
if (suivi) suivreCommande(suivi.id, suivi.t);
const racine = document.getElementById('app');
function demarrer() {
  racine.textContent = '';
  render(<App />, racine);
  chargerCatalogue().then(() => { suivreCatalogue(); actualiserMesCommandes(); suivreVisites(); synchroniserCompte(); suivreNotifications(); lireLienParrainage(ouvrirCadeauBienvenue); });
}
// Langue choisie sur ce téléphone : chargée avant le premier affichage (2,5 s au plus, puis la boutique s'affiche en
// français et passe dans la langue choisie dès son arrivée).
const retenue = langueRetenue();
if (retenue && retenue !== 'fr') Promise.race([choisirLangue(retenue, { garder: false }), new Promise((ok) => setTimeout(ok, 2500))]).then(demarrer, demarrer);
else demarrer();
enregistrerServiceWorker();
