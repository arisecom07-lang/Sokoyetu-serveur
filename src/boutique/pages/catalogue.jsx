// Sokoyetu (boutique) — parcourir : rayons, un rayon, nouveautés, en stock / import Chine, recherche, favoris.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide } from '../../commun/js/interface.jsx';
import { pluriel, normaliser, differer } from '../../commun/js/outils.js';
import { lien, route, retour } from '../routeur.js';
import { cfg, produits, rayons, rayonsParId, favoris, catalogueDisponible, catalogueAJour, catalogueErreur, recherches, memoriserRecherche, effacerRecherches } from '../etat.js';
import { EnteteBoutique, EntetePage, Pied } from '../composants/cadre.jsx';
import { GrilleProduits, SqueletteGrille, ErreurCatalogue, trier, lienRayon, photoRayon } from '../composants/produits.jsx';
import { useSeo } from './commun.jsx';
import { Introuvable } from './introuvable.jsx';
import { t, tx, aTraduire } from '../../commun/js/langue.js';

const TRIS = [['pour-vous', aTraduire('Pour vous')], ['nouveautes', aTraduire('Nouveautés')], ['prix-croissant', aTraduire('Prix croissant')], ['prix-decroissant', aTraduire('Prix décroissant')], ['promos', aTraduire('Promotions')]];

function Filtres({ tri, setTri, source, setSource, liste }) {
  const nImport = liste.filter(R.estImport).length; const nLocal = liste.length - nImport;
  return (
    <div class="puces" role="group" aria-label={t('Trier et filtrer')}>
      {TRIS.map(([k, libelle]) => <button key={k} class="puce" aria-pressed={tri === k ? 'true' : 'false'} onClick={() => setTri(k)}>{t(libelle)}</button>)}
      {nImport && nLocal ? (
        <>
          <span class="puces-sep" aria-hidden="true" />
          <button class="puce" aria-pressed={source === 'local' ? 'true' : 'false'} onClick={() => setSource(source === 'local' ? 'tout' : 'local')}><Icone n="boutique" />{t('En stock')}</button>
          <button class="puce" aria-pressed={source === 'import' ? 'true' : 'false'} onClick={() => setSource(source === 'import' ? 'tout' : 'import')}><Icone n="avion" />{t('Import Chine')}</button>
        </>
      ) : null}
    </div>
  );
}

const parSource = (l, s) => (s === 'tout' ? l : l.filter((p) => (s === 'import' ? R.estImport(p) : !R.estImport(p))));

