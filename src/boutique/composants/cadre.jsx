// Sokoyetu (boutique) — cadre des pages : en-têtes, navigation du bas, pied de page, barre d'action, fenêtres d'aide.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { ouvrirFeuille } from '../../commun/js/interface.jsx';
import { dollars, telephone, lienWhatsApp, classes } from '../../commun/js/outils.js';
import { lien, route, retour, naviguer } from '../routeur.js';
import { cfg, nbArticles, favoris, moyensPaiement } from '../etat.js';
import { PuceOperateur } from './produits.jsx';
import { PAGES_LEGALES } from '../../commun/js/legal.js';

export function Marque({ petite }) {
  const c = cfg.value;
  return <span class={classes('marque', petite && 'petite')}>{c.name || 'Sokoyetu'}<i aria-hidden="true">.</i></span>;
}

function useDefilement() {
  const [d, setD] = useState(window.scrollY > 4);
  useEffect(() => {
    let attente = false;
    const f = () => { if (attente) return; attente = true; requestAnimationFrame(() => { attente = false; setD(window.scrollY > 4); }); };
    window.addEventListener('scroll', f, { passive: true }); return () => window.removeEventListener('scroll', f);
  }, []);
  return d;
}

function BoutonPanier() {
  const n = nbArticles.value;
  return (
    <a href={lien('/panier')} class="btn-icone" aria-label={n ? `Panier, ${n} article${n > 1 ? 's' : ''}` : 'Panier'} data-cible-panier>
      <Icone n="sac" />{n ? <span class="pastille-compte" key={n}>{n > 99 ? '99+' : n}</span> : null}
    </a>
  );
}

function RechercheOrdi() {
  const [q, setQ] = useState(route.value.nom === 'recherche' ? route.value.query.get('q') || '' : '');
  return (
    <form class="recherche-ordi" role="search" onSubmit={(e) => { e.preventDefault(); naviguer('/recherche' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '')); }}>
      <Icone n="recherche" />
      <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Rechercher un article, un rayon…" aria-label="Rechercher dans la boutique" enterkeyhint="search" />
    </form>
  );
}

/* En-tête principal : marque, navigation (ordinateur), recherche, favoris, compte, panier. */
export function EnteteBoutique({ classe, accueil }) {
  const defile = useDefilement();
  const nom = route.value.nom;
  const nf = favoris.value.size;
  const lienNav = (chemin, texte, actif) => <a href={lien(chemin)} aria-current={actif ? 'page' : undefined}>{texte}</a>;
  return (
    <header class={classes('entete', defile && 'defile', accueil && 'sur-accueil', classe)}>
      <div class="entete-in conteneur">
        <a href={lien('/')} class="entete-marque" aria-label={`${cfg.value.name}, accueil`}><Marque /></a>
        <nav class="entete-nav seulement-ordi" aria-label="Navigation principale">
          {lienNav('/', 'Accueil', nom === 'accueil')}{lienNav('/categories', 'Rayons', nom === 'rayons' || nom === 'rayon')}{lienNav('/nouveautes', 'Nouveautés', nom === 'nouveautes')}
        </nav>
        <div class="entete-actions">
          <div class="seulement-ordi"><RechercheOrdi /></div>
          <a href={lien('/recherche')} class="btn-icone seulement-mobile" aria-label="Rechercher"><Icone n="recherche" /></a>
          <a href={lien('/favoris')} class="btn-icone" aria-label={nf ? `Favoris, ${nf}` : 'Favoris'}><Icone n="coeur" />{nf ? <span class="pastille-compte">{nf}</span> : null}</a>
          <a href={lien('/compte')} class="btn-icone seulement-ordi" aria-label="Mon compte"><Icone n="personne" /></a>
          <span class="seulement-ordi"><BoutonPanier /></span>
        </div>
      </div>
    </header>
  );
}

