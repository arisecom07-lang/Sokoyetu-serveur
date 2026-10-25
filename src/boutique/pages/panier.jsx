// Sokoyetu (boutique) — panier.
import { useEffect } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide, Quantite, toast } from '../../commun/js/interface.jsx';
import { dollars, francs, pluriel } from '../../commun/js/outils.js';
import { lien, naviguer } from '../routeur.js';
import { cfg, lignesPanier, nbArticles, changerQuantite, produitsParId, produits, panier, nettoyerPanier, catalogueAJour } from '../etat.js';
import { EnteteBoutique, BarreAction, Pied } from '../composants/cadre.jsx';
import { GrilleProduits, lienProduit, trier } from '../composants/produits.jsx';
import { mesurerEvenement } from '../mesure.js';
import { useSeo } from './commun.jsx';

/* Totaux estimés dans le navigateur (le serveur recalcule tout avant le paiement). */
export function devisLocal({ zoneId, remise } = {}) {
  const m = produitsParId.value;
  return R.devis({ cfg: cfg.value, produit: (id) => m.get(id) || null, lignes: panier.value, zoneId: zoneId || (cfg.value.zones[0] || {}).id, code: remise ? remise.code : '', remise: remise ? { ...remise, active: true } : null, maintenant: Date.now() });
}

export function Panier() {
  const c = cfg.value; const lignes = lignesPanier.value;
  useEffect(() => { nettoyerPanier(); }, [catalogueAJour.value]);
  useSeo(() => ({ titre: 'Panier', noindex: true }), []);
  const dv = devisLocal();
  const problemes = new Map(dv.problemes.filter((x) => x.ligne != null).map((x) => [x.ligne, x]));
  const bloque = dv.problemes.some((x) => x.code === 'stock' || x.code === 'option' || x.code === 'article');
  const seuil = R.num(c.freeShippingOver);
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
          <ul class="panier-lignes" aria-label="Articles du panier">
            {lignes.map((l, i) => {
              const p = l.p; if (!p) return null;
              const pb = problemes.get(i); const imp = R.estImport(p);
              const st = imp ? R.MAX_QTE : R.stockDe(p, l.color, l.size);
              const variante = [l.color, l.size].filter(Boolean).join(' · ');
              return (
                <li key={l.cle} class="panier-ligne entree">
                  <a href={lienProduit(p)} class="pl-photo" aria-label={`Voir ${p.title}`}><Photo m={R.imagePrincipale(p)} alt="" tailles="96px" /></a>
                  <div class="pl-texte">
                    <a href={lienProduit(p)} class="pl-titre">{p.title}</a>
                    {variante ? <span class="pl-variante">{variante}</span> : null}
                    <span class="pl-delai">{imp ? <><Icone n="avion" />Import · ≈ {c.importDays} jours</> : <><Icone n="camion" />Livré en 24–48 h</>}</span>
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
          <aside class="panier-resume">
            <div class="carte">
              <h2 class="carte-titre"><Icone n="recu" />Récapitulatif</h2>
              <dl class="montants">
                <div><dt>Sous-total ({pluriel(nbArticles.value, 'article')})</dt><dd class="num">{dollars(dv.sousTotal)}</dd></div>
                <div><dt>Livraison</dt><dd class="attenue">Choisie à l’étape suivante</dd></div>
                <div class="total"><dt class="lib">Total estimé</dt><dd class="num">{dollars(dv.sousTotal)}</dd></div>
              </dl>
              {francs(dv.sousTotal, c) ? <p class="discret petit droite">{francs(dv.sousTotal, c)}</p> : null}
              {seuil > 0 ? (
                <div class="livraison-offerte">
                  <div class="jauge" aria-hidden="true"><i style={{ width: Math.min(100, dv.sousTotal / seuil * 100) + '%' }} /></div>
                  <p class="petit">{dv.sousTotal >= seuil ? <><Icone n="coche" />La livraison vous est offerte.</> : <>Plus que <b>{dollars(seuil - dv.sousTotal)}</b> pour la livraison offerte.</>}</p>
                </div>
              ) : null}
              <button class="btn btn-primaire btn-l btn-bloc seulement-ordi espace-haut" disabled={bloque} onClick={() => { mesurerEvenement('begin_checkout', { value: dv.sousTotal, currency: 'USD' }); naviguer('/commander'); }}>Commander<Icone n="droite" /></button>
              <p class="note ton-info espace-haut"><Icone n="bouclier" /><span>Paiement Mobile Money à la commande. Le montant exact vous est confirmé avant de payer.</span></p>
            </div>
          </aside>
        </div>
        {suggestions.length ? <section class="section"><div class="section-tete"><h2 class="titre-section">Pour compléter votre commande</h2></div><GrilleProduits liste={suggestions} parPage={8} prioritaires={0} /></section> : null}
      </main>
      <Pied />
      <BarreAction avecNav>
        <div class="barre-total"><small>Total estimé</small><span class="prix">{dollars(dv.sousTotal)}</span></div>
        <button class="btn btn-primaire btn-l" style={{ flex: 1 }} disabled={bloque} onClick={() => { mesurerEvenement('begin_checkout', { value: dv.sousTotal, currency: 'USD' }); naviguer('/commander'); }}>Commander</button>
      </BarreAction>
    </>
  );
}