export function Rayons() {
  const rs = rayons.value; const tous = produits.value;
  useSeo(() => ({ titre: t('Rayons'), description: t('Tous les rayons de {0} : {1}.', [cfg.value.name, rs.map((r) => r.name).join(', ')]) }), [rs.length]);
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur">
        <div class="titre-page"><h1 class="titre-serif">{t('Rayons')}</h1><p class="attenue">{tx('{0} à découvrir', [pluriel(tous.length, 'article')])}</p></div>
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
              <a href={lien('/nouveautes')} class="tuile-rayon tuile-tout entree"><span class="tr-icone"><Icone n="etincelle" /></span><span class="tr-texte"><b>{t('Tous les articles')}</b><small>{t('Les derniers arrivages')}</small></span></a>
            </div>
          ) : <Vide icone="rayons" titre={t('Aucun rayon pour l’instant')} texte={t('Les rayons de la boutique apparaîtront ici.')} />}
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
  useSeo(() => (r ? { titre: r.name, description: t('{0} chez {1} : {2}, livraison à Bukavu et Goma, paiement Mobile Money.', [r.name, cfg.value.name, pluriel(base.length, 'article')]),
    ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: r.name, mainEntity: { '@type': 'ItemList', numberOfItems: base.length, itemListElement: base.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.title })) } } } : { titre: t('Rayon'), noindex: true }), [id, !!r, base.length]);
  if (!r && catalogueAJour.value) return <Introuvable />;
  if (!r || r.visible === false) return <><EntetePage titre={t('Rayon')} repli="/categories" /><main id="contenu" class="page conteneur"><SqueletteGrille /></main></>;
  return (
    <>
      <EntetePage titre={r.name} sous={pluriel(base.length, 'article')} repli="/categories" />
      <main id="contenu" class="page conteneur">
        <Filtres tri={tri} setTri={setTri} source={source} setSource={setSource} liste={base} />
        <div class="espace-haut">
          <GrilleProduits key={tri + source} liste={liste} vide={<Vide icone="etiquette" titre={t('Aucun article ici')} texte={base.length ? t('Essayez un autre filtre.') : t('Ce rayon se remplit bientôt.')} />} />
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
  useSeo(() => ({ titre: t('Nouveautés'), description: t('Les derniers arrivages de {0} : mode, accessoires et électronique livrés à Bukavu et Goma.', [cfg.value.name]) }), []);
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur">
        <div class="titre-page"><h1 class="titre-serif">{t('Nouveautés')}</h1><p class="attenue">{t('Les derniers arrivages de la boutique')}</p></div>
        {rs.length ? (
          <div class="puces" role="group" aria-label={t('Filtrer par rayon')}>
            <button class="puce" aria-pressed={rayon === 'tout' ? 'true' : 'false'} onClick={() => setRayon('tout')}>{t('Tout')}</button>
            {rs.map((r) => <button key={r.id} class="puce" aria-pressed={rayon === r.id ? 'true' : 'false'} onClick={() => setRayon(r.id)}>{r.name}</button>)}
          </div>
        ) : null}
        <div class="espace-haut">
          {!catalogueDisponible.value ? <SqueletteGrille /> : <GrilleProduits key={rayon} liste={liste} vide={<Vide icone="etincelle" titre={t('Pas encore de nouveautés')} texte={t('Revenez bientôt : de nouveaux articles arrivent chaque semaine.')} />} />}
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
  const titre = imp ? t('Importés de Chine pour vous') : t('En stock à {0}', [c.city]);
  const sous = imp ? t('Livrés en ≈ {0} jours, douane comprise', [c.importDays]) : t('Livré en 24 à 48 h');
  const rsUtiles = rs.filter((r) => base.some((p) => (p.collectionIds || []).includes(r.id)));
  useSeo(() => ({ titre, description: imp
    ? t('Articles importés de Chine sur commande chez {0} : livrés à Bukavu et Goma en ≈ {1} jours, dédouanement compris, paiement Mobile Money.', [c.name, c.importDays])
    : t('Articles en stock à {0} chez {1} : livrés en 24 à 48 h, paiement Mobile Money.', [c.city, c.name]) }), [imp, titre]);
  return (
    <>
      <EntetePage titre={titre} sous={pluriel(base.length, 'article')} repli="/" />
      <main id="contenu" class="page conteneur page-provenance" data-source={imp ? 'import' : 'local'}>
        <p class="provenance-sous"><Icone n={imp ? 'avion' : 'camion'} />{sous}</p>
        <div class="puces" role="group" aria-label={t('Trier')}>
          {TRIS.map(([k, libelle]) => <button key={k} class="puce" aria-pressed={tri === k ? 'true' : 'false'} onClick={() => setTri(k)}>{t(libelle)}</button>)}
        </div>
        {rsUtiles.length > 1 ? (
          <div class="puces espace-haut" role="group" aria-label={t('Filtrer par rayon')}>
            <button class="puce" aria-pressed={rayon === 'tout' ? 'true' : 'false'} onClick={() => setRayon('tout')}>{t('Tous les rayons')}</button>
            {rsUtiles.map((r) => <button key={r.id} class="puce" aria-pressed={rayon === r.id ? 'true' : 'false'} onClick={() => setRayon(r.id)}>{r.name}</button>)}
          </div>
        ) : null}
        <div class="espace-haut">
          {!catalogueDisponible.value ? <SqueletteGrille /> : (
            <GrilleProduits key={tri + rayon} liste={liste} vide={<Vide icone={imp ? 'avion' : 'boutique'} titre={t('Aucun article ici pour l’instant')} texte={base.length ? t('Essayez un autre rayon.') : t('De nouveaux articles arrivent bientôt.')}><a class="btn btn-secondaire" href={lien(imp ? '/en-stock' : '/import-chine')}>{imp ? t('Voir les articles en stock') : t('Voir les articles à commander')}</a></Vide>} />
          )}
        </div>
      </main>
      <Pied />
    </>
  );
}