/* En-tête d'une page intérieure : retour, titre, actions (téléphone) ; en-tête principal et titre (ordinateur). */
export function EntetePage({ titre, sous, repli = '/', actions, cacherTitreOrdi, onRetour }) {
  const defile = useDefilement();
  return (
    <>
      <EnteteBoutique classe="seulement-ordi" />
      <header class={classes('entete entete-page seulement-mobile', defile && 'defile')}>
        <div class="entete-in">
          <button class="btn-icone" onClick={() => (onRetour ? onRetour() : retour(repli))} aria-label="Retour"><Icone n="retour" /></button>
          <div class="entete-titre"><h1>{titre}</h1>{sous ? <small>{sous}</small> : null}</div>
          <div class="entete-actions">{actions}</div>
        </div>
      </header>
      {cacherTitreOrdi ? null : <div class="titre-page-ordi conteneur seulement-ordi"><h1 class="titre-serif">{titre}</h1>{sous ? <p class="attenue">{sous}</p> : null}</div>}
    </>
  );
}

const ONGLETS = [['/', 'accueil', 'Accueil', 'accueil'], ['/categories', 'rayons', 'Rayons', 'rayons'], ['/nouveautes', 'nouveautes', 'Nouveautés', 'etincelle'], ['/panier', 'panier', 'Panier', 'sac'], ['/compte', 'compte', 'Compte', 'personne']];
const DANS_ONGLET = { rayon: 'rayons', favoris: 'compte', commandes: 'compte', suivi: 'compte', infos: 'compte', retrouver: 'compte', connexion: 'compte' };

export function NavBas() {
  const nom = route.value.nom; const actif = DANS_ONGLET[nom] || nom; const n = nbArticles.value;
  return (
    <nav class="nav-bas seulement-mobile" aria-label="Navigation">
      <div class="nav-bas-in" style={{ '--n': 5 }}>
        {ONGLETS.map(([chemin, cle, texte, icone]) => (
          <a key={cle} href={lien(chemin)} aria-current={actif === cle ? 'page' : undefined} data-cible-panier={cle === 'panier' ? '' : undefined}>
            <span class="ic-bulle"><Icone n={icone} plein={actif === cle && cle !== 'nouveautes'} />{cle === 'panier' && n ? <span class="pastille-compte" key={n}>{n > 99 ? '99+' : n}</span> : null}</span>
            {texte}
          </a>
        ))}
      </div>
    </nav>
  );
}

/* Barre collée en bas de l'écran (ajouter au panier, commander, continuer). */
export function BarreAction({ children, avecNav }) {
  return <div class={classes('barre-action', avecNav && 'au-dessus-nav')}><div class="barre-action-in">{children}</div></div>;
}

export function Pied() {
  const c = cfg.value; const ms = moyensPaiement.value; const wa = lienWhatsApp(c.whatsapp, `Bonjour ${c.name}, j’ai une question.`);
  return (
    <footer class="pied">
      <div class="conteneur pied-in">
        <div class="pied-marque">
          <Marque />
          <p>{c.tagline}. Articles en stock à {c.city} et importés de Chine, livrés à Bukavu et Goma.</p>
          {ms.length ? <div class="operateurs">{ms.map((m) => <PuceOperateur key={m.k} m={m} />)}</div> : null}
        </div>
        <nav aria-label="Aide">
          <h2>Aide</h2>
          <button type="button" onClick={ouvrirLivraisonPaiement}>Livraison et paiement</button>
          <button type="button" onClick={ouvrirCommentCaMarche}>Comment ça marche</button>
          <a href={lien('/compte/commandes')}>Suivre ma commande</a>
          {wa ? <a href={wa} target="_blank" rel="noopener">Nous écrire sur WhatsApp</a> : null}
        </nav>
        <nav aria-label="Informations légales">
          <h2>Informations</h2>
          {Object.entries(PAGES_LEGALES).map(([k, t]) => <a key={k} href={lien('/infos/' + k)}>{t}</a>)}
        </nav>
      </div>
      <div class="conteneur pied-bas">
        <span>© {new Date().getFullYear()} {(c.legal && c.legal.company) || c.name} · {c.city}, RDC</span>
        <span>Prix en dollars US · paiement Mobile Money</span>
      </div>
    </footer>
  );
}

