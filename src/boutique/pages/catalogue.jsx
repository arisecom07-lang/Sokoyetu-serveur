// Sokoyetu (boutique) — parcourir : rayons, un rayon, nouveautés, en stock / import Chine, recherche, favoris.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide } from '../../commun/js/interface.jsx';
import RS from '../../commun/js/recherche.js';
import { pluriel, differer } from '../../commun/js/outils.js';
import { lien, route, retour } from '../routeur.js';
import { cfg, produits, rayons, rayonsParId, favoris, catalogueDisponible, catalogueAJour, catalogueErreur, recherches, memoriserRecherche, effacerRecherches, indexRecherche, chargerPopulaires } from '../etat.js';
import { EnteteBoutique, EntetePage, Pied } from '../composants/cadre.jsx';
import { GrilleProduits, SqueletteGrille, ErreurCatalogue, trier, lienRayon, photoRayon } from '../composants/produits.jsx';
import { PucesSuggestions, useSuggestions, usePopulaires } from '../composants/recherche.jsx';
import { signalerRecherche } from '../visites.js';
import { mesurerEvenement } from '../mesure.js';
import { useSeo } from './commun.jsx';
import { Introuvable } from './introuvable.jsx';

const TRIS = [['pour-vous', 'Pour vous'], ['nouveautes', 'Nouveautés'], ['prix-croissant', 'Prix croissant'], ['prix-decroissant', 'Prix décroissant'], ['promos', 'Promotions']];

function Filtres({ tri, setTri, source, setSource, liste }) {
  const nImport = liste.filter(R.estImport).length; const nLocal = liste.length - nImport;
  return (
    <div class="puces" role="group" aria-label="Trier et filtrer">
      {TRIS.map(([k, t]) => <button key={k} class="puce" aria-pressed={tri === k ? 'true' : 'false'} onClick={() => setTri(k)}>{t}</button>)}
      {nImport && nLocal ? (
        <>
          <span class="puces-sep" aria-hidden="true" />
          <button class="puce" aria-pressed={source === 'local' ? 'true' : 'false'} onClick={() => setSource(source === 'local' ? 'tout' : 'local')}><Icone n="boutique" />En stock</button>
          <button class="puce" aria-pressed={source === 'import' ? 'true' : 'false'} onClick={() => setSource(source === 'import' ? 'tout' : 'import')}><Icone n="avion" />Import Chine</button>
        </>
      ) : null}
    </div>
  );
}

const parSource = (l, s) => (s === 'tout' ? l : l.filter((p) => (s === 'import' ? R.estImport(p) : !R.estImport(p))));

export function Rayons() {
  const rs = rayons.value; const tous = produits.value;
  useSeo(() => ({ titre: 'Rayons', description: `Tous les rayons de ${cfg.value.name} : ${rs.map((r) => r.name).join(', ')}.` }), [rs.length]);
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur">
        <div class="titre-page"><h1 class="titre-serif">Rayons</h1><p class="attenue">{pluriel(tous.length, 'article')} à découvrir</p></div>
        {!catalogueDisponible.value ? (catalogueErreur.value ? <ErreurCatalogue /> : <div class="grille-rayons" aria-busy="true">{[1, 2, 3, 4].map((i) => <div key={i} class="squelette" style={{ aspectRatio: '1' }} />)}</div>)
          : rs.length ? (
            <div class="grille-rayons">
              {rs.map((r, i) => {
                const nb = tous.filter((p) => (p.collectionIds || []).includes(r.id)).length;
                return (
                  <a key={r.id} href={lienRayon(r)} class="tuile-rayon entree" style={{ animationDelay: `${i * 40}ms` }}>
                    <Photo m={photoRayon(r)} alt="" tailles="(min-width: 900px) 25vw, 50vw" />
                    <span class="tr-texte"><b>{r.name}</b><small>{pluriel(nb, 'article')}</small></span>
                  </a>
                );
              })}
              <a href={lien('/nouveautes')} class="tuile-rayon tuile-tout entree"><span class="tr-icone"><Icone n="etincelle" /></span><span class="tr-texte"><b>Tous les articles</b><small>Les derniers arrivages</small></span></a>
            </div>
          ) : <Vide icone="rayons" titre="Aucun rayon pour l’instant" texte="Les rayons de la boutique apparaîtront ici." />}
      </main>
      <Pied />
    </>
  );
}

