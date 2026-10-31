// Sokoyetu (boutique) — présentation des articles : carte, grille, liens, informations de livraison.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { dollars, slug, date, JOUR, pluriel } from '../../commun/js/outils.js';
import { toast, LogoOperateur } from '../../commun/js/interface.jsx';
import { lien } from '../routeur.js';
import { cfg, favoris, basculerFavori, produits, rayonsParId, catalogueErreur, chargerCatalogue } from '../etat.js';
import { NoteCarte } from './avis.jsx';

export const lienProduit = (p) => lien(`/p/${encodeURIComponent(p.id)}/${slug(p.title)}`);
export const lienRayon = (c) => lien(`/c/${encodeURIComponent(c.id)}/${slug(c.name)}`);

/* Ordre « Pour vous » : mis en avant, puis les plus vendus, puis les plus récents. */
export function trier(liste, ordre) {
  const l = [...liste];
  if (ordre === 'nouveautes') return l.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const prix = (p) => R.prixAffiche(p).prix;
  if (ordre === 'prix-croissant') return l.sort((a, b) => prix(a) - prix(b));
  if (ordre === 'prix-decroissant') return l.sort((a, b) => prix(b) - prix(a));
  if (ordre === 'promos') return l.filter((p) => R.pourcentRemise(p) > 0).sort((a, b) => R.pourcentRemise(b) - R.pourcentRemise(a));
  return l.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || R.int(b.sold) - R.int(a.sold) || (b.createdAt || 0) - (a.createdAt || 0));
}

/* « 2 j 05 h 12 min » ou « 05 : 12 : 30 » : temps restant d'une vente flash, mis à jour chaque seconde. */
export function CompteARebours({ fin, court }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((fin - now) / 1000));
  const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const d2 = (n) => String(n).padStart(2, '0');
  if (court) return <span class="rebours num">{j ? `${j} j ${d2(h)} h` : `${d2(h)}:${d2(m)}:${d2(x)}`}</span>;
  return <span class="rebours num" role="timer">{j ? `${j} j ` : ''}{d2(h)} h {d2(m)} min {j ? '' : `${d2(x)} s`}</span>;
}

export const epuise = (p) => !R.estImport(p) && R.stockTotal(p) <= 0;

/* Délai annoncé au client : en stock (24–48 h) ou import (~20 jours, avec dates estimées). */
export function delai(p, c = cfg.value) {
  if (R.estImport(p)) {
    const j = R.int(c.importDays) || 20; const now = Date.now();
    return { court: `≈ ${j} jours`, titre: 'Importé de Chine pour vous', texte: `Livraison estimée entre le ${date(now + (j - 3) * JOUR, { day: 'numeric', month: 'long' })} et le ${date(now + (j + 4) * JOUR, { day: 'numeric', month: 'long' })}, dédouanement compris.`, icone: 'avion' };
  }
  return { court: 'Livré en 24–48 h', titre: `En stock à ${c.city || 'Bukavu'}`, texte: 'Préparé dès la confirmation du paiement, livré sous 24 à 48 h.', icone: 'camion' };
}

export function BoutonFavori({ p, classe = 'cp-favori' }) {
  const actif = favoris.value.has(p.id);
  return (
    <button type="button" class={classe + (actif ? ' actif' : '')} aria-pressed={actif ? 'true' : 'false'} aria-label={actif ? `Retirer « ${p.title} » des favoris` : `Ajouter « ${p.title} » aux favoris`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); const a = basculerFavori(p.id); toast(a ? 'Ajouté aux favoris' : 'Retiré des favoris', { icone: 'coeur' }); }}>
      <Icone n="coeur" plein={actif} />
    </button>
  );
}

