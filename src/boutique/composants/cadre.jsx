// Sokoyetu (boutique) — cadre des pages : en-têtes, navigation du bas, pied de page, barre d'action, fenêtres d'aide.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Cabas } from '../../commun/js/logo.jsx';
import { ouvrirFeuille, fermerFeuille, toast, Choix, Note } from '../../commun/js/interface.jsx';
import { dollars, lienWhatsApp, classes } from '../../commun/js/outils.js';
import { lien, route, retour, naviguer } from '../routeur.js';
import { cfg, nbArticles, favoris, moyensPaiement, carteAcceptee } from '../etat.js';
import { nonLues } from '../notifications.js';
import { PuceOperateur } from './produits.jsx';
import { PAGES_LEGALES } from '../../commun/js/legal.js';
import { t, tx, tn, aTraduire, LANGUES, langue, choisirLangue } from '../../commun/js/langue.js';

/* Le logo : le cabas, le nom et, en dessous, le slogan (Réglages → Identité). */
export function Marque({ petite, slogan, grande }) {
  const c = cfg.value;
  return (
    <span class={classes('marque', petite && 'petite', slogan && 'avec-slogan')}>
      <Cabas taille={grande ? 96 : 36} />
      <span class="marque-texte"><span class="marque-nom">{c.name || 'Sokoyetu'}</span>{slogan && c.tagline ? <small class="marque-slogan">{t(c.tagline)}</small> : null}</span>
    </span>
  );
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
    <a href={lien('/panier')} class="btn-icone" aria-label={n ? tn(n, 'Panier, {n} article', 'Panier, {n} articles') : t('Panier')} data-cible-panier>
      <Icone n="sac" />{n ? <span class="pastille-compte" key={n}>{n > 99 ? '99+' : n}</span> : null}
    </a>
  );
}

function RechercheOrdi() {
  const [q, setQ] = useState(route.value.nom === 'recherche' ? route.value.query.get('q') || '' : '');
  return (
    <form class="recherche-ordi" role="search" onSubmit={(e) => { e.preventDefault(); naviguer('/recherche' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '')); }}>
      <Icone n="recherche" />
      <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('Rechercher un article, un rayon…')} aria-label={t('Rechercher dans la boutique')} enterkeyhint="search" />
    </form>
  );
}

/* Cloche du centre de notifications, avec le nombre de notifications non lues. */
export function BoutonNotifications() {
  const n = nonLues.value;
  return (
    <a href={lien('/notifications')} class="btn-icone" aria-label={n ? tn(n, 'Notifications, {n} non lue', 'Notifications, {n} non lues') : t('Notifications')}>
      <Icone n="cloche" />{n ? <span class="pastille-compte" key={n}>{n > 9 ? '9+' : n}</span> : null}
    </a>
  );
}

/* En-tête principal : marque, navigation (ordinateur), recherche, notifications, favoris, compte, panier. */
export function EnteteBoutique({ classe, accueil }) {
  const defile = useDefilement();
  const nom = route.value.nom;
  const nf = favoris.value.size;
  const lienNav = (chemin, texte, actif) => <a href={lien(chemin)} aria-current={actif ? 'page' : undefined}>{texte}</a>;
  return (
    <header class={classes('entete', defile && 'defile', accueil && 'sur-accueil', classe)}>
      <div class="entete-in conteneur">
        <a href={lien('/')} class="entete-marque"><Marque slogan /><span class="sr">{t(', accueil')}</span></a>
        <nav class="entete-nav seulement-ordi" aria-label={t('Navigation principale')}>
          {lienNav('/', t('Accueil'), nom === 'accueil')}{lienNav('/categories', t('Rayons'), nom === 'rayons' || nom === 'rayon')}{lienNav('/nouveautes', t('Nouveautés'), nom === 'nouveautes')}
        </nav>
        <div class="entete-actions">
          <div class="recherche-large"><RechercheOrdi /></div>
          <a href={lien('/recherche')} class="btn-icone recherche-icone" aria-label={t('Rechercher')}><Icone n="recherche" /></a>
          <BoutonNotifications />
          <a href={lien('/favoris')} class="btn-icone" aria-label={nf ? `Favoris, ${nf}` : t('Favoris')}><Icone n="coeur" />{nf ? <span class="pastille-compte">{nf}</span> : null}</a>
          <a href={lien('/compte')} class="btn-icone seulement-ordi" aria-label={t('Mon compte')}><Icone n="personne" /></a>
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
          <button class="btn-icone" onClick={() => (onRetour ? onRetour() : retour(repli))} aria-label={t('Retour')}><Icone n="retour" /></button>
          <div class="entete-titre"><h1>{titre}</h1>{sous ? <small>{sous}</small> : null}</div>
          <div class="entete-actions">{actions}</div>
        </div>
      </header>
      {cacherTitreOrdi ? null : <div class="titre-page-ordi conteneur seulement-ordi"><h1 class="titre-serif">{titre}</h1>{sous ? <p class="attenue">{sous}</p> : null}</div>}
    </>
  );
}