export function Rayon() {
  const id = route.value.params.id; const r = rayonsParId.value.get(id);
  const [tri, setTri] = useState('pour-vous'); const [source, setSource] = useState('tout');
  const base = produits.value.filter((p) => (p.collectionIds || []).includes(id));
  const liste = parSource(trier(base, tri), source);
  useSeo(() => (r ? { titre: r.name, description: `${r.name} chez ${cfg.value.name} : ${pluriel(base.length, 'article')}, livraison à Bukavu et Goma, paiement Mobile Money.`,
    ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: r.name, mainEntity: { '@type': 'ItemList', numberOfItems: base.length, itemListElement: base.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.title })) } } } : { titre: 'Rayon', noindex: true }), [id, !!r, base.length]);
  if (!r && catalogueAJour.value) return <Introuvable />;
  if (!r || r.visible === false) return <><EntetePage titre="Rayon" repli="/categories" /><main id="contenu" class="page conteneur"><SqueletteGrille /></main></>;
  return (
    <>
      <EntetePage titre={r.name} sous={pluriel(base.length, 'article')} repli="/categories" />
      <main id="contenu" class="page conteneur">
        <Filtres tri={tri} setTri={setTri} source={source} setSource={setSource} liste={base} />
        <div class="espace-haut">
          <GrilleProduits key={tri + source} liste={liste} vide={<Vide icone="etiquette" titre="Aucun article ici" texte={base.length ? 'Essayez un autre filtre.' : 'Ce rayon se remplit bientôt.'} />} />
        </div>
      </main>
      <Pied />
    </>
  );
}

export function Nouveautes() {
  const rs = rayons.value; const [rayon, setRayon] = useState('tout');
  let liste = trier(produits.value, 'nouveautes');
  if (rayon !== 'tout') liste = liste.filter((p) => (p.collectionIds || []).includes(rayon));
  useSeo(() => ({ titre: 'Nouveautés', description: `Les derniers arrivages de ${cfg.value.name} : mode, accessoires et électronique livrés à Bukavu et Goma.` }), []);
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur">
        <div class="titre-page"><h1 class="titre-serif">Nouveautés</h1><p class="attenue">Les derniers arrivages de la boutique</p></div>
        {rs.length ? (
          <div class="puces" role="group" aria-label="Filtrer par rayon">
            <button class="puce" aria-pressed={rayon === 'tout' ? 'true' : 'false'} onClick={() => setRayon('tout')}>Tout</button>
            {rs.map((r) => <button key={r.id} class="puce" aria-pressed={rayon === r.id ? 'true' : 'false'} onClick={() => setRayon(r.id)}>{r.name}</button>)}
          </div>
        ) : null}
        <div class="espace-haut">
          {!catalogueDisponible.value ? <SqueletteGrille /> : <GrilleProduits key={rayon} liste={liste} vide={<Vide icone="etincelle" titre="Pas encore de nouveautés" texte="Revenez bientôt : de nouveaux articles arrivent chaque semaine." />} />}
        </div>
      </main>
      <Pied />
    </>
  );
}

