// Sokoyetu (boutique) — panier.
import { useEffect, useMemo } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide, Quantite, toast } from '../../commun/js/interface.jsx';
import { dollars, francs, pluriel } from '../../commun/js/outils.js';
import { lien, naviguer, route } from '../routeur.js';
import { cfg, carteAcceptee, lignesPanier, nbArticles, nbACommander, aCommander, changerQuantite, cocherLigne, cocherSeulement, produitsParId, produits, panier, nettoyerPanier, catalogueAJour, catalogueErreur, cleLigne, quantiteDansPanier, mettreDansLePanier } from '../etat.js';
import { EnteteBoutique, BarreAction, Pied } from '../composants/cadre.jsx';
import { GrilleProduits, ErreurCatalogue, lienProduit, trier } from '../composants/produits.jsx';
import { mesurerEvenement } from '../mesure.js';
import { useSeo } from './commun.jsx';
import { partager, lienPanierPartage, textePanier } from '../partage.jsx';
import { t, tx, tn, aTraduire } from '../../commun/js/langue.js';

/* Totaux estimés dans le navigateur, sur les articles cochés (le serveur recalcule tout avant le paiement). */
export function devisLocal({ zoneId, remise, parrainage, cagnotte } = {}) {
  const m = produitsParId.value;
  return R.devis({ cfg: cfg.value, produit: (id) => m.get(id) || null, lignes: aCommander.value, zoneId: zoneId || (cfg.value.zones[0] || {}).id, code: remise ? remise.code : '', remise: remise ? { ...remise, active: true } : null,
    parrainage: parrainage || null, cagnotte: cagnotte || 0, maintenant: Date.now() });
}

/* Prix à la pièce de chaque ligne (vente flash, prix de gros) : le palier compte les pièces cochées du même article. */
export function prixPieces(lignes) {
  const parArticle = {};
  lignes.forEach((l) => { if (l.coche !== false) parArticle[l.productId] = (parArticle[l.productId] || 0) + R.int(l.qty); });
  const now = Date.now();
  return new Map(lignes.map((l) => {
    const p = l.p || produitsParId.value.get(l.productId); if (!p) return [l.cle, { prix: 0, base: 0 }];
    return [l.cle, { prix: R.prixUnitaire(p, l.color, l.size, l.coche === false ? l.qty : parArticle[l.productId], now), base: R.prixVariante(p, l.color, l.size) }];
  }));
}