export function Recherche() {
  const q0 = route.value.query.get('q') || '';
  const [q, setQ] = useState(q0);
  const champ = useRef(null);
  const majAdresse = useMemo(() => differer((v) => { try { history.replaceState(history.state, '', (typeof __DEMO__ !== 'undefined' && __DEMO__ ? '#' : '') + '/recherche' + (v.trim() ? '?q=' + encodeURIComponent(v.trim()) : '')); } catch (e) { } }, 400), []);
  useEffect(() => { const t = setTimeout(() => champ.current && champ.current.focus({ preventScroll: true }), 120); return () => clearTimeout(t); }, []);
  useSeo(() => ({ titre: t('Recherche'), noindex: true }), []);
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const resultats = mots.length ? trier(produits.value.filter((p) => {
    const texte = normaliser([p.title, p.tags, p.description, (p.collectionIds || []).map((id) => (rayonsParId.value.get(id) || {}).name).join(' '), ((p.options && p.options.colors) || []).map((c) => c.name).join(' ')].join(' '));
    return mots.every((m) => texte.includes(m));
  }), 'pour-vous') : [];
  const envoyer = (e) => { e.preventDefault(); memoriserRecherche(q); champ.current && champ.current.blur(); };
  return (
    <>
      <EnteteBoutique classe="seulement-ordi" />
      <header class="entete entete-recherche seulement-mobile">
        <div class="entete-in">
          <button class="btn-icone" onClick={() => retour('/')} aria-label={t('Retour')}><Icone n="retour" /></button>
          <form role="search" class="recherche-mobile" onSubmit={envoyer}>
            <Icone n="recherche" />
            <input ref={champ} type="search" value={q} onInput={(e) => { setQ(e.currentTarget.value); majAdresse(e.currentTarget.value); }} placeholder={t('Rechercher un article')} aria-label={t('Rechercher un article')} enterkeyhint="search" autocomplete="off" />
            {q ? <button type="button" class="btn-icone" aria-label={t('Effacer')} onClick={() => { setQ(''); majAdresse(''); champ.current.focus(); }}><Icone n="fermer" /></button> : null}
          </form>
        </div>
      </header>
      <main id="contenu" class="page conteneur">
        <form role="search" class="recherche-page seulement-ordi" onSubmit={envoyer}>
          <Icone n="recherche" />
          <input type="search" value={q} onInput={(e) => { setQ(e.currentTarget.value); majAdresse(e.currentTarget.value); }} placeholder={t('Rechercher un article, une couleur, un rayon…')} aria-label={t('Rechercher')} />
        </form>
        {!mots.length ? (
          <div class="pile-l espace-haut">
            {recherches.value.length ? (
              <section class="pile">
                <div class="entre"><h2 class="sous-titre">{t('Recherches récentes')}</h2><button class="btn btn-fantome btn-s" onClick={effacerRecherches}>{t('Effacer')}</button></div>
                <div class="rangee-l">{recherches.value.map((r) => <button key={r} class="puce" onClick={() => { setQ(r); majAdresse(r); }}><Icone n="horloge" />{r}</button>)}</div>
              </section>
            ) : null}
            {rayons.value.length ? (
              <section class="pile">
                <h2 class="sous-titre">{t('Rayons')}</h2>
                <div class="rangee-l">{rayons.value.map((r) => <a key={r.id} class="puce" href={lienRayon(r)}>{r.name}</a>)}</div>
              </section>
            ) : null}
          </div>
        ) : (
          <>
            <p class="attenue espace-haut" role="status">{tx('{0} pour « {1} »', [pluriel(resultats.length, 'résultat'), q.trim()])}</p>
            <div class="espace-haut"><GrilleProduits key={q} liste={resultats} vide={<Vide icone="recherche" titre={t('Aucun article trouvé')} texte={t('Essayez un autre mot, par exemple « robe », « montre » ou « sac ».')}>{rayons.value.length ? <a class="btn btn-secondaire" href={lien('/categories')}>{t('Parcourir les rayons')}</a> : null}</Vide>} /></div>
          </>
        )}
      </main>
    </>
  );
}

export function Favoris() {
  const liste = produits.value.filter((p) => favoris.value.has(p.id));
  useSeo(() => ({ titre: t('Mes favoris'), noindex: true }), []);
  return (
    <>
      <EntetePage titre={t('Mes favoris')} sous={liste.length ? pluriel(liste.length, 'article') : ''} repli="/compte" />
      <main id="contenu" class="page conteneur">
        <GrilleProduits liste={liste} vide={<Vide icone="coeur" titre={t('Aucun favori pour l’instant')} texte={t('Touchez le cœur d’un article pour le retrouver ici, même plus tard.')}><a class="btn btn-primaire" href={lien('/')}>{t('Découvrir la boutique')}</a></Vide>} />
      </main>
      <Pied />
    </>
  );
}