/* Articles en stock (livrés en 24 à 48 h) ou à commander depuis la Chine : les titres de l'accueil mènent ici. */
export function Provenance() {
  const c = cfg.value; const imp = route.value.nom === 'import-chine';
  const rs = rayons.value; const [tri, setTri] = useState('pour-vous'); const [rayon, setRayon] = useState('tout');
  const base = produits.value.filter((p) => (imp ? R.estImport(p) : !R.estImport(p) && R.stockTotal(p) > 0));
  let liste = trier(base, tri);
  if (rayon !== 'tout') liste = liste.filter((p) => (p.collectionIds || []).includes(rayon));
  const titre = imp ? 'Importés de Chine pour vous' : `En stock à ${c.city}`;
  const sous = imp ? `Livrés en ≈ ${c.importDays} jours, douane comprise` : 'Livré en 24 à 48 h';
  const rsUtiles = rs.filter((r) => base.some((p) => (p.collectionIds || []).includes(r.id)));
  useSeo(() => ({ titre, description: imp
    ? `Articles importés de Chine sur commande chez ${c.name} : livrés à Bukavu et Goma en ≈ ${c.importDays} jours, dédouanement compris, paiement Mobile Money.`
    : `Articles en stock à ${c.city} chez ${c.name} : livrés en 24 à 48 h, paiement Mobile Money.` }), [imp, titre]);
  return (
    <>
      <EntetePage titre={titre} sous={pluriel(base.length, 'article')} repli="/" />
      <main id="contenu" class="page conteneur page-provenance" data-source={imp ? 'import' : 'local'}>
        <p class="provenance-sous"><Icone n={imp ? 'avion' : 'camion'} />{sous}</p>
        <div class="puces" role="group" aria-label="Trier">
          {TRIS.map(([k, t]) => <button key={k} class="puce" aria-pressed={tri === k ? 'true' : 'false'} onClick={() => setTri(k)}>{t}</button>)}
        </div>
        {rsUtiles.length > 1 ? (
          <div class="puces espace-haut" role="group" aria-label="Filtrer par rayon">
            <button class="puce" aria-pressed={rayon === 'tout' ? 'true' : 'false'} onClick={() => setRayon('tout')}>Tous les rayons</button>
            {rsUtiles.map((r) => <button key={r.id} class="puce" aria-pressed={rayon === r.id ? 'true' : 'false'} onClick={() => setRayon(r.id)}>{r.name}</button>)}
          </div>
        ) : null}
        <div class="espace-haut">
          {!catalogueDisponible.value ? <SqueletteGrille /> : (
            <GrilleProduits key={tri + rayon} liste={liste} vide={<Vide icone={imp ? 'avion' : 'boutique'} titre="Aucun article ici pour l’instant" texte={base.length ? 'Essayez un autre rayon.' : 'De nouveaux articles arrivent bientôt.'}><a class="btn btn-secondaire" href={lien(imp ? '/en-stock' : '/import-chine')}>{imp ? 'Voir les articles en stock' : 'Voir les articles à commander'}</a></Vide>} />
          )}
        </div>
      </main>
      <Pied />
    </>
  );
}

/*
 * Recherche : résultats pendant la frappe, fautes comprises (« monter » → montre, « saa » → montre). La recherche comprise est
 * annoncée quand un mot a été corrigé ; sans article pour tous les mots, les articles les plus proches. Suggestions en puces,
 * recherches récentes (cet appareil) et populaires (tous les clients) quand le champ est vide.
 */
