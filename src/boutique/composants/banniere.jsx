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

const DUREE = 6500;
const img = (nom, alt) => ({ type: 'url', src: `photos/${nom}.webp`, srcset: `photos/${nom}-s.webp 900w, photos/${nom}.webp 1600w`, w: 1600, h: 900, alt });

/* Images d'origine, utilisées tant qu'aucune bannière n'a été créée dans l'administration. */
const PAR_DEFAUT = [
  { id: 'port', eyebrow: 'Import Chine → Afrique', title: 'Vos articles voyagent par conteneur jusqu’à vous', cta: 'Voir les nouveautés', collectionId: 'new', image: img('ban-port', 'Port à conteneurs : grues de chargement et porte-conteneurs à quai') },
  { id: 'douane', eyebrow: 'Dédouanement compris', title: 'Transport et douane : on s’occupe de tout', cta: 'Comment ça marche', collectionId: 'aide', image: img('ban-douane', 'Terminal à conteneurs vu du ciel, avec ses grues') },
  { id: 'transit', eyebrow: 'Bukavu · Goma', title: 'Payez par Mobile Money, recevez chez vous', cta: 'Découvrir les rayons', collectionId: '', image: img('ban-transit', 'Camion de marchandises sur une route de montagne') }
];

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
  const slides = perso.length ? perso : PAR_DEFAUT;
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
    <section class="heros" aria-roledescription="carrousel" aria-label={`${c.name} : présentation`}
      onPointerDown={(e) => { x0.current = e.clientX; glisse.current = false; }}
      onPointerUp={(e) => { if (x0.current == null) return; const dx = e.clientX - x0.current; x0.current = null; if (Math.abs(dx) > 45 && n > 1) { glisse.current = true; aller(k + (dx < 0 ? 1 : -1)); } }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') aller(k + 1); if (e.key === 'ArrowLeft') aller(k - 1); }}>
      <div class="heros-fond" aria-hidden="true">
        {slides.map((s, j) => <figure key={s.id || j} class={classes(j === k && 'actif')}><Photo m={s.image} alt="" prioritaire={j === 0} tailles="100vw" /></figure>)}
      </div>
      <div class="heros-voile" aria-hidden="true" />
      <div class="heros-contenu">
        <p class="heros-kicker"><Icone n="avion" />Chine → {zones || c.city}</p>
        <h1 class="heros-marque"><Marque grande /></h1>
        <p class="heros-slogan">{c.tagline}</p>
        <div class="heros-legende" key={k} aria-live="off">
          {b.eyebrow ? <span class="heros-surtitre">{b.eyebrow}</span> : null}
          <p class="heros-titre">{b.title}</p>
          {b.subtitle ? <p class="heros-sous">{b.subtitle}</p> : null}
        </div>
        <div class="heros-actions">
          <button class="btn btn-l heros-cta" onClick={() => { if (!glisse.current) destination(b)(); }}>{b.cta || 'Découvrir'}<Icone n="droite" /></button>
        </div>
      </div>
      {n > 1 ? (
        <div class="heros-controles">
          <div class="heros-progres" role="tablist" aria-label="Choisir une image">
            {slides.map((s, j) => (
              <button key={j} role="tab" aria-selected={j === k ? 'true' : 'false'} aria-label={`Image ${j + 1} sur ${n}`} onClick={() => aller(j)} class={classes(j < k && 'vu', j === k && 'actif')}>
                <i key={j === k ? 'a' + tour : 'b'} style={j === k && !pause ? { animationDuration: DUREE + 'ms' } : undefined} class={j === k && pause ? 'fige' : undefined} />
              </button>
            ))}
          </div>
          <button class="heros-pause" onClick={() => setPause(!pause)} aria-label={pause ? 'Reprendre le défilement' : 'Mettre en pause le défilement'}><Icone n={pause ? 'lecture' : 'pause'} /></button>
        </div>
      ) : null}
    </section>
  );
}