export function CarteProduit({ p, prioritaire, rang = 0 }) {
  const c = cfg.value; const pa = R.prixAffiche(p); const remise = pa.pct; const fini = epuise(p);
  const [survol, setSurvol] = useState(false);
  const images = (p.images || []).filter(Boolean);
  const d = delai(p, c);
  const marquer = (e) => { const img = e.currentTarget.querySelector('.cp-media img'); if (img && document.startViewTransition) img.style.viewTransitionName = 'photo-produit'; };
  return (
    <article class="carte-produit" data-produit={p.id} style={rang < 12 ? { animationDelay: `${Math.min(rang, 8) * 40}ms` } : undefined}>
      <a href={lienProduit(p)} class="cp-lien" onClick={marquer} onPointerEnter={() => setSurvol(true)} onPointerLeave={() => setSurvol(false)}>
        <div class="cp-media">
          <Photo m={images[0]} alt={p.title} prioritaire={prioritaire} />
          {images[1] && survol ? <Photo m={images[1]} alt="" classe="cp-media-2" /> : null}
          <div class="cp-badges">
            {fini ? <span class="cp-badge epuise">Épuisé</span> : pa.flash ? <span class="cp-badge flash"><Icone n="horloge" />−{remise} %</span> : remise ? <span class="cp-badge promo">−{remise} %</span> : null}
            {R.estImport(p) && !fini ? <span class="cp-badge import"><Icone n="avion" />Chine</span> : null}
          </div>
        </div>
        <div class="cp-corps">
          <h3 class="cp-titre">{p.title}</h3>
          <div class="cp-prix">{pa.des ? <small class="prix-des">dès</small> : null}<span class={'prix' + (remise ? ' prix-promo' : '')}>{dollars(pa.prix)}</span>{remise ? <span class="prix-barre">{dollars(pa.barre)}</span> : null}</div>
          {pa.flash && !fini ? <p class="cp-flash"><Icone n="horloge" />Fin dans <CompteARebours fin={pa.flash.fin} court /></p> : null}
          <NoteCarte p={p} />
          <p class="cp-delai"><Icone n={d.icone} />{d.court}</p>
        </div>
      </a>
      <BoutonFavori p={p} />
    </article>
  );
}

/* Le catalogue n'a pas pu être chargé (et rien n'est gardé sur ce téléphone) : un message et « Réessayer ». */
export function ErreurCatalogue() {
  const [essai, setEssai] = useState(false);
  return (
    <div class="etat-erreur" role="alert">
      <div class="vide-icone" aria-hidden="true"><Icone n="alerte" /></div>
      <h2>Impossible d’afficher les articles</h2>
      <p>{catalogueErreur.value} Vérifiez votre connexion : nous réessayons tout seuls.</p>
      <div class="rangee-l"><button class={'btn btn-primaire' + (essai ? ' charge' : '')} disabled={essai} onClick={async () => { setEssai(true); await chargerCatalogue(); setEssai(false); }}><Icone n="actualiser" />Réessayer</button></div>
    </div>
  );
}

export function SqueletteGrille({ n = 8 }) {
  if (catalogueErreur.value) return <ErreurCatalogue />;
  return (
    <div class="grille-produits" aria-busy="true" aria-label="Chargement des articles">
      {Array.from({ length: n }, (_, i) => <div key={i} class="cp-squelette"><div class="squelette" style={{ aspectRatio: '4 / 5' }} /><div class="squelette" style={{ height: 14, width: '80%', marginTop: 12 }} /><div class="squelette" style={{ height: 16, width: '40%', marginTop: 8 }} /></div>)}
    </div>
  );
}

/* Grille d'articles avec « Voir plus » (affichage progressif, rapide même avec beaucoup d'articles). */
export function GrilleProduits({ liste, parPage = 12, prioritaires = 2, vide = null }) {
  const [n, setN] = useState(parPage);
  if (!liste.length) return vide;
  return (
    <>
      <div class="grille-produits">{liste.slice(0, n).map((p, i) => <CarteProduit key={p.id} p={p} prioritaire={i < prioritaires} rang={i} />)}</div>
      {liste.length > n ? (
        <div class="voir-plus">
          <p class="discret petit">{n} sur {pluriel(liste.length, 'article')}</p>
          <button class="btn btn-secondaire" onClick={() => setN(n + parPage)}>Voir plus d’articles<Icone n="bas" /></button>
        </div>
      ) : null}
    </>
  );
}

/* Photo représentant un rayon : la sienne, sinon celle d'un article du rayon. */
export function photoRayon(c) {
  if (c && c.image && c.image.type !== 'art') return c.image;
  const l = produits.value.filter((p) => (p.collectionIds || []).includes(c.id) && R.imagePrincipale(p));
  const p = l.find((x) => x.featured) || l[0];
  return p ? R.imagePrincipale(p) : null;
}
export const nomRayon = (id) => (rayonsParId.value.get(id) || {}).name || '';

export function PuceOperateur({ m }) {
  return <span class="operateur"><LogoOperateur m={m} taille={22} />{m.label}</span>;
}