export function Panier() {
  const c = cfg.value; const lignes = lignesPanier.value;
  useEffect(() => { nettoyerPanier(); }, [catalogueAJour.value]);
  useSeo(() => ({ titre: t('Panier'), noindex: true }), []);
  const dv = devisLocal();
  const pieces = prixPieces(lignes);
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
  // Partage : tout le panier (articles cochés ou non), aux prix du jour.
  // Tout le panier (articles cochés ou non) ; le message annonce ce que verra la personne qui ouvre le lien.
  const partagerPanier = () => {
    const tout = lignes.filter((l) => l.p);
    const a = R.apercuPartage({ cfg: c, produit: (id) => produitsParId.value.get(id) || null, lignes: tout });
    partager({ titre: t('Mon panier {0}', [c.name]), texte: textePanier(c.name, a.n, a.total), url: lienPanierPartage(tout), type: 'panier' });
  };

  if (!lignes.length) {
    return (
      <>
        <EnteteBoutique />
        <main id="contenu" class="page conteneur">
          <div class="titre-page"><h1 class="titre-serif">{t('Panier')}</h1></div>
          <Vide icone="sac" titre={t('Votre panier est vide')} texte={t('Ajoutez vos coups de cœur : ils vous attendront ici, même si vous fermez l’application.')}>
            <a class="btn btn-primaire" href={lien('/')}>{t('Découvrir la boutique')}</a><a class="btn btn-secondaire" href={lien('/categories')}>{t('Parcourir les rayons')}</a>
          </Vide>
          {suggestions.length ? <section class="section"><div class="section-tete"><h2 class="titre-section">{t('Nos suggestions')}</h2></div><GrilleProduits liste={suggestions} parPage={8} prioritaires={0} /></section> : null}
        </main>
        <Pied />
      </>
    );
  }

  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur page-panier">
        <div class="titre-page titre-avec-action">
          <div><h1 class="titre-serif">{tx('Panier {0}', [<span class="discret">({nbArticles.value})</span>])}</h1><p class="attenue">{tx('Livraison à {0}', [c.zones.filter((z) => !z.pickup).map((z) => z.name).join(t(' et ')) || c.city])}</p></div>
          <button type="button" class="btn btn-secondaire btn-s" onClick={partagerPanier}><Icone n="partager" />{t('Partager')}</button>
        </div>
        <div class="panier-grille">
          <div class="pile">
          {lignes.length > 1 ? (
            <div class="panier-choix">
              <div class="case" data-coche={toutes ? 'oui' : choisies ? 'partiel' : 'non'}>
                <button type="button" class="case-boite" role="checkbox" aria-checked={toutes ? 'true' : choisies ? 'mixed' : 'false'} aria-labelledby="panier-tout" onClick={() => cocherSeulement(() => !toutes)}><Icone n={!toutes && choisies ? 'moins' : 'coche'} /></button>
                <span id="panier-tout" onClick={() => cocherSeulement(() => !toutes)}>{tx('Tout sélectionner {0}', [<span class="discret">({choisies}/{lignes.length})</span>])}</span>
              </div>
              {melange ? (
                <div class="panier-filtres" role="group" aria-label={t('Choisir selon la provenance')}>
                  <button type="button" class="puce" data-source="local" aria-pressed={seulBukavu ? 'true' : 'false'} onClick={() => cocherSeulement((l) => !estImp(l))}><Icone n="camion" />{t('En stock à Bukavu')}</button>
                  <button type="button" class="puce" data-source="import" aria-pressed={seulImport ? 'true' : 'false'} onClick={() => cocherSeulement(estImp)}><Icone n="avion" />{t('Import Chine')}</button>
                </div>
              ) : null}
            </div>
          ) : null}
          <ul class="panier-lignes" aria-label={t('Articles du panier')}>
            {lignes.map((l) => {
              const p = l.p; if (!p) return null;
              const pb = problemes.get(l.cle); const imp = R.estImport(p);
              const st = imp ? R.MAX_QTE : R.stockDe(p, l.color, l.size);
              const variante = [l.color, l.size].filter(Boolean).join(' · ');
              return (
                <li key={l.cle} class="panier-ligne entree" data-coche={l.coche ? 'oui' : 'non'}>
                  <div class="case pl-case" data-coche={l.coche ? 'oui' : 'non'}>
                    <button type="button" class="case-boite" role="checkbox" aria-checked={l.coche ? 'true' : 'false'} aria-label={t('Commander {0}{1} maintenant', [p.title, variante ? ' (' + variante + ')' : ''])} onClick={() => cocherLigne(l.cle, !l.coche)}><Icone n="coche" /></button>
                  </div>
                  <a href={lienProduit(p)} class="pl-photo" aria-label={t('Voir {0}', [p.title])}><Photo m={R.imagePrincipale(p)} alt="" tailles="96px" /></a>
                  <div class="pl-texte">
                    <a href={lienProduit(p)} class="pl-titre">{p.title}</a>
                    {variante ? <span class="pl-variante">{variante}</span> : null}
                    <span class="pl-delai">{imp ? <><Icone n="avion" />{tx('Import · ≈ {0} jours', [c.importDays])}</> : <><Icone n="camion" />{t('Livré en 24–48 h')}</>}</span>
                    {!l.coche ? <span class="pl-plus-tard">{t('Reste dans le panier pour plus tard')}</span> : null}
                    {pb ? <p class="champ-erreur"><Icone n="alerte" />{pb.message}</p> : null}
                    <div class="pl-bas">
                      <Quantite petit supprimer valeur={l.qty} max={Math.min(R.MAX_QTE, Math.max(l.qty, st))} libelle={t('Quantité de {0}', [p.title])}
                        onChange={(q) => { changerQuantite(l.cle, q); if (q <= 0) toast(t('Article retiré du panier'), { icone: 'poubelle' }); }} />
                      <span class="pl-prix">{pieces.get(l.cle).prix < pieces.get(l.cle).base ? <span class="prix-barre">{dollars(pieces.get(l.cle).base * l.qty)}</span> : null}<span class="prix">{dollars(pieces.get(l.cle).prix * l.qty)}</span></span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
          <aside class="panier-resume">
            <div class="carte">
              <h2 class="carte-titre"><Icone n="recu" />{t('Récapitulatif')}</h2>
              <dl class="montants">
                <div><dt>{restent ? tn(n, 'Sous-total ({n} article choisi)', 'Sous-total ({n} articles choisis)') : t('Sous-total ({0})', [pluriel(n, 'article')])}</dt><dd class="num">{dollars(dv.sousTotal)}</dd></div>
                <div><dt>{t('Livraison')}</dt><dd class="attenue">{t('Choisie à l’étape suivante')}</dd></div>
                {frais ? <div><dt>{tx('Frais de service ({0} %)', [R.num(c.serviceFeePct)])}</dt><dd class="num">{dollars(frais)}</dd></div> : null}
                <div class="total"><dt class="lib">{t('Total estimé')}</dt><dd class="num">{dollars(estime)}</dd></div>
              </dl>
              {francs(estime, c) ? <p class="discret petit droite">{francs(estime, c)}</p> : null}
              {seuil > 0 ? (
                <div class="livraison-offerte">
                  <div class="jauge" aria-hidden="true"><i style={{ width: Math.min(100, dv.sousTotal / seuil * 100) + '%' }} /></div>
                  <p class="petit">{dv.sousTotal >= seuil ? <><Icone n="coche" />{t('La livraison vous est offerte.')}</> : <>{tx('Plus que {0} pour la livraison offerte.', [<b>{dollars(seuil - dv.sousTotal)}</b>])}</>}</p>
                </div>
              ) : null}
              {!n ? <p class="note ton-alerte espace-haut"><Icone n="info" /><span>{t('Cochez les articles que vous voulez commander maintenant.')}</span></p>
                : restent ? <p class="note ton-info espace-haut"><Icone n="sac" /><span>{tn(restent, '{n} article non coché reste dans votre panier pour une prochaine commande.', '{n} articles non cochés restent dans votre panier pour une prochaine commande.')}</span></p> : null}
              <button class="btn btn-primaire btn-l btn-bloc seulement-ordi espace-haut" disabled={bloque} onClick={commander}>{restent && n ? t('Commander {0}', [pluriel(n, 'article')]) : t('Commander')}<Icone n="droite" /></button>
              <p class="note ton-info espace-haut"><Icone n="bouclier" /><span>{carteAcceptee.value ? t('Paiement dans l’application : Mobile Money, validé sur votre téléphone avec votre code PIN, ou carte Visa / Mastercard sur une page sécurisée.') : t('Paiement Mobile Money dans l’application : vous validez le montant sur votre téléphone, avec votre code PIN.')}</span></p>
            </div>
          </aside>
        </div>
        {suggestions.length ? <section class="section"><div class="section-tete"><h2 class="titre-section">{t('Pour compléter votre commande')}</h2></div><GrilleProduits liste={suggestions} parPage={8} prioritaires={0} /></section> : null}
      </main>
      <Pied />
      <BarreAction avecNav>
        <div class="barre-total"><small>{t('Total estimé')}</small><span class="prix">{dollars(estime)}</span></div>
        <button class="btn btn-primaire btn-l" style={{ flex: 1 }} disabled={bloque} onClick={commander}>{restent && n ? t('Commander ({0})', [n]) : t('Commander')}</button>
      </BarreAction>
    </>
  );
}

/*
 * Panier reçu par un lien (/panier/partage?a=…) : les articles aux prix et au stock du jour, à mettre dans son panier d'un geste.
 * Le lien ne contient que les articles et les quantités : prix, stock et options sont ceux de la boutique au moment de l'ouverture.
 */
const MESSAGES_PARTAGE = { 'retiré': aTraduire('Cet article n’est plus en vente.'), option: aTraduire('Cette couleur ou cette taille n’est plus proposée.'), prix: aTraduire('Prix momentanément indisponible.') };

export function PanierPartage() {
  const c = cfg.value; const recherche = route.value.recherche;
  const recues = useMemo(() => R.panierDepuisLien(recherche), [recherche]);
  useSeo(() => ({ titre: t('Panier partagé'), noindex: true }), []);
  const m = produitsParId.value;

  // Un article du lien encore inconnu : le catalogue du serveur n'est peut-être pas encore arrivé.
  if (recues.length && !catalogueAJour.value && recues.some((l) => !m.has(l.productId))) {
    return (
      <>
        <EnteteBoutique />
        <main id="contenu" class="page conteneur" aria-busy={catalogueErreur.value ? undefined : 'true'}>
          <div class="titre-page"><h1 class="titre-serif">{t('Panier partagé')}</h1></div>
          {catalogueErreur.value ? <ErreurCatalogue /> : <div class="panier-lignes">{recues.slice(0, 3).map((l) => <div key={l.productId} class="squelette" style={{ height: '146px', borderRadius: 'var(--r-l)' }} />)}</div>}
        </main>
      </>
    );
  }

  // Même calcul que le message envoyé et que l'aperçu du lien : prix et stock du jour, frais de service compris.
  const ap = R.apercuPartage({ cfg: c, produit: (id) => m.get(id) || null, lignes: recues });
  const lignes = ap.lignes.map((l) => { const p = m.get(l.productId) || null; return { ...l, cle: cleLigne(l.productId, l.color, l.size), p, imp: !!p && R.estImport(p) }; });
  const ok = lignes.filter((l) => !l.probleme);
  const { n, sousTotal: total, frais, total: estime } = ap;
  const pieces = prixPieces(ok);
  const deja = ok.length > 0 && ok.every((l) => quantiteDansPanier(l.productId, l.color, l.size) >= l.qty);
  const ajouter = () => {
    const q = mettreDansLePanier(ok);
    mesurerEvenement('add_to_cart', { currency: 'USD', value: total, items: ok.map((l) => ({ item_id: l.productId, item_name: l.p.title, quantity: l.qty })) });
    toast(t('{0} dans votre panier', [pluriel(q, 'article')]), { icone: 'sac' });
    naviguer('/panier');
  };

  if (!ok.length) {
    return (
      <>
        <EnteteBoutique />
        <main id="contenu" class="page conteneur">
          <div class="titre-page"><h1 class="titre-serif">{t('Panier partagé')}</h1></div>
          <Vide icone="sac" titre={recues.length ? t('Ces articles ne sont plus disponibles') : t('Ce lien de panier est incomplet')}
            texte={recues.length ? t('Ils ont été vendus ou retirés de la boutique depuis le partage. Découvrez nos autres articles.') : t('Demandez à la personne qui vous l’a envoyé de partager son panier de nouveau.')}>
            <a class="btn btn-primaire" href={lien('/')}>{t('Découvrir la boutique')}</a>
          </Vide>
        </main>
        <Pied />
      </>
    );
  }

  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur page-panier">
        <div class="titre-page"><h1 class="titre-serif">{t('Panier partagé')}</h1><p class="attenue">{t('Ces articles vous ont été partagés : ajoutez-les à votre panier pour les commander.')}</p></div>
        <div class="panier-grille">
          <ul class="panier-lignes" aria-label={t('Articles du panier partagé')}>
            {lignes.map((l) => {
              const p = l.p; const variante = [l.color, l.size].filter(Boolean).join(' · ');
              const pp = pieces.get(l.cle);
              return (
                <li key={l.cle} class="panier-ligne ligne-recue entree" data-indisponible={l.probleme ? 'oui' : undefined}>
                  {p ? <a href={lienProduit(p)} class="pl-photo" aria-label={t('Voir {0}', [p.title])}><Photo m={R.imagePrincipale(p)} alt="" tailles="96px" /></a> : <span class="pl-photo"><Photo m={null} /></span>}
                  <div class="pl-texte">
                    {p ? <a href={lienProduit(p)} class="pl-titre">{p.title}</a> : <span class="pl-titre">{t('Article retiré')}</span>}
                    {variante ? <span class="pl-variante">{variante}</span> : null}
                    {p && !l.probleme ? <span class="pl-delai">{l.imp ? <><Icone n="avion" />{tx('Import · ≈ {0} jours', [c.importDays])}</> : <><Icone n="camion" />{t('Livré en 24–48 h')}</>}</span> : null}
                    {l.probleme ? <p class="champ-erreur"><Icone n="alerte" />{l.probleme === 'epuise' ? t('Épuisé pour le moment.') : t(MESSAGES_PARTAGE[l.probleme] || '')}{p && l.probleme === 'option' ? <> <a class="lien" href={lienProduit(p)}>{t('Choisir une option')}</a></> : null}</p>
                      : l.qty < l.demandee ? <p class="note-ligne"><Icone n="info" />{tn(l.qty, 'Plus que {n} exemplaire disponible.', 'Plus que {n} exemplaires disponibles.')}</p> : null}
                    <div class="pl-bas">
                      <span class="pl-quantite">{l.probleme ? '' : t('Quantité : {0}', [l.qty])}</span>
                      {pp ? <span class="pl-prix">{pp.prix < pp.base ? <span class="prix-barre">{dollars(pp.base * l.qty)}</span> : null}<span class="prix">{dollars(pp.prix * l.qty)}</span></span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <aside class="panier-resume">
            <div class="carte">
              <h2 class="carte-titre"><Icone n="recu" />{t('Récapitulatif')}</h2>
              <dl class="montants">
                <div><dt>{tx('Sous-total ({0})', [pluriel(n, 'article')])}</dt><dd class="num">{dollars(total)}</dd></div>
                <div><dt>{t('Livraison')}</dt><dd class="attenue">{t('Choisie à la commande')}</dd></div>
                {frais ? <div><dt>{tx('Frais de service ({0} %)', [R.num(c.serviceFeePct)])}</dt><dd class="num">{dollars(frais)}</dd></div> : null}
                <div class="total"><dt class="lib">{t('Total estimé')}</dt><dd class="num">{dollars(estime)}</dd></div>
              </dl>
              {francs(estime, c) ? <p class="discret petit droite">{francs(estime, c)}</p> : null}
              <p class="note ton-info espace-haut"><Icone n="info" /><span>{t('Prix et disponibilités du jour : ils peuvent avoir changé depuis le partage.')}</span></p>
              {deja ? <a class="btn btn-secondaire btn-l btn-bloc seulement-ordi espace-haut" href={lien('/panier')}><Icone n="coche" />{t('Déjà dans votre panier · Voir le panier')}</a>
                : <button class="btn btn-primaire btn-l btn-bloc seulement-ordi espace-haut" onClick={ajouter}><Icone n="sac" />{t('Ajouter au panier')}</button>}
            </div>
          </aside>
        </div>
      </main>
      <Pied />
      <BarreAction>
        <div class="barre-total"><small>{t('Total estimé')}</small><span class="prix">{dollars(estime)}</span></div>
        {deja ? <a class="btn btn-secondaire btn-l" style={{ flex: 1 }} href={lien('/panier')}>{t('Voir le panier')}</a>
          : <button class="btn btn-primaire btn-l" style={{ flex: 1 }} onClick={ajouter}>{t('Ajouter au panier')}</button>}
      </BarreAction>
    </>
  );
}
