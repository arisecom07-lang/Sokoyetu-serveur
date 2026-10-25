// Sokoyetu (boutique) — accueil.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide } from '../../commun/js/interface.jsx';
import { pluriel } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { cfg, produits, rayons, catalogueDisponible } from '../etat.js';
import { Banniere } from '../composants/banniere.jsx';
import { EnteteBoutique, Pied, ETAPES_IMPORT, ouvrirCommentCaMarche } from '../composants/cadre.jsx';
import { CarteProduit, GrilleProduits, SqueletteGrille, trier, lienRayon, photoRayon } from '../composants/produits.jsx';
import { CarteInstallation } from '../installation.jsx';
import { useSeo } from './commun.jsx';

/* Rangée « En stock » ou « Importés de Chine » : le titre est un lien vers la liste complète. */
function Rangee({ titre, sous, icone, liste, lienTout, source }) {
  if (liste.length < 3) return null;
  return (
    <section class={source ? 'conteneur section rangee-source' : 'conteneur section'} data-source={source}>
      <div class="section-tete">
        <div>
          <h2 class="titre-section">{lienTout ? <a class="titre-lien" href={lienTout}>{titre.replace(/\S+$/, '')}<span class="insecable">{titre.split(' ').pop()}<Icone n="droite" /></span></a> : titre}</h2>
          {sous ? <p class="section-sous"><Icone n={icone} />{sous}</p> : null}
        </div>
        {lienTout && !source ? <a class="lien-tout" href={lienTout}>Tout voir<Icone n="droite" /></a> : null}
      </div>
      <div class="rangee-produits defile-h">{liste.slice(0, 10).map((p, i) => <CarteProduit key={p.id} p={p} rang={i} />)}</div>
    </section>
  );
}

export function Accueil() {
  const c = cfg.value; const tous = produits.value; const rs = rayons.value;
  const [flux, setFlux] = useState('pour-vous');
  useSeo((c) => ({
    titre: '', description: `${c.name}, la boutique en ligne de Bukavu et Goma : mode, accessoires, montres, sacs, électronique. Articles en stock ou importés de Chine en ~${c.importDays} jours, paiement Mobile Money.`,
    ld: { '@context': 'https://schema.org', '@type': 'OnlineStore', name: c.name, description: c.tagline, url: location.origin + '/', currenciesAccepted: 'USD', paymentAccepted: 'Mobile Money',
      areaServed: c.zones.filter((z) => !z.pickup).map((z) => z.name), address: { '@type': 'PostalAddress', addressLocality: c.city, addressCountry: 'CD' } }
  }), [c.name, c.tagline]);

  const liste = trier(tous, flux === 'nouveautes' ? 'nouveautes' : flux === 'promos' ? 'promos' : 'pour-vous');
  const locaux = trier(tous.filter((p) => !R.estImport(p) && R.stockTotal(p) > 0), 'pour-vous');
  const imports = trier(tous.filter(R.estImport), 'pour-vous');
  const nbPromos = tous.filter((p) => R.pourcentRemise(p) > 0).length;

  return (
    <>
      {c.announcement ? <div class="annonce"><Icone n="camion" /><span>{c.announcement}</span></div> : null}
      <EnteteBoutique accueil />
      <main id="contenu" class="page page-accueil">
        <div class="conteneur-heros"><Banniere /></div>

        <section class="conteneur section confiance" aria-label="Comment ça marche">
          <ol class="etapes-import" tabIndex={0} aria-label="Les quatre étapes, de la Chine jusqu’à chez vous">
            {ETAPES_IMPORT.map(([ic, t, s], i) => <li key={i}><span class="ei-icone"><Icone n={ic} /></span><div><b>{t}</b><p>{s}</p></div></li>)}
          </ol>
          <button class="lien-tout seulement-mobile" onClick={ouvrirCommentCaMarche}>En savoir plus<Icone n="droite" /></button>
        </section>

        {rs.length ? (
          <section class="conteneur section">
            <div class="section-tete"><h2 class="titre-section">Nos rayons</h2><a class="lien-tout" href={lien('/categories')}>Tout voir<Icone n="droite" /></a></div>
            <div class="rayons-rangee defile-h">
              {rs.map((r) => {
                const nb = tous.filter((p) => (p.collectionIds || []).includes(r.id)).length;
                return (
                  <a key={r.id} href={lienRayon(r)} class="rayon-rond">
                    <span class="rr-photo"><Photo m={photoRayon(r)} alt="" tailles="96px" /></span>
                    <b>{r.name}</b><small>{pluriel(nb, 'article')}</small>
                  </a>
                );
              })}
            </div>
          </section>
        ) : null}

        <CarteInstallation />

        <Rangee titre={`En stock à ${c.city}`} sous="Livré en 24 à 48 h" icone="camion" liste={locaux} source="local" lienTout={lien('/en-stock')} />
        <Rangee titre="Importés de Chine pour vous" sous={`Livrés en ≈ ${c.importDays} jours, douane comprise`} icone="avion" liste={imports} source="import" lienTout={lien('/import-chine')} />

        <section class="conteneur section" id="selection">
          <div class="section-tete"><h2 class="titre-section">Toute la boutique</h2></div>
          <div class="puces" role="group" aria-label="Trier la sélection">
            {[['pour-vous', 'Pour vous'], ['nouveautes', 'Nouveautés'], ...(nbPromos ? [['promos', 'Promotions']] : [])].map(([k, t]) => (
              <button key={k} class="puce" aria-pressed={flux === k ? 'true' : 'false'} onClick={() => setFlux(k)}>{t}{k === 'promos' ? <span class="n">{nbPromos}</span> : null}</button>
            ))}
          </div>
          <div class="espace-haut">
            {!catalogueDisponible.value ? <SqueletteGrille /> : (
              <GrilleProduits key={flux} liste={liste} vide={<Vide icone="boutique" titre="La boutique se prépare" texte="Les premiers articles arrivent très bientôt. Revenez nous voir !" />} />
            )}
          </div>
        </section>
      </main>
      <Pied />
    </>
  );
}