/* ---------- Fenêtres d'aide ---------- */

export function ouvrirLivraisonPaiement() {
  ouvrirFeuille({
    titre: 'Livraison et paiement',
    contenu: () => {
      const c = cfg.value; const ms = moyensPaiement.value;
      return (
        <div class="pile-l">
          <section class="pile">
            <h3 class="sous-titre">Zones de livraison</h3>
            <div class="liste">
              {c.zones.map((z) => (
                <div class="ligne" key={z.id}>
                  <span class="ligne-vignette"><Icone n={z.pickup ? 'boutique' : 'camion'} /></span>
                  <span class="ligne-texte"><b>{z.name}</b><small>{z.pickup ? 'À retirer en boutique' : z.days > 1 ? `Sous ${z.days} jours` : 'Sous 24 h'}</small></span>
                  <span class="ligne-fin"><b>{R.num(z.fee) ? dollars(z.fee) : 'Gratuit'}</b></span>
                </div>
              ))}
            </div>
            {R.num(c.freeShippingOver) > 0 ? <p class="attenue petit">Livraison offerte dès {dollars(c.freeShippingOver)} d’achat.</p> : null}
          </section>
          <section class="pile">
            <h3 class="sous-titre">Articles importés de Chine</h3>
            <p class="attenue">Commandés pour vous chez nos fournisseurs, transportés puis dédouanés par nos soins : livrés en {R.int(c.importDays)} jours environ, sans frais cachés.</p>
          </section>
          <section class="pile">
            <h3 class="sous-titre">Paiement Mobile Money, dans l’application</h3>
            <p class="attenue">Vous choisissez votre opérateur : la demande de paiement s’affiche sur votre téléphone et vous la validez avec votre code PIN. La commande est confirmée dès que l’opérateur valide le paiement, et vous recevez aussitôt votre reçu avec votre numéro de commande. Pas de paiement à la livraison.</p>
            {R.num(c.serviceFeePct) > 0 ? <p class="attenue">Des frais de service de {R.num(c.serviceFeePct)} % du panier s’ajoutent au paiement ; ils sont affichés avant de payer.</p> : null}
            {!ms.length ? <p class="attenue">Le paiement en ligne ouvre très bientôt.</p> : null}
            {ms.length ? <div class="operateurs">{ms.map((m) => <PuceOperateur key={m.k} m={m} />)}</div> : null}
            <p class="note ton-info"><Icone n="bouclier" /><span>Vous seul saisissez votre code PIN, sur votre téléphone. Personne ne vous le demandera.</span></p>
          </section>
          {c.returns ? <section class="pile"><h3 class="sous-titre">Échanges</h3><p class="attenue">{c.returns}</p></section> : null}
        </div>
      );
    }
  });
}

export const ETAPES_IMPORT = [
  ['etiquette', 'Vous choisissez', 'Articles en stock à Bukavu ou importés de Chine sur commande.'],
  ['portefeuille', 'Vous payez par Mobile Money', 'M-Pesa, Airtel Money, Orange Money : vous validez le paiement sur votre téléphone et recevez votre reçu.'],
  ['douane', 'Nous importons et dédouanons', 'Transport par conteneur et formalités de douane pris en charge.'],
  ['camion', 'Vous êtes livré', 'À Bukavu et à Goma, avec un suivi de commande à chaque étape.']
];

export function ouvrirCommentCaMarche() {
  ouvrirFeuille({
    titre: 'Comment ça marche',
    contenu: () => (
      <ol class="etapes-import verticales">
        {ETAPES_IMPORT.map(([ic, t, s], i) => <li key={i}><span class="ei-icone"><Icone n={ic} /></span><div><b>{i + 1}. {t}</b><p>{s}</p></div></li>)}
      </ol>
    )
  });
}

export function lienWhatsAppBoutique(texte) { return lienWhatsApp(cfg.value.whatsapp, texte); }
export const numeroWhatsApp = () => telephone(cfg.value.whatsapp);
