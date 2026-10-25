// Sokoyetu (boutique) — présentation des articles : carte, grille, liens, informations de livraison.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { dollars, slug, date, JOUR, pluriel } from '../../commun/js/outils.js';
import { toast, LogoOperateur } from '../../commun/js/interface.jsx';
import { lien } from '../routeur.js';
import { cfg, favoris, basculerFavori, produits, rayonsParId } from '../etat.js';

export const lienProduit = (p) => lien(`/p/${encodeURIComponent(p.id)}/${slug(p.title)}`);
export const lienRayon = (c) => lien(`/c/${encodeURIComponent(c.id)}/${slug(c.name)}`);

/* Ordre « Pour vous » : mis en avant, puis les plus vendus, puis les plus récents. */
export function trier(liste, ordre) {
  const l = [...liste];
  if (ordre === 'nouveautes') return l.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (ordre === 'prix-croissant') return l.sort((a, b) => R.num(a.price) - R.num(b.price));
  if (ordre === 'prix-decroissant') return l.sort((a, b) => R.num(b.price) - R.num(a.price));
  if (ordre === 'promos') return l.filter((p) => R.pourcentRemise(p) > 0).sort((a, b) => R.pourcentRemise(b) - R.pourcentRemise(a));
  return l.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || R.int(b.sold) - R.int(a.sold) || (b.createdAt || 0) - (a.createdAt || 0));
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
  const c = cfg.value; const remise = R.pourcentRemise(p); const fini = epuise(p);
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
            {fini ? <span class="cp-badge epuise">Épuisé</span> : remise ? <span class="cp-badge promo">−{remise} %</span> : null}
            {R.estImport(p) && !fini ? <span class="cp-badge import"><Icone n="avion" />Chine</span> : null}
          </div>
        </div>
        <div class="cp-corps">
          <h3 class="cp-titre">{p.title}</h3>
          <div class="cp-prix"><span class={'prix' + (remise ? ' prix-promo' : '')}>{dollars(p.price)}</span>{remise ? <span class="prix-barre">{dollars(p.compareAt)}</span> : null}</div>
          <p class="cp-delai"><Icone n={d.icone} />{d.court}</p>
        </div>
      </a>
      <BoutonFavori p={p} />
    </article>
  );
}

export function SqueletteGrille({ n = 8 }) {
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
