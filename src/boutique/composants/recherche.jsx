// Sokoyetu (boutique) — recherche : suggestions pendant la frappe, d'après le catalogue (fautes comprises) et les recherches
// fréquentes des clients. Sur ordinateur, une liste déroulante sous le champ de l'en-tête ; sur téléphone, des puces.
import { useMemo, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import RS from '../../commun/js/recherche.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { dollars } from '../../commun/js/outils.js';
import { naviguer, route } from '../routeur.js';
import { indexRecherche, recherchesPopulaires, chargerPopulaires, recherches, memoriserRecherche } from '../etat.js';
import { mesurerEvenement } from '../mesure.js';

const assez = (q) => RS.normaliser(q).replace(/[^0-9a-z]+/g, '').length >= 2;

/* Lance une recherche : gardée dans les recherches récentes de l'appareil, mesurée si la mesure d'audience est acceptée. */
export function allerRecherche(q) {
  const t = String(q || '').trim();
  if (t) { memoriserRecherche(t); mesurerEvenement('search', { search_term: t }); }
  naviguer('/recherche' + (t ? '?q=' + encodeURIComponent(t) : ''), { remplacer: route.value.nom === 'recherche' });
}

/* Ce qu'on propose pour un texte tapé : expressions du catalogue et premiers articles trouvés. */
export function useSuggestions(q, nArticles = 4) {
  const index = indexRecherche.value; const populaires = recherchesPopulaires.value;
  return useMemo(() => {
    if (!assez(q)) return { termes: [], articles: [], total: 0 };
    const r = RS.chercher(index, q);
    return { termes: RS.suggestions(index, q, populaires, 6), articles: r.complet ? r.resultats.slice(0, nArticles).map((x) => x.p) : [], total: r.complet ? r.resultats.length : 0 };
  }, [q, index, populaires]);
}

/* Recherches populaires montrables : mots du catalogue qui trouvent des articles (voir recherche.js). */
export const usePopulaires = (max = 8) => {
  const index = indexRecherche.value; const termes = recherchesPopulaires.value;
  return useMemo(() => RS.populairesSures(index, termes, max), [index, termes, max]);
};

/* Suggestion affichée : ce qui complète le texte tapé est en gras. */
export function TexteSuggestion({ texte, q }) {
  const n = RS.normaliser(q).trim();
  if (n && RS.normaliser(texte).indexOf(n) === 0) return <span class="sug-texte">{texte.slice(0, n.length)}<b>{texte.slice(n.length)}</b></span>;
  return <span class="sug-texte"><b>{texte}</b></span>;
}

const cheminProduit = (p) => `/p/${encodeURIComponent(p.id)}/${R.slug(p.title)}`;

/*
 * Champ de recherche de l'en-tête (ordinateur), avec sa liste de suggestions (motif « combobox » : flèches haut et bas,
 * Entrée pour choisir, Échap pour fermer). Vide : recherches récentes et populaires ; en tapant : expressions, articles,
 * et « Voir tous les résultats ».
 */
export function RechercheOrdi() {
  const [q, setQ] = useState(route.value.nom === 'recherche' ? route.value.query.get('q') || '' : '');
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const champ = useRef(null);
  const sug = useSuggestions(q);
  const populaires = usePopulaires(6);
  const recentes = recherches.value.slice(0, 5);
  const groupes = assez(q)
    ? [['Suggestions', sug.termes.map((t) => ({ type: 'terme', texte: t, icone: 'recherche' }))],
      ['Articles', sug.articles.map((p) => ({ type: 'article', p }))],
      ['', q.trim() ? [{ type: 'tout', texte: q.trim(), icone: 'droite' }] : []]]
    : [['Recherches récentes', recentes.map((t) => ({ type: 'recente', texte: t, icone: 'horloge' }))],
      ['Recherches populaires', populaires.filter((t) => !recentes.some((x) => RS.normaliser(x) === RS.normaliser(t))).map((t) => ({ type: 'populaire', texte: t, icone: 'etincelle' }))]];
  const options = groupes.flatMap(([, l]) => l);
  const montre = ouvert && options.length > 0;
  const fermer = () => { setOuvert(false); setActif(-1); };
  const choisir = (o) => {
    fermer();
    if (o.type === 'article') { naviguer(cheminProduit(o.p)); champ.current && champ.current.blur(); return; }
    setQ(o.texte); allerRecherche(o.texte); champ.current && champ.current.blur();
  };
  const touche = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!ouvert) { setOuvert(true); return; }
      if (!options.length) return;
      setActif((a) => (e.key === 'ArrowDown' ? (a + 1) % options.length : (a <= 0 ? options.length - 1 : a - 1)));
    } else if (e.key === 'Escape') { if (montre) { e.preventDefault(); fermer(); } }
    else if (e.key === 'Enter' && montre && actif >= 0 && options[actif]) { e.preventDefault(); choisir(options[actif]); }
  };
  let i = -1;
  return (
    <form class="recherche-ordi" role="search" onSubmit={(e) => { e.preventDefault(); fermer(); allerRecherche(q); champ.current && champ.current.blur(); }}>
      <Icone n="recherche" />
      <input ref={champ} type="search" value={q} placeholder="Rechercher un article, un rayon…" aria-label="Rechercher dans la boutique" enterkeyhint="search" autocomplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={montre ? 'true' : 'false'} aria-controls="suggestions-ordi" aria-activedescendant={montre && actif >= 0 ? 'sug-' + actif : undefined}
        onInput={(e) => { setQ(e.currentTarget.value); setOuvert(true); setActif(-1); }} onFocus={() => { setOuvert(true); chargerPopulaires(); }} onBlur={fermer} onKeyDown={touche} />
      <div class="suggestions-ordi" id="suggestions-ordi" role="listbox" aria-label="Suggestions de recherche" hidden={!montre} onMouseDown={(e) => e.preventDefault()}>
        {groupes.map(([titre, l]) => (l.length ? (
          <div key={titre || 'fin'} role="group" aria-label={titre || undefined} class="sug-groupe">
            {titre ? <div class="sug-titre" aria-hidden="true">{titre}</div> : null}
            {l.map((o) => {
              i++; const id = 'sug-' + i; const k = i;
              if (o.type === 'article') {
                const pa = R.prixAffiche(o.p, '', '', Date.now());
                return (
                  <div key={id} id={id} role="option" aria-selected={actif === k ? 'true' : 'false'} class="sug-option sug-article" onClick={() => choisir(o)} onMouseEnter={() => setActif(k)}>
                    <span class="sug-vignette"><Photo m={R.imagePrincipale(o.p)} alt="" tailles="44px" /></span>
                    <span class="sug-texte">{o.p.title}</span><span class="sug-prix">{pa.des ? 'dès ' : ''}{dollars(pa.prix)}</span>
                  </div>
                );
              }
              return (
                <div key={id} id={id} role="option" aria-selected={actif === k ? 'true' : 'false'} class={'sug-option' + (o.type === 'tout' ? ' sug-tout' : '')} onClick={() => choisir(o)} onMouseEnter={() => setActif(k)}>
                  <Icone n={o.icone} />
                  {o.type === 'tout' ? <span class="sug-texte">{sug.total ? `Voir les ${sug.total} résultats pour « ${o.texte} »` : `Rechercher « ${o.texte} »`}</span>
                    : o.type === 'terme' ? <TexteSuggestion texte={o.texte} q={q} /> : <span class="sug-texte">{o.texte}</span>}
                </div>
              );
            })}
          </div>
        ) : null))}
      </div>
    </form>
  );
}

/* Puces de suggestions sous le champ (page Recherche, téléphone et ordinateur). */
export function PucesSuggestions({ termes, q, onChoisir }) {
  if (!termes.length) return null;
  return (
    <div class="puces-suggestions" role="group" aria-label="Suggestions de recherche">
      {termes.map((t) => <button key={t} type="button" class="puce" onClick={() => onChoisir(t)}><Icone n="recherche" /><TexteSuggestion texte={t} q={q} /></button>)}
    </div>
  );
}
