// Sokoyetu (boutique) — grande bannière d'accueil : « Sokoyetu » au centre, sur des images qui défilent
// (la première : le port, ses conteneurs et ses grues). Pause possible, glisser du doigt, clavier.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { classes } from '../../commun/js/outils.js';
import { naviguer } from '../routeur.js';
import { bannieres, cfg, rayonsParId } from '../etat.js';
import { Marque, ouvrirCommentCaMarche } from './cadre.jsx';
import { lienRayon } from './produits.jsx';
import { t, tx, aTraduire } from '../../commun/js/langue.js';

const DUREE = 6500;
const img = (nom, alt) => ({ type: 'url', src: `photos/${nom}.webp`, srcset: `photos/${nom}-s.webp 900w, photos/${nom}.webp 1600w`, w: 1600, h: 900, alt });

/* Images d'origine, utilisées tant qu'aucune bannière n'a été créée dans l'administration. */
const PAR_DEFAUT = [
  { id: 'port', eyebrow: aTraduire('Import Chine → Afrique'), title: aTraduire('Vos articles voyagent par conteneur jusqu’à vous'), cta: aTraduire('Voir les nouveautés'), collectionId: 'new', image: img('ban-port', aTraduire('Port à conteneurs : grues de chargement et porte-conteneurs à quai')) },
  { id: 'douane', eyebrow: aTraduire('Dédouanement compris'), title: aTraduire('Transport et douane : on s’occupe de tout'), cta: aTraduire('Comment ça marche'), collectionId: 'aide', image: img('ban-douane', aTraduire('Terminal à conteneurs vu du ciel, avec ses grues')) },
  { id: 'transit', eyebrow: 'Bukavu · Goma', title: aTraduire('Payez par Mobile Money, recevez chez vous'), cta: aTraduire('Découvrir les rayons'), collectionId: '', image: img('ban-transit', aTraduire('Camion de marchandises sur une route de montagne')) }
];
/* Dans la langue choisie : les textes d'origine (ces images, le catalogue d'exemple) se traduisent ; ceux que la boutique a
   écrits elle-même s'affichent tels quels (t() rend le texte inconnu sans le changer). */
const traduite = (b) => ({ ...b, eyebrow: t(b.eyebrow), title: t(b.title), subtitle: t(b.subtitle), cta: t(b.cta), image: { ...b.image, alt: t(b.image.alt) } });

function destination(b) {
  if (b.collectionId === 'aide') return () => ouvrirCommentCaMarche();
  if (b.collectionId === 'new') return () => naviguer('/nouveautes');
  const c = b.collectionId && rayonsParId.value.get(b.collectionId);
  if (c) return () => naviguer(lienRayon(c).replace(/^#/, ''));
  return () => naviguer('/categories');
}

export function Banniere() {
  const c = cfg.value;
  const perso = bannieres.value.filter((b) => b.image && b.image.type !== 'art');
  const slides = (perso.length ? perso : PAR_DEFAUT).map(traduite);
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tour, setTour] = useState(0);
  const x0 = useRef(null); const glisse = useRef(false);
  const n = slides.length; const k = i % n;
  const aller = (j) => { setI((j + n) % n); setTour((t) => t + 1); };

  useEffect(() => {
    if (pause || n < 2) return undefined;
    const t = setTimeout(() => { if (!document.hidden) aller(k + 1); else setTour((v) => v + 1); }, DUREE);
    return () => clearTimeout(t);
  }, [k, pause, n, tour]);

  const b = slides[k];
  const zones = c.zones.filter((z) => !z.pickup).map((z) => z.name).slice(0, 2).join(' · ');
  return (
    <section class="heros" aria-roledescription="carrousel" aria-label={t('{0} : présentation', [c.name])}
      onPointerDown={(e) => { x0.current = e.clientX; glisse.current = false; }}
      onPointerUp={(e) => { if (x0.current == null) return; const dx = e.clientX - x0.current; x0.current = null; if (Math.abs(dx) > 45 && n > 1) { glisse.current = true; aller(k + (dx < 0 ? 1 : -1)); } }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') aller(k + 1); if (e.key === 'ArrowLeft') aller(k - 1); }}>
      <div class="heros-fond" aria-hidden="true">
        {slides.map((s, j) => <figure key={s.id || j} class={classes(j === k && 'actif')}><Photo m={s.image} alt="" prioritaire={j === 0} tailles="100vw" /></figure>)}
      </div>
      <div class="heros-voile" aria-hidden="true" />
      <div class="heros-contenu">
        <p class="heros-kicker"><Icone n="avion" />{tx('Chine → {0}', [zones || c.city])}</p>
        <h1 class="heros-marque"><Marque grande /></h1>
        <p class="heros-slogan">{t(c.tagline)}</p>
        <div class="heros-legende" key={k} aria-live="off">
          {b.eyebrow ? <span class="heros-surtitre">{b.eyebrow}</span> : null}
          <p class="heros-titre">{b.title}</p>
          {b.subtitle ? <p class="heros-sous">{b.subtitle}</p> : null}
        </div>
        <div class="heros-actions">
          <button class="btn btn-l heros-cta" onClick={() => { if (!glisse.current) destination(b)(); }}>{b.cta || t('Découvrir')}<Icone n="droite" /></button>
        </div>
      </div>
      {n > 1 ? (
        <div class="heros-controles">
          <div class="heros-progres" role="tablist" aria-label={t('Choisir une image')}>
            {slides.map((s, j) => (
              <button key={j} role="tab" aria-selected={j === k ? 'true' : 'false'} aria-label={t('Image {0} sur {1}', [j + 1, n])} onClick={() => aller(j)} class={classes(j < k && 'vu', j === k && 'actif')}>
                <i key={j === k ? 'a' + tour : 'b'} style={j === k && !pause ? { animationDuration: DUREE + 'ms' } : undefined} class={j === k && pause ? 'fige' : undefined} />
              </button>
            ))}
          </div>
          <button class="heros-pause" onClick={() => setPause(!pause)} aria-label={pause ? t('Reprendre le défilement') : t('Mettre en pause le défilement')}><Icone n={pause ? 'lecture' : 'pause'} /></button>
        </div>
      ) : null}
    </section>
  );
}

