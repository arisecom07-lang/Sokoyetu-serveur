// Sokoyetu (boutique) — fiche article.
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo, urlMedia } from '../../commun/js/medias.jsx';
import { toast, Quantite, Note, ouvrirFeuille } from '../../commun/js/interface.jsx';
import { dollars, francs, pluriel, classes, date, JOUR } from '../../commun/js/outils.js';
import { lien, route, retour } from '../routeur.js';
import { cfg, produitsParId, produits, catalogueAJour, catalogueErreur, ajouterAuPanier, quantiteDansPanier, nbArticles, moyensPaiement, carteAcceptee, panier } from '../etat.js';
import { EnteteBoutique, BarreAction, Pied, ouvrirLivraisonPaiement } from '../composants/cadre.jsx';
import { BoutonFavori, CompteARebours, ErreurCatalogue, GrilleProduits, delai, epuise, lienProduit, lienRayon, nomRayon, PuceOperateur, trier } from '../composants/produits.jsx';
import { mesurerEvenement } from '../mesure.js';
import { partager, adresseComplete } from '../partage.jsx';
import { useSeo } from './commun.jsx';
import { Introuvable } from './introuvable.jsx';
import { ActiverNotifications } from './notifications.jsx';
import { alerteActive, basculerAlerte } from '../notifications.js';
import { NoteProduit, AvisProduit } from '../composants/avis.jsx';
import { t, tx, tn } from '../../commun/js/langue.js';

const selectionInitiale = (p) => {
  const cs = R.couleursDe(p), ts = R.taillesDe(p);
  const dispo = cs.find((c) => R.estImport(p) || ts.length || R.stockDe(p, c.name, '') > 0) || cs[0];
  return { color: dispo ? dispo.name : '', size: ts.length === 1 ? ts[0] : '', qty: 1 };
};