const ONGLETS = [['/', 'accueil', aTraduire('Accueil'), 'accueil'], ['/categories', 'rayons', aTraduire('Rayons'), 'rayons'], ['/nouveautes', 'nouveautes', aTraduire('Nouveautés'), 'etincelle'], ['/panier', 'panier', aTraduire('Panier'), 'sac'], ['/compte', 'compte', aTraduire('Compte'), 'personne']];
const DANS_ONGLET = { rayon: 'rayons', favoris: 'compte', commandes: 'compte', suivi: 'compte', infos: 'compte', retrouver: 'compte', connexion: 'compte', notifications: 'compte', discussion: 'compte', avis: 'compte' };

export function NavBas() {
  const nom = route.value.nom; const actif = DANS_ONGLET[nom] || nom; const n = nbArticles.value;
  return (
    <nav class="nav-bas seulement-mobile" aria-label={t('Navigation')}>
      <div class="nav-bas-in" style={{ '--n': 5 }}>
        {ONGLETS.map(([chemin, cle, texte, icone]) => (
          <a key={cle} href={lien(chemin)} aria-current={actif === cle ? 'page' : undefined} data-cible-panier={cle === 'panier' ? '' : undefined}>
            <span class="ic-bulle"><Icone n={icone} plein={actif === cle && cle !== 'nouveautes'} />{cle === 'panier' && n ? <span class="pastille-compte" key={n}>{n > 99 ? '99+' : n}</span> : null}</span>
            {t(texte)}
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
  const c = cfg.value; const ms = moyensPaiement.value; const wa = lienWhatsApp(c.whatsapp, t('Bonjour {0}, j’ai une question.', [c.name]));
  return (
    <footer class="pied">
      <div class="conteneur pied-in">
        <div class="pied-marque">
          <Marque slogan />
          <p>{tx('{0}. Articles en stock à {1} et importés de Chine, livrés à Bukavu et Goma.', [t(c.tagline), c.city])}</p>
          {ms.length ? <div class="operateurs">{ms.map((m) => <PuceOperateur key={m.k} m={m} />)}</div> : null}
        </div>
        <nav aria-label={t('Aide')}>
          <h2>{t('Aide')}</h2>
          <button type="button" onClick={ouvrirLivraisonPaiement}>{t('Livraison et paiement')}</button>
          <button type="button" onClick={ouvrirCommentCaMarche}>{t('Comment ça marche')}</button>
          <a href={lien('/compte/commandes')}>{t('Suivre ma commande')}</a>
          <a href={lien('/discussion')}>{t('Écrire à la boutique')}</a>
          {wa ? <a href={wa} target="_blank" rel="noopener">{t('Nous écrire sur WhatsApp')}</a> : null}
        </nav>
        <nav aria-label={t('Informations légales')}>
          <h2>{t('Informations')}</h2>
          {Object.entries(PAGES_LEGALES).map(([k, titre]) => <a key={k} href={lien('/infos/' + k)}>{t(titre)}</a>)}
        </nav>
        <div class="pied-langues" role="group" aria-labelledby="pied-langue">
          <h2 id="pied-langue">{t('Langue')}</h2>
          {LANGUES.map((l) => <button type="button" key={l.k} lang={l.k} aria-pressed={langue.value === l.k ? 'true' : 'false'} onClick={() => changerLangue(l.k)}>{langue.value === l.k ? <Icone n="coche" /> : null}{l.nom}</button>)}
        </div>
      </div>
      <div class="conteneur pied-bas">
        <span>{tx('© {0} {1} · {2}, RDC', [new Date().getFullYear(), (c.legal && c.legal.company) || c.name, c.city])}</span>
        <span>{carteAcceptee.value ? t('Prix en dollars US · paiement Mobile Money ou carte') : t('Prix en dollars US · paiement Mobile Money')}</span>
      </div>
    </footer>
  );
}

/* ---------- Langue ---------- */

/* Change la langue de la boutique (retenue sur ce téléphone). */
export async function changerLangue(k) {
  if (k === langue.peek()) return true;
  const ok = await choisirLangue(k);
  if (!ok) toast(t('Langue indisponible pour le moment. Vérifiez la connexion, puis réessayez.'), { icone: 'alerte', ton: 'danger', duree: 4000 });
  return ok;
}
export const nomLangue = () => (LANGUES.find((l) => l.k === langue.value) || LANGUES[0]).nom;

export function ouvrirChoixLangue() {
  const id = ouvrirFeuille({
    titre: t('Langue'),
    contenu: () => (
      <div class="pile">
        <div class="choix-liste" role="radiogroup" aria-label={t('Langue de la boutique')}>
          {LANGUES.map((l) => <div key={l.k} lang={l.k}><Choix actif={langue.value === l.k} onClick={async () => { if (await changerLangue(l.k)) fermerFeuille(id); }} icone="globe" titre={l.nom} sous={l.phrase} /></div>)}
        </div>
        <Note icone="info">{t('Les noms et descriptions des articles, ainsi que les conditions de vente, restent tels que la boutique les a écrits.')}</Note>
      </div>
    )
  });
}

/* ---------- Fenêtres d'aide ---------- */

export function ouvrirLivraisonPaiement() {
  ouvrirFeuille({
    titre: t('Livraison et paiement'),
    contenu: () => {
      const c = cfg.value; const ms = moyensPaiement.value;
      return (
        <div class="pile-l">
          <section class="pile">
            <h3 class="sous-titre">{t('Zones de livraison')}</h3>
            <div class="liste">
              {c.zones.map((z) => (
                <div class="ligne" key={z.id}>
                  <span class="ligne-vignette"><Icone n={z.pickup ? 'boutique' : 'camion'} /></span>
                  <span class="ligne-texte"><b>{t(z.name)}</b><small>{z.pickup ? t('À retirer en boutique') : z.days > 1 ? t('Sous {0} jours', [z.days]) : t('Sous 24 h')}</small></span>
                  <span class="ligne-fin"><b>{R.num(z.fee) ? dollars(z.fee) : R.num(z.perKg) ? '' : t('Gratuit')}{R.num(z.perKg) && !z.pickup ? `${R.num(z.fee) ? ' + ' : ''}${dollars(z.perKg)}/kg` : ''}</b></span>
                </div>
              ))}
            </div>
            {R.num(c.freeShippingOver) > 0 ? <p class="attenue petit">{tx('Livraison offerte dès {0} d’achat.', [dollars(c.freeShippingOver)])}</p> : null}
          </section>
          <section class="pile">
            <h3 class="sous-titre">{t('Articles importés de Chine')}</h3>
            <p class="attenue">{tx('Commandés pour vous chez nos fournisseurs, transportés puis dédouanés par nos soins : livrés en {0} jours environ, sans frais cachés.', [R.int(c.importDays)])}</p>
          </section>
          <section class="pile">
            <h3 class="sous-titre">{carteAcceptee.value ? t('Paiement Mobile Money ou par carte, dans l’application') : t('Paiement Mobile Money, dans l’application')}</h3>
            <p class="attenue">{t('Vous choisissez votre opérateur : la demande de paiement s’affiche sur votre téléphone et vous la validez avec votre code PIN. La commande est confirmée dès que l’opérateur valide le paiement, et vous recevez aussitôt votre reçu avec votre numéro de commande. Pas de paiement à la livraison.')}</p>
            {carteAcceptee.value ? <p class="attenue">{t('Par carte Visa ou Mastercard, vous la saisissez sur la page sécurisée de notre partenaire de paiement : la boutique ne voit jamais son numéro.')}</p> : null}
            {R.num(c.serviceFeePct) > 0 ? <p class="attenue">{tx('Des frais de service de {0} % du panier s’ajoutent au paiement ; ils sont affichés avant de payer.', [R.num(c.serviceFeePct)])}</p> : null}
            {!ms.length ? <p class="attenue">{t('Le paiement en ligne ouvre très bientôt.')}</p> : null}
            {ms.length ? <div class="operateurs">{ms.map((m) => <PuceOperateur key={m.k} m={m} />)}</div> : null}
            <p class="note ton-info"><Icone n="bouclier" /><span>{t('Vous seul saisissez votre code PIN, sur votre téléphone. Personne ne vous le demandera.')}</span></p>
          </section>
          {c.returns ? <section class="pile"><h3 class="sous-titre">{t('Échanges')}</h3><p class="attenue">{t(c.returns)}</p></section> : null}
        </div>
      );
    }
  });
}

// [icône, titre, explication, titre court, détail court] : les deux derniers pour les petites tuiles de l'accueil.
export const etapesImport = () => [
  ['etiquette', t('Vous choisissez'), t('Articles en stock à Bukavu ou importés de Chine sur commande.'), t('Commande'), t('Stock ou import')],
  carteAcceptee.value
    ? ['portefeuille', t('Vous payez en ligne'), t('Mobile Money (M-Pesa, Airtel Money, Orange Money), validé sur votre téléphone, ou carte Visa / Mastercard : vous recevez aussitôt votre reçu.'), t('Paiement'), t('Mobile Money ou carte')]
    : ['portefeuille', t('Vous payez par Mobile Money'), t('M-Pesa, Airtel Money, Orange Money : vous validez le paiement sur votre téléphone et recevez votre reçu.'), t('Paiement'), 'Mobile Money'],
  ['douane', t('Nous importons et dédouanons'), t('Transport par conteneur et formalités de douane pris en charge.'), t('Import'), t('Douane incluse')],
  ['camion', t('Vous êtes livré'), t('À Bukavu et à Goma, avec un suivi de commande à chaque étape.'), t('Livraison'), t('Bukavu et Goma')]
];

export function ouvrirCommentCaMarche() {
  ouvrirFeuille({
    titre: t('Comment ça marche'),
    contenu: () => (
      <ol class="etapes-import verticales">
        {etapesImport().map(([ic, t, s], i) => <li key={i}><span class="ei-icone"><Icone n={ic} /></span><div><b>{i + 1}. {t}</b><p>{s}</p></div></li>)}
      </ol>
    )
  });
}
