// Sokoyetu (boutique) — panier.
import { useEffect } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide, Quantite, toast } from '../../commun/js/interface.jsx';
import { dollars, francs, pluriel } from '../../commun/js/outils.js';
import { lien, naviguer } from '../routeur.js';
import { cfg, lignesPanier, nbArticles, nbACommander, aCommander, changerQuantite, cocherLigne, cocherSeulement, produitsParId, produits, panier, nettoyerPanier, catalogueAJour } from '../etat.js';
import { EnteteBoutique, BarreAction, Pied } from '../composants/cadre.jsx';
import { GrilleProduits, lienProduit, trier } from '../composants/produits.jsx';
import { mesurerEvenement } from '../mesure.js';
import { useSeo } from './commun.jsx';

/* Totaux estimés dans le navigateur, sur les articles cochés (le serveur recalcule tout avant le paiement). */
export function devisLocal({ zoneId, remise } = {}) {
  const m = produitsParId.value;
  return R.devis({ cfg: cfg.value, produit: (id) => m.get(id) || null, lignes: aCommander.value, zoneId: zoneId || (cfg.value.zones[0] || {}).id, code: remise ? remise.code : '', remise: remise ? { ...remise, active: true } : null, maintenant: Date.now() });
}

export function Panier() {
  const c = cfg.value; const lignes = lignesPanier.value;
  useEffect(() => { nettoyerPanier(); }, [catalogueAJour.value]);
  useSeo(() => ({ titre: 'Panier', noindex: true }), []);
  const dv = devisLocal();
  // Les problèmes du devis sont repérés par leur rang parmi les articles cochés.
  const cles = aCommander.value.map((l) => l.cle);
  const problemes = new Map(dv.problemes.filter((x) => x.ligne != null).map((x) => [cles[x.ligne], x]));
  const n = nbACommander.value; const choisies = lignes.filter((l) => l.coche).length;
  const bloque = !n || dv.problemes.some((x) => x.code === 'stock' || x.code === 'option' || x.code === 'article');
  const restent = nbArticles.value - n;
  // Stock à Bukavu et import de Chine n'ont pas le même délai : on peut commander l'un maintenant, l'autre plus tard.
  const avecImport = lignes.filter((l) => l.p && R.estImport(l.p)); const melange = avecImport.length > 0 && avecImport.length < lignes.length;
  const estImp = (l) => { const p = produitsParId.value.get(l.productId); return !!p && R.estImport(p); };
  const toutes = choisies === lignes.length;
  const seulBukavu = melange && lignes.every((l) => l.coche === !(l.p && R.estImport(l.p)));
  const seulImport = melange && lignes.every((l) => l.coche === !!(l.p && R.estImport(l.p)));
  const commander = () => { mesurerEvenement('begin_checkout', { value: dv.sousTotal, currency: 'USD' }); naviguer('/commander'); };
  const seuil = R.num(c.freeShippingOver);
  // Hors livraison (choisie à l'étape suivante) : frais de service sur le panier après réduction.
  const frais = R.fraisService(c, dv.sousTotal); const estime = R.arrondi(dv.sousTotal + frais);
  const suggestions = trier(produits.value.filter((p) => !panier.value.some((l) => l.productId === p.id)), 'pour-vous').slice(0, 8);

  if (!lignes.length) {
    return (
      <>
        <EnteteBoutique />
        <main id="contenu" class="page conteneur">
          <div class="titre-page"><h1 class="titre-serif">Panier</h1></div>
          <Vide icone="sac" titre="Votre panier est vide" texte="Ajoutez vos coups de cœur : ils vous attendront ici, même si vous fermez l’application.">
            <a class="btn btn-primaire" href={lien('/')}>Découvrir la boutique</a><a class="btn btn-secondaire" href={lien('/categories')}>Parcourir les rayons</a>
          </Vide>
          {suggestions.length ? <section class="section"><div class="section-tete"><h2 class="titre-section">Nos suggestions</h2></div><GrilleProduits liste={suggestions} parPage={8} prioritaires={0} /></section> : null}
        </main>
        <Pied />
      </>
    );
  }

  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur page-panier">
        <div class="titre-page"><h1 class="titre-serif">Panier <span class="discret">({nbArticles.value})</span></h1><p class="attenue">Livraison à {c.zones.filter((z) => !z.pickup).map((z) => z.name).join(' et ') || c.city}</p></div>
        <div class="panier-grille">
          <div class="pile">
          {lignes.length > 1 ? (
            <div class="panier-choix">
              <div class="case" data-coche={toutes ? 'oui' : choisies ? 'partiel' : 'non'}>
                <button type="button" class="case-boite" role="checkbox" aria-checked={toutes ? 'true' : choisies ? 'mixed' : 'false'} aria-labelledby="panier-tout" onClick={() => cocherSeulement(() => !toutes)}><Icone n={!toutes && choisies ? 'moins' : 'coche'} /></button>
                <span id="panier-tout" onClick={() => cocherSeulement(() => !toutes)}>Tout sélectionner <span class="discret">({choisies}/{lignes.length})</span></span>
              </div>
              {melange ? (
                <div class="panier-filtres" role="group" aria-label="Choisir selon la provenance">
                  <button type="button" class="puce" data-source="local" aria-pressed={seulBukavu ? 'true' : 'false'} onClick={() => cocherSeulement((l) => !estImp(l))}><Icone n="camion" />En stock à Bukavu</button>
                  <button type="button" class="puce" data-source="import" aria-pressed={seulImport ? 'true' : 'false'} onClick={() => cocherSeulement(estImp)}><Icone n="avion" />Import Chine</button>
                </div>
              ) : null}
            </div>
          ) : null}
          <ul class="panier-lignes" aria-label="Articles du panier">
            {lignes.map((l) => {
              const p = l.p; if (!p) return null;
              const pb = problemes.get(l.cle); const imp = R.estImport(p);
              const st = imp ? R.MAX_QTE : R.stockDe(p, l.color, l.size);
              const variante = [l.color, l.size].filter(Boolean).join(' · ');
              return (
                <li key={l.cle} class="panier-ligne entree" data-coche={l.coche ? 'oui' : 'non'}>
                  <div class="case pl-case" data-coche={l.coche ? 'oui' : 'non'}>
                    <button type="button" class="case-boite" role="checkbox" aria-checked={l.coche ? 'true' : 'false'} aria-label={`Commander ${p.title}${variante ? ' (' + variante + ')' : ''} maintenant`} onClick={() => cocherLigne(l.cle, !l.coche)}><Icone n="coche" /></button>
                  </div>
                  <a href={lienProduit(p)} class="pl-photo" aria-label={`Voir ${p.title}`}><Photo m={R.imagePrincipale(p)} alt="" tailles="96px" /></a>
                  <div class="pl-texte">
                    <a href={lienProduit(p)} class="pl-titre">{p.title}</a>
                    {variante ? <span class="pl-variante">{variante}</span> : null}
                    <span class="pl-delai">{imp ? <><Icone n="avion" />Import · ≈ {c.importDays} jours</> : <><Icone n="camion" />Livré en 24–48 h</>}</span>
                    {!l.coche ? <span class="pl-plus-tard">Reste dans le panier pour plus tard</span> : null}
                    {pb ? <p class="champ-erreur"><Icone n="alerte" />{pb.message}</p> : null}
                    <div class="pl-bas">
                      <Quantite petit supprimer valeur={l.qty} max={Math.min(R.MAX_QTE, Math.max(l.qty, st))} libelle={`Quantité de ${p.title}`}
                        onChange={(q) => { changerQuantite(l.cle, q); if (q <= 0) toast('Article retiré du panier', { icone: 'poubelle' }); }} />
                      <span class="prix">{dollars(R.num(p.price) * l.qty)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
          <aside class="panier-resume">
            <div class="carte">
              <h2 class="carte-titre"><Icone n="recu" />Récapitulatif</h2>
              <dl class="montants">
                <div><dt>Sous-total ({pluriel(n, 'article')}{restent ? ' choisi' + (n > 1 ? 's' : '') : ''})</dt><dd class="num">{dollars(dv.sousTotal)}</dd></div>
                <div><dt>Livraison</dt><dd class="attenue">Choisie à l’étape suivante</dd></div>
                {frais ? <div><dt>Frais de service ({R.num(c.serviceFeePct)} %)</dt><dd class="num">{dollars(frais)}</dd></div> : null}
                <div class="total"><dt class="lib">Total estimé</dt><dd class="num">{dollars(estime)}</dd></div>
              </dl>
              {francs(estime, c) ? <p class="discret petit droite">{francs(estime, c)}</p> : null}
              {seuil > 0 ? (
                <div class="livraison-offerte">
                  <div class="jauge" aria-hidden="true"><i style={{ width: Math.min(100, dv.sousTotal / seuil * 100) + '%' }} /></div>
                  <p class="petit">{dv.sousTotal >= seuil ? <><Icone n="coche" />La livraison vous est offerte.</> : <>Plus que <b>{dollars(seuil - dv.sousTotal)}</b> pour la livraison offerte.</>}</p>
                </div>
              ) : null}
              {!n ? <p class="note ton-alerte espace-haut"><Icone n="info" /><span>Cochez les articles que vous voulez commander maintenant.</span></p>
                : restent ? <p class="note ton-info espace-haut"><Icone n="sac" /><span>{pluriel(restent, 'article')} non coché{restent > 1 ? 's restent' : ' reste'} dans votre panier pour une prochaine commande.</span></p> : null}
              <button class="btn btn-primaire btn-l btn-bloc seulement-ordi espace-haut" disabled={bloque} onClick={commander}>{restent && n ? `Commander ${pluriel(n, 'article')}` : 'Commander'}<Icone n="droite" /></button>
              <p class="note ton-info espace-haut"><Icone n="bouclier" /><span>Paiement Mobile Money dans l’application : vous validez le montant sur votre téléphone, avec votre code PIN.</span></p>
            </div>
          </aside>
        </div>
        {suggestions.length ? <section class="section"><div class="section-tete"><h2 class="titre-section">Pour compléter votre commande</h2></div><GrilleProduits liste={suggestions} parPage={8} prioritaires={0} /></section> : null}
      </main>
      <Pied />
      <BarreAction avecNav>
        <div class="barre-total"><small>Total estimé</small><span class="prix">{dollars(estime)}</span></div>
        <button class="btn btn-primaire btn-l" style={{ flex: 1 }} disabled={bloque} onClick={commander}>{restent && n ? `Commander (${n})` : 'Commander'}</button>
      </BarreAction>
    </>
  );
}