export function Recherche() {
  const q0 = route.value.query.get('q') || '';
  const [q, setQ] = useState(q0);
  const champ = useRef(null);
  const majAdresse = useMemo(() => differer((v) => { try { history.replaceState(history.state, '', (typeof __DEMO__ !== 'undefined' && __DEMO__ ? '#' : '') + '/recherche' + (v.trim() ? '?q=' + encodeURIComponent(v.trim()) : '')); } catch (e) { } }, 400), []);
  useEffect(() => { const t = setTimeout(() => champ.current && champ.current.focus({ preventScroll: true }), 120); chargerPopulaires(); return () => clearTimeout(t); }, []);
  useSeo(() => ({ titre: 'Recherche', noindex: true }), []);
  const index = indexRecherche.value;
  const ordre = useMemo(() => new Map(trier(produits.value, 'pour-vous').map((p, i) => [p.id, i])), [produits.value]);
  const res = useMemo(() => RS.chercher(index, q), [index, q]);
  const resultats = res.resultats.slice().sort((a, b) => (b.score - a.score) || ((ordre.get(a.p.id) || 0) - (ordre.get(b.p.id) || 0))).map((x) => x.p);
  const sug = useSuggestions(q, 0);
  const populaires = usePopulaires(8);
  const actif = RS.normaliser(q).replace(/[^0-9a-z]+/g, '').length > 0;
  // La recherche est comptée (anonymement) quand on s'arrête de taper, ou tout de suite avec « Rechercher ».
  useEffect(() => {
    if (!actif) return undefined;
    const t = setTimeout(() => signalerRecherche(q, res.complet ? res.resultats.length : 0), 1800);
    return () => clearTimeout(t);
  }, [q]);
  const changer = (v) => { setQ(v); majAdresse(v); };
  const choisir = (t) => { changer(t); memoriserRecherche(t); mesurerEvenement('search', { search_term: t }); signalerRecherche(t, RS.chercher(index, t).resultats.length); champ.current && champ.current.blur(); window.scrollTo(0, 0); };
  const envoyer = (e) => { e.preventDefault(); if (q.trim()) choisir(q.trim()); };
  const puces = (titre, icone, l) => (l.length ? (
    <section class="pile">
      <h2 class="sous-titre">{titre}</h2>
      <div class="rangee-l">{l.map((r) => <button key={r} type="button" class="puce" onClick={() => choisir(r)}><Icone n={icone} />{r}</button>)}</div>
    </section>
  ) : null);
  return (
    <>
      <EnteteBoutique classe="seulement-ordi" />
      <header class="entete entete-recherche seulement-mobile">
        <div class="entete-in">
          <button class="btn-icone" onClick={() => retour('/')} aria-label="Retour"><Icone n="retour" /></button>
          <form role="search" class="recherche-mobile" onSubmit={envoyer}>
            <Icone n="recherche" />
            <input ref={champ} type="search" value={q} onInput={(e) => changer(e.currentTarget.value)} placeholder="Rechercher un article" aria-label="Rechercher un article" enterkeyhint="search" autocomplete="off" />
            {q ? <button type="button" class="btn-icone" aria-label="Effacer" onClick={() => { changer(''); champ.current.focus(); }}><Icone n="fermer" /></button> : null}
          </form>
        </div>
      </header>
      <main id="contenu" class="page conteneur">
        <form role="search" class="recherche-page seulement-ordi" onSubmit={envoyer}>
          <Icone n="recherche" />
          <input type="search" value={q} onInput={(e) => changer(e.currentTarget.value)} placeholder="Rechercher un article, une couleur, un rayon…" aria-label="Rechercher" autocomplete="off" />
        </form>
        {!actif ? (
          <div class="pile-l espace-haut">
            {recherches.value.length ? (
              <section class="pile">
                <div class="entre"><h2 class="sous-titre">Recherches récentes</h2><button class="btn btn-fantome btn-s" onClick={effacerRecherches}>Effacer</button></div>
                <div class="rangee-l">{recherches.value.map((r) => <button key={r} type="button" class="puce" onClick={() => choisir(r)}><Icone n="horloge" />{r}</button>)}</div>
              </section>
            ) : null}
            {puces('Recherches populaires', 'etincelle', populaires.filter((t) => !recherches.value.some((x) => RS.normaliser(x) === RS.normaliser(t))))}
            {rayons.value.length ? (
              <section class="pile">
                <h2 class="sous-titre">Rayons</h2>
                <div class="rangee-l">{rayons.value.map((r) => <a key={r.id} class="puce" href={lienRayon(r)}>{r.name}</a>)}</div>
              </section>
            ) : null}
          </div>
        ) : (
          <>
            <PucesSuggestions termes={sug.termes} q={q} onChoisir={choisir} />
            <div class="espace-haut" role="status">
              {!resultats.length ? null
                : !res.complet ? <p class="attenue">Aucun article ne correspond à tous les mots de « {q.trim()} ». Voici les plus proches :</p>
                : res.correction ? <p class="recherche-correction">{pluriel(resultats.length, 'résultat')} pour « <b>{res.correction}</b> » <span class="attenue">· vous avez écrit « {q.trim()} »</span></p>
                : <p class="attenue">{pluriel(resultats.length, 'résultat')} pour « {q.trim()} »</p>}
            </div>
            <div class="espace-haut"><GrilleProduits key={q} liste={resultats} vide={(
              <Vide icone="recherche" titre="Aucun article trouvé" texte={populaires.length ? 'Essayez un autre mot, ou l’une des recherches de nos clients :' : 'Essayez un autre mot, par exemple « robe », « montre » ou « sac ».'}>
                {populaires.length ? <div class="rangee-l centre">{populaires.slice(0, 5).map((t) => <button key={t} type="button" class="puce" onClick={() => choisir(t)}><Icone n="etincelle" />{t}</button>)}</div> : null}
                {rayons.value.length ? <a class="btn btn-secondaire" href={lien('/categories')}>Parcourir les rayons</a> : null}
              </Vide>
            )} /></div>
          </>
        )}
      </main>
    </>
  );
}

export function Favoris() {
  const liste = produits.value.filter((p) => favoris.value.has(p.id));
  useSeo(() => ({ titre: 'Mes favoris', noindex: true }), []);
  return (
    <>
      <EntetePage titre="Mes favoris" sous={liste.length ? pluriel(liste.length, 'article') : ''} repli="/compte" />
      <main id="contenu" class="page conteneur">
        <GrilleProduits liste={liste} vide={<Vide icone="coeur" titre="Aucun favori pour l’instant" texte="Touchez le cœur d’un article pour le retrouver ici, même plus tard."><a class="btn btn-primaire" href={lien('/')}>Découvrir la boutique</a></Vide>} />
      </main>
      <Pied />
    </>
  );
}