/* Animation : la photo « vole » jusqu'au panier. */
function voler(depuis) {
  const cible = [...document.querySelectorAll('[data-cible-panier]')].find((el) => el.offsetParent !== null);
  if (!depuis || !cible || matchMedia('(prefers-reduced-motion: reduce)').matches || !depuis.animate) return;
  const a = depuis.getBoundingClientRect(), b = cible.getBoundingClientRect();
  if (!a.width) return;
  const n = depuis.cloneNode(true); n.className = 'volant';
  Object.assign(n.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.appendChild(n);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), s = Math.max(0.06, 28 / a.width);
  const an = n.animate([{ transform: 'none', opacity: 1, borderRadius: '20px' }, { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 80}px) scale(${(1 + s) / 2.6})`, opacity: 0.95, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.3, borderRadius: '50%' }], { duration: 720, easing: 'cubic-bezier(.5,.05,.35,1)' });
  an.onfinish = an.oncancel = () => n.remove();
}

/* La vidéo de l'article passe juste après la photo principale. */
const avecVideo = (p) => !!(p.video && urlMedia(p.video));
const rangGalerie = (p, i) => (avecVideo(p) && i >= 1 ? i + 1 : i);

function Galerie({ p, idx, setIdx }) {
  const images = (p.images || []).filter(Boolean);
  const liste = images.length ? images.slice() : [null];
  if (avecVideo(p)) liste.splice(1, 0, { video: true });
  const piste = useRef(null);
  useEffect(() => { const el = piste.current; if (!el) return; const w = el.clientWidth; if (Math.round(el.scrollLeft / Math.max(1, w)) !== idx) el.scrollTo({ left: idx * w, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [idx]);
  const surDefilement = () => { const el = piste.current; const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (i !== idx) setIdx(i); };
  const ouvrirVisionneuse = (i) => {
    if (!images.length) return;
    i = images.indexOf(liste[i]); if (i < 0) i = 0;
    ouvrirFeuille({ titre: p.title, large: true, contenu: () => <div class="visionneuse">{images.map((m, j) => <img key={j} src={urlMedia(m, 1200)} alt={m.alt || t('{0}, photo {1}', [p.title, j + 1])} loading={j === i ? 'eager' : 'lazy'} />)}</div> });
  };
  return (
    <div class="galerie">
      <div class="galerie-piste" ref={piste} onScroll={surDefilement} tabIndex={0} aria-label={t('Photos de {0}', [p.title])}>
        {liste.map((m, i) => m && m.video ? (
          <div key="video" class="galerie-image galerie-video">
            <video src={urlMedia(p.video)} controls playsInline preload="metadata" poster={images[0] ? urlMedia(images[0], 800) : undefined} aria-label={t('Vidéo de {0}', [p.title])} />
          </div>
        ) : (
          <button type="button" key={i} class="galerie-image" onClick={() => ouvrirVisionneuse(i)} aria-label={images.length ? t('Agrandir la photo {0}', [i + 1]) : undefined} style={i === 0 ? { viewTransitionName: 'photo-produit' } : undefined}>
            <Photo m={m} alt={`${p.title}${liste.length > 1 ? t(', photo {0}', [i + 1]) : ''}`} prioritaire={i === 0} tailles="(min-width: 900px) 600px, 100vw" />
          </button>
        ))}
      </div>
      {liste.length > 1 ? (
        <>
          <div class="galerie-points" aria-hidden="true">{liste.map((_, i) => <i key={i} class={i === idx ? 'actif' : ''} />)}</div>
          <span class="galerie-compteur" aria-hidden="true">{idx + 1}/{liste.length}</span>
          <div class="galerie-vignettes seulement-ordi">
            {liste.map((m, i) => <button key={i} type="button" class={i === idx ? 'actif' : ''} onClick={() => setIdx(i)} aria-label={m && m.video ? t('Voir la vidéo') : t('Voir la photo {0}', [i + 1])}>{m && m.video ? <span class="vignette-video"><Icone n="lecture" /></span> : <Photo m={m} alt="" tailles="80px" />}</button>)}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Variantes({ p, sel, setSel, erreur, setIdx }) {
  const cs = R.couleursDe(p), ts = R.taillesDe(p); const imp = R.estImport(p);
  const choisirCouleur = (nom) => {
    let size = sel.size;
    if (size && !imp && R.stockDe(p, nom, size) <= 0) size = '';
    setSel({ ...sel, color: nom, size, qty: 1 });
    const i = (p.images || []).findIndex((m) => m && m.color === nom);
    if (i >= 0) setIdx(rangGalerie(p, i));
  };
  return (
    <>
      {cs.length ? (
        <fieldset class="variantes">
          <legend>{tx('Couleur : {0}', [<span>{sel.color || t('à choisir')}</span>])}</legend>
          <div class="pastilles-couleur">
            {cs.map((c) => {
              const vide = !imp && (ts.length ? ts.every((t) => R.stockDe(p, c.name, t) <= 0) : R.stockDe(p, c.name, '') <= 0);
              return <button key={c.name} type="button" class={classes('couleur', vide && 'epuisee')} style={{ '--c': c.hex || '#ccc' }} aria-pressed={sel.color === c.name ? 'true' : 'false'} aria-label={c.name + (vide ? t(' (épuisé)') : '')} title={c.name} onClick={() => choisirCouleur(c.name)}><i /></button>;
            })}
          </div>
        </fieldset>
      ) : null}
      {ts.length ? (
        <fieldset class={classes('variantes', erreur === 'size' && 'en-erreur')}>
          <legend>{tx('Taille : {0}', [<span>{sel.size || t('à choisir')}</span>])}</legend>
          {p.sizeGuide && (p.sizeGuide.cols || []).length ? <button type="button" class="lien petit lien-guide" onClick={() => ouvrirGuide(p, sel.size)}><Icone n="repere" />{t('Guide des tailles')}</button> : null}
          <div class="tailles">
            {ts.map((taille) => {
              const vide = !imp && (!cs.length || sel.color) && R.stockDe(p, cs.length ? sel.color : '', taille) <= 0;
              return <button key={taille} type="button" class={classes('taille', vide && 'epuisee')} aria-pressed={sel.size === taille ? 'true' : 'false'} aria-label={taille + (vide ? t(' (épuisé)') : '')} onClick={() => setSel({ ...sel, size: taille, qty: 1 })}>{taille}</button>;
            })}
          </div>
          {erreur === 'size' ? <p class="champ-erreur" role="alert"><Icone n="alerte" />{t('Choisissez une taille.')}</p> : null}
        </fieldset>
      ) : null}
    </>
  );
}

function ouvrirGuide(p, choisie) {
  const g = p.sizeGuide;
  ouvrirFeuille({
    titre: t('Guide des tailles'),
    contenu: () => (
      <div class="pile">
        <p class="attenue petit">{t('Mesures de l’article en centimètres.')}</p>
        <div class="guide-tailles-boite"><table class="guide-tailles">
          <thead><tr><th scope="col">{t('Taille')}</th>{g.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>{R.taillesDe(p).map((t) => <tr key={t} class={t === choisie ? 'choisie' : ''}><th scope="row">{t}</th>{g.cols.map((c, i) => <td key={c} class="num">{((g.rows || {})[t] || [])[i] || '–'}</td>)}</tr>)}</tbody>
        </table></div>
        {g.note ? <Note icone="info">{g.note}</Note> : null}
      </div>
    )
  });
}

function LigneStock({ p, sel }) {
  const c = cfg.value;
  if (R.estImport(p)) return <p class="ligne-stock imp"><Icone n="avion" />{tx('Sur commande · livré en ≈ {0} jours', [c.importDays])}</p>;
  const manque = (R.couleursDe(p).length && !sel.color) || (R.taillesDe(p).length && !sel.size);
  const st = manque ? R.stockTotal(p) : R.stockDe(p, sel.color, sel.size);
  if (st <= 0) return <p class="ligne-stock non"><Icone n="alerte" />{manque ? t('Épuisé pour le moment') : t('Épuisé dans cette option')}</p>;
  if (st <= R.int(c.lowStock)) return <p class="ligne-stock peu"><Icone n="horloge" />{tx('Plus que {0} en stock', [st])}</p>;
  return <p class="ligne-stock ok"><Icone n="coche" />{tx('En stock à {0}', [c.city])}</p>;
}

/* « Prévenez-moi » : article (ou option) épuisé, le client est prévenu de son retour (notification gratuite). */
function BoutonAlerte({ p, variante, classe, style }) {
  const [occupe, setOccupe] = useState(false);
  const actif = alerteActive(p.id, variante);
  const clic = async () => {
    if (occupe) return;
    setOccupe(true);
    try {
      const a = await basculerAlerte(p.id, variante);
      toast(a ? t('Nous vous préviendrons dès son retour') : t('Alerte retirée'), { icone: 'cloche' });
    } catch (err) { toast(err.message || t('Impossible pour le moment. Réessayez.'), { icone: 'alerte', ton: 'danger', duree: 5000 }); }
    setOccupe(false);
  };
  return (
    <button type="button" class={classes('btn btn-l', actif ? 'btn-secondaire' : 'btn-primaire', classe, occupe && 'charge')} style={style} onClick={clic} aria-pressed={actif ? 'true' : 'false'}>
      <Icone n={actif ? 'coche' : 'cloche'} />{actif ? t('Alerte activée') : t('Prévenez-moi')}
    </button>
  );
}

function Livraison({ p }) {
  const c = cfg.value; const d = delai(p, c); const j = R.int(c.importDays) || 20;
  return (
    <section class="carte carte-s pile">
      <div class="info-ligne"><span class="info-icone"><Icone n={d.icone} /></span><div><b>{d.titre}</b><p>{d.texte}</p></div></div>
      {R.estImport(p) ? (
        <ol class="frise-import" aria-label={t('Parcours de votre article')}>
          {[['recu', t('Commande'), t('aujourd’hui')], ['navire', t('Chine'), t('expédition')], ['douane', t('Douane'), t('dédouanement')], ['camion', c.city, date(Date.now() + j * JOUR, { day: 'numeric', month: 'short' })]].map(([ic, titre, s], i) => (
            <li key={i}><span><Icone n={ic} /></span><b>{titre}</b><small>{s}</small></li>
          ))}
        </ol>
      ) : (
        <div class="zones-mini">{c.zones.map((z) => { const v = R.num(z.fee) + (z.pickup ? 0 : R.num(z.perKg) * R.poidsDe(p)); return <span key={z.id}><b>{t(z.name)}</b>{v ? dollars(v) : t('gratuit')}</span>; })}</div>
      )}
      <div class="info-ligne"><span class="info-icone"><Icone n="bouclier" /></span><div>{carteAcceptee.value ? <><b>{t('Paiement sécurisé')}</b><p>{t('Mobile Money ou carte bancaire, payé à la commande. Nous ne demandons jamais votre code PIN, ni le numéro de votre carte.')}</p></> : <><b>{t('Paiement Mobile Money sécurisé')}</b><p>{t('Payé à la commande, vérifié par la boutique. Nous ne demandons jamais votre code PIN.')}</p></>}</div></div>
      {moyensPaiement.value.length ? <div class="operateurs">{moyensPaiement.value.map((m) => <PuceOperateur key={m.k} m={m} />)}</div> : null}
      {c.returns ? <div class="info-ligne"><span class="info-icone"><Icone n="echange" /></span><div><b>{t('Échanges')}</b><p>{t(c.returns)}</p></div></div> : null}
      <button class="lien petit" style={{ justifySelf: 'start' }} onClick={ouvrirLivraisonPaiement}>{t('Livraison et paiement en détail')}</button>
    </section>
  );
}

function caracteristiques(t) {
  return String(t || '').split('\n').map((l) => l.split(':')).filter((a) => a.length > 1 && a[0].trim()).map((a) => [a[0].trim(), a.slice(1).join(':').trim()]);
}

export function Produit() {
  const id = route.value.params.id;
  const p = produitsParId.value.get(id);
  const c = cfg.value;
  const [sel, setSel] = useState(() => (p ? selectionInitiale(p) : { color: '', size: '', qty: 1 }));
  const [idx, setIdx] = useState(0);
  const [erreur, setErreur] = useState('');
  const [ajoute, setAjoute] = useState(false);
  const deja = useRef(id);
  useEffect(() => { if (p && deja.current !== id) { deja.current = id; setSel(selectionInitiale(p)); setIdx(0); setErreur(''); setAjoute(false); } }, [id, !!p]);
  useEffect(() => { if (p && !sel.color && !sel.size && R.aDesOptions(p)) setSel(selectionInitiale(p)); }, [!!p]);

  useSeo(() => {
    if (!p) return { titre: t('Article'), noindex: !!catalogueAJour.value };
    const img = (p.images || []).filter(Boolean).map((m) => new URL(urlMedia(m, 1200), location.href).href);
    const prix = R.prixAffiche(p).prix;
    return {
      titre: `${p.title} · ${dollars(prix)}`, image: img[0],
      description: t('{0} à {1}{2}. {3}', [p.title, dollars(prix), R.estImport(p) ? t(' · import Chine, livré en ~{0} jours', [c.importDays]) : t(' · en stock à {0}', [c.city]), String(p.description || '').slice(0, 120)]),
      ld: { '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.description || p.title, image: img, ...(p.sku ? { sku: p.sku } : {}), category: (p.collectionIds || []).map(nomRayon).filter(Boolean).join(', '),
        ...(p.avis && p.avis.nombre && c.reviews.enabled ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.avis.note, reviewCount: p.avis.nombre, bestRating: 5, worstRating: 1 } } : {}),
        offers: { '@type': 'Offer', price: prix.toFixed(2), priceCurrency: 'USD', url: location.href, availability: 'https://schema.org/' + (R.estImport(p) ? 'PreOrder' : R.stockTotal(p) > 0 ? 'InStock' : 'OutOfStock'), seller: { '@type': 'Organization', name: (c.legal && c.legal.company) || c.name } } }
    };
  }, [id, !!p, p && p.price, p && p.avis && p.avis.nombre]);

  if (!p) {
    if (catalogueAJour.value) return <Introuvable texte={t('Cet article n’est plus en vente, ou le lien est incomplet.')} />;
    if (catalogueErreur.value) return <><EnteteBoutique classe="seulement-ordi" /><main id="contenu" class="page conteneur"><ErreurCatalogue /></main></>;
    return <><EnteteBoutique classe="seulement-ordi" /><main id="contenu" class="page conteneur"><div class="produit-grille"><div class="squelette" style={{ aspectRatio: '4 / 5' }} /><div class="pile"><div class="squelette" style={{ height: 34, width: '40%' }} /><div class="squelette" style={{ height: 22, width: '80%' }} /></div></div></main></>;
  }

  const pa = R.prixAffiche(p, sel.color, sel.size); const remise = pa.pct; const fini = epuise(p); const imp = R.estImport(p);
  // Prix de gros : toutes les pièces de l'article (déjà au panier + celles-ci), quelles que soient couleur et taille.
  const memeArticle = panier.value.filter((l) => l.productId === p.id).reduce((a, l) => a + R.int(l.qty), 0);
  const unitaire = R.prixUnitaire(p, sel.color, sel.size, memeArticle + sel.qty);
  const paliers = R.paliersGros(p);
  const dansPanier = quantiteDansPanier(p.id, sel.color, sel.size);
  const stock = imp ? R.MAX_QTE : R.stockDe(p, sel.color, sel.size);
  const max = Math.max(1, Math.min(R.MAX_QTE, (imp ? R.MAX_QTE : stock) - dansPanier));
  // Épuisé (tout l'article, ou l'option choisie) : « Prévenez-moi » à la place de « Ajouter au panier ».
  const complet = (!R.couleursDe(p).length || sel.color) && (!R.taillesDe(p).length || sel.size);
  const attendre = fini || (!imp && complet && stock <= 0);
  const variante = R.aDesOptions(p) && complet ? R.cleVariante(R.couleursDe(p).length ? sel.color : '', R.taillesDe(p).length ? sel.size : '') : '';
  const enAttente = attendre && alerteActive(p.id, variante);
  const details = caracteristiques(p.details);
  const virgule = (v) => String(R.arrondi(v)).replace('.', ',');
  if (R.poidsDe(p) && !details.some(([k]) => /^poids$/i.test(k))) details.push([t('Poids'), `${virgule(R.poidsDe(p))} kg`]);
  if (p.dims && (p.dims.l || p.dims.w || p.dims.h) && !details.some(([k]) => /^dimensions?$/i.test(k))) details.push([t('Dimensions'), `${[p.dims.l, p.dims.w, p.dims.h].filter(Boolean).map(virgule).join(' × ')} cm`]);
  const similaires = (() => {
    const meme = produits.value.filter((x) => x.id !== p.id && (x.collectionIds || []).some((k) => (p.collectionIds || []).includes(k)));
    const reste = produits.value.filter((x) => x.id !== p.id && !meme.includes(x));
    return [...trier(meme, 'pour-vous'), ...trier(reste, 'pour-vous')].slice(0, 8);
  })();

  const ajouter = () => {
    if (R.couleursDe(p).length && !sel.color) { setErreur('color'); return; }
    if (R.taillesDe(p).length && !sel.size) { setErreur('size'); document.querySelector('.variantes.en-erreur, .tailles')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (!imp && stock <= 0) { toast(t('Cette option est épuisée'), { icone: 'alerte', ton: 'danger' }); return; }
    if (!imp && dansPanier + sel.qty > stock) { toast(stock - dansPanier > 0 ? tn(stock - dansPanier, 'Plus que {n} disponible', 'Plus que {n} disponibles') : t('Tout le stock est déjà dans votre panier'), { icone: 'alerte', ton: 'danger' }); return; }
    voler(document.querySelector('.galerie-piste .galerie-image:nth-child(' + (idx + 1) + ') img') || document.querySelector('.galerie-piste img'));
    ajouterAuPanier(p, sel.color, sel.size, sel.qty);
    mesurerEvenement('add_to_cart', { currency: 'USD', value: R.arrondi(unitaire * sel.qty), items: [{ item_id: p.id, item_name: p.title, quantity: sel.qty, price: unitaire }] });
    setErreur(''); setAjoute(true); setSel({ ...sel, qty: 1 });
    toast(t('Ajouté au panier · {0}', [pluriel(nbArticles.value, 'article')]), { icone: 'sac' });
  };
  // Le lien s'ouvre avec l'aperçu de l'article (logo de la boutique, photo, prix) dans WhatsApp, Facebook…
  const partagerArticle = () => partager({ titre: p.title, texte: pa.des ? t('{0} dès {1} chez {2}', [p.title, dollars(pa.prix), c.name]) : t('{0} à {1} chez {2}', [p.title, dollars(pa.prix), c.name]), url: adresseComplete(`/p/${encodeURIComponent(p.id)}/${R.slug(p.title)}`), type: 'produit', id: p.id });
  const rayon = (p.collectionIds || []).map((k) => [k, nomRayon(k)]).find(([, n]) => n);

  return (
    <>
      <EnteteBoutique classe="seulement-ordi" />
      <div class="produit-flottant seulement-mobile">
        <button class="btn-icone flottant" onClick={() => retour('/')} aria-label={t('Retour')}><Icone n="retour" /></button>
        <div class="rangee">
          <button class="btn-icone flottant" onClick={partagerArticle} aria-label={t('Partager cet article')}><Icone n="partager" /></button>
          <a class="btn-icone flottant" href={lien('/panier')} aria-label={nbArticles.value ? tn(nbArticles.value, 'Panier, {n} article', 'Panier, {n} articles') : t('Panier')} data-cible-panier><Icone n="sac" />{nbArticles.value ? <span class="pastille-compte">{nbArticles.value > 99 ? '99+' : nbArticles.value}</span> : null}</a>
        </div>
      </div>
      <main id="contenu" class="page page-produit">
        <div class="conteneur produit-grille">
          <div class="produit-galerie"><Galerie p={p} idx={idx} setIdx={setIdx} /></div>
          <div class="produit-infos">
            <div class="produit-haut seulement-ordi">
              {rayon ? <nav class="fil" aria-label={t('Fil d’Ariane')}><a href={lien('/')}>{t('Accueil')}</a><Icone n="droite" /><a href={lienRayon({ id: rayon[0], name: rayon[1] })}>{rayon[1]}</a></nav> : <span />}
              <button type="button" class="btn btn-secondaire btn-s" onClick={partagerArticle}><Icone n="partager" />{t('Partager')}</button>
            </div>
            <section class="produit-entete">
              <div class="produit-prix">
                {pa.des ? <small class="prix-des">{t('dès')}</small> : null}
                <span class={classes('prix', remise && 'prix-promo')}>{dollars(pa.prix)}</span>
                {remise ? <><span class="remise-badge">−{remise} %</span><span class="prix-barre">{dollars(pa.barre)}</span></> : null}
              </div>
              {francs(pa.prix, c) ? <p class="produit-fc">{francs(pa.prix, c)}</p> : null}
              {pa.flash ? <p class="bandeau-flash"><Icone n="horloge" /><b>{tx('Vente flash −{0} %', [pa.flash.pct])}</b><span>{t('Se termine dans')}{' '}<CompteARebours fin={pa.flash.fin} /></span></p> : null}
              <h1 class="produit-titre">{p.title}</h1>
              <NoteProduit p={p} />
              <div class="rangee-l">
                {p.featured ? <span class="pastille ton-marque"><Icone n="etincelle" />{t('Tendance')}</span> : null}
                {imp ? <span class="pastille ton-info"><Icone n="avion" />{t('Import Chine')}</span> : <span class="pastille ton-ok"><Icone n="boutique" />{tx('En stock à {0}', [c.city])}</span>}
                {R.int(p.sold) > 0 ? <span class="pastille ton-neutre">{R.int(p.sold) >= 100 ? t('{0}+ vendus', [Math.floor(R.int(p.sold) / 100) * 100]) : tn(R.int(p.sold), '{n} vendu', '{n} vendus')}</span> : null}
              </div>
            </section>

            <section class="produit-options">
              <Variantes p={p} sel={sel} setSel={(s) => { setSel(s); setErreur(''); }} erreur={erreur} setIdx={setIdx} />
              <LigneStock p={p} sel={sel} />
              {paliers.length && !fini ? (
                <div class="prix-gros" role="list" aria-label={t('Prix de gros')}>
                  {paliers.map((x) => <span key={x.min} role="listitem" class={memeArticle + sel.qty >= x.min ? 'atteint' : ''}><b>{dollars(pa.prix * (100 - x.pct) / 100)}</b><small>{tx('dès {0} pièces · −{1} %', [x.min, x.pct])}</small></span>)}
                </div>
              ) : null}
              {!attendre ? <div class="entre"><span class="champ-libelle">{t('Quantité')}</span><Quantite valeur={sel.qty} max={max} onChange={(q) => setSel({ ...sel, qty: Math.max(1, Math.min(max, q)) })} /></div> : null}
              <div class="seulement-ordi produit-ajout">
                {attendre ? <BoutonAlerte p={p} variante={variante} classe="btn-bloc" /> : <button class="btn btn-primaire btn-l btn-bloc" onClick={ajouter}><Icone n="sac" />{tx('Ajouter au panier · {0}', [dollars(unitaire * sel.qty)])}</button>}
                {ajoute ? <a class="btn btn-secondaire btn-l btn-bloc" href={lien('/panier')}>{tx('Voir le panier ({0})', [nbArticles.value])}</a> : null}
              </div>
              {enAttente ? <Note ton="ok" icone="cloche">{tx('Alerte activée : vous serez prévenu dès son retour en stock{0}, dans vos notifications.', [variante ? ` (${R.libelleVariante(variante)})` : ''])}</Note> : null}
              {enAttente ? <ActiverNotifications discret titre={t('Soyez prévenu même boutique fermée')} texte={t('Une notification gratuite sur ce téléphone dès son retour en stock.')} /> : null}
              {dansPanier ? <Note ton="ok" icone="sac">{tx('{0} de cette option dans votre panier. {1}', [pluriel(dansPanier, 'exemplaire'), <a class="lien" href={lien('/panier')}>{t('Voir le panier')}</a>])}</Note> : null}
            </section>

            <Livraison p={p} />
            <a class="carte encours question" href={lien('/discussion?p=' + encodeURIComponent(p.id))}>
              <span class="menu-icone"><Icone n="bulle" /></span>
              <span class="menu-texte"><b>{t('Une question sur cet article ?')}</b><small>{t('Taille, couleur, délai : la boutique vous répond dans l’application')}</small></span>
              <Icone n="droite" classe="chevron" />
            </a>

            {p.description || details.length ? (
              <section class="produit-description">
                <h2 class="sous-titre">{t('Description')}</h2>
                {p.description ? String(p.description).split(/\n{2,}/).map((t, i) => <p key={i}>{t}</p>) : null}
                {details.length ? <dl class="caracteristiques">{details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
              </section>
            ) : null}
            <AvisProduit p={p} />
          </div>
        </div>
        {similaires.length ? (
          <section class="conteneur section">
            <div class="section-tete"><h2 class="titre-section">{t('Vous aimerez aussi')}</h2></div>
            <GrilleProduits key={id} liste={similaires} parPage={8} prioritaires={0} />
          </section>
        ) : null}
      </main>
      <Pied />
      <BarreAction>
        <BoutonFavori p={p} classe="btn-icone barre-favori" />
        {ajoute ? <a class="btn btn-secondaire" href={lien('/panier')} style={{ flex: 'none' }}>{tx('Panier ({0})', [nbArticles.value])}</a> : null}
        {attendre ? <BoutonAlerte p={p} variante={variante} style={{ flex: 1 }} />
          : <button class="btn btn-primaire btn-l" style={{ flex: 1 }} onClick={ajouter}>{remise ? <em class="barre-promo">−{remise} %</em> : null}{t('Ajouter au panier')}</button>}
      </BarreAction>
    </>
  );
}
