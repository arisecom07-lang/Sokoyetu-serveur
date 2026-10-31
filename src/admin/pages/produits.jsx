// Sokoyetu (administration) — produits : liste et fiche (photos cadrées par l'assistant, vidéo, assistant IA, import par lien, prix et marge, variantes, stock, rayons).
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo, compresser, taille } from '../../commun/js/medias.jsx';
import { envoyerPhoto, urlFichierServeur } from '../../commun/js/api.js';
import { Local } from '../../commun/js/stockage.js';
import { Champ, Note, Vide, Pastille, Bascule, Segment, toast, confirmer, ouvrirFeuille, fermerFeuille, useParPage, AfficherPlus } from '../../commun/js/interface.jsx';
import { dollars, pluriel, uid, classes, normaliser, copie, slug } from '../../commun/js/outils.js';
import { lien, route, aller, garder } from '../routeur.js';
import { cfg, produits, rayons, pret, etatServeur, sauverProduit, sauver, retirer, ficheIA, cadreIA, gererErreur, attentes, chargerAttentes, avis, peut } from '../etat.js';
import { noteFr } from '../../commun/js/etoiles.jsx';
import { cadrerPhoto } from '../cadrage.js';
import { TetePage, BarreEnregistrer, adresseBoutique } from '../composants/cadre.jsx';
import { Chargement } from './accueil.jsx';
import { CarteLien, TableauVariantes, PrixGros, CarteFlash, CarteGuide, CarteColis, CarteVideo, nettoyerComplements, prixFournisseur } from './produits-plus.jsx';

const NUANCIER = ['#1F1D22', '#F5F3F0', '#8B5E3C', '#D8CFC2', '#C8344A', '#F4A7C0', '#9C8BD1', '#3F6EA8', '#8EC3E6', '#4F8A5B', '#F2B544', '#D0663D', '#9A9AA0', '#2C3E50'];
const PRESETS = [['XS à XL', ['XS', 'S', 'M', 'L', 'XL']], ['36 à 44', ['36', '37', '38', '39', '40', '41', '42', '43', '44']], ['Enfant', ['2 ans', '4 ans', '6 ans', '8 ans', '10 ans']], ['Taille unique', ['Taille unique']]];

const libelleStock = (p) => {
  if (R.estImport(p)) return 'Sur commande · import';
  const s = R.stockTotal(p); const n = R.clesVariantes(p).length;
  return `${s ? `${s} en stock` : 'Épuisé'}${n ? ` · ${pluriel(n, 'variante')}` : ''}`;
};
const FILTRES = [
  ['tous', 'Tous', () => true], ['vente', 'En vente', R.estEnVente], ['brouillons', 'Brouillons', (p) => !R.estEnVente(p)],
  ['faible', 'Stock faible', (p) => !R.estImport(p) && R.stockTotal(p) <= R.int(cfg.value.lowStock)], ['import', 'Import Chine', R.estImport],
  ['attendus', 'Demandés', (p) => attente(p.id) > 0]
];
/* Clients qui attendent le retour de cet article (« Prévenez-moi » dans la boutique). */
const attente = (id) => (attentes.value[id] ? attentes.value[id].total : 0);

export function Produits() {
  const f0 = route.value.query.get('f');
  const [filtre, setFiltre] = useState(FILTRES.some((x) => x[0] === f0) ? f0 : 'tous');
  const [q, setQ] = useState('');
  const ps = produits.value; const fn = (FILTRES.find((x) => x[0] === filtre) || FILTRES[0])[2];
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const liste = ps.filter(fn).filter((p) => !mots.length || mots.every((m) => normaliser([p.title, p.sku, p.tags].join(' ')).includes(m)));
  const ia = etatServeur.value.ia;
  const page = useParPage(liste, 50, filtre + '|' + q);
  useEffect(() => { chargerAttentes(); }, []);
  return (
    <>
      <TetePage titre="Produits" sous={`${pluriel(ps.length, 'produit')} · ${ps.filter(R.estEnVente).length} en vente`}
        actions={<div class="rangee seulement-ordi"><a class="btn btn-secondaire" href={lien('/produits/importer')}><Icone n="telecharger" />Importer</a>{ia ? <a class="btn btn-doux" href={lien('/produits/nouveau?ia=1')}><Icone n="ia" />Ajouter avec l’IA</a> : null}<a class="btn btn-primaire" href={lien('/produits/nouveau')}><Icone n="plus" />Ajouter un produit</a></div>} />
      <div class="outils-liste">
        <div class="recherche-rangee">
          <label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nom, référence, mot-clé" aria-label="Rechercher un produit" /></label>
          <a class="btn btn-secondaire seulement-mobile" href={lien('/produits/importer')}><Icone n="telecharger" />Importer</a>
        </div>
        <div class="puces" role="group" aria-label="Filtrer les produits">{FILTRES.map(([k, t, f]) => <button key={k} class="puce" aria-pressed={filtre === k ? 'true' : 'false'} onClick={() => setFiltre(k)}>{t}<span class="n">{ps.filter(f).length}</span></button>)}</div>
      </div>
      {!pret.value ? <Chargement /> : liste.length ? (<>
        <div class="liste">
          {page.visibles.map((p) => {
            const faible = !R.estImport(p) && R.stockTotal(p) <= R.int(cfg.value.lowStock);
            const marge = R.num(p.cost) > 0 && R.num(p.price) > 0 ? Math.round((1 - R.num(p.cost) / R.num(p.price)) * 100) : null;
            return (
              <a key={p.id} class="ligne" href={lien('/produits/' + p.id)}>
                <span class="ligne-vignette grande"><Photo m={R.imagePrincipale(p)} alt="" tailles="64px" /></span>
                <span class="ligne-texte"><b>{p.title}</b><small class={faible ? 'texte-danger' : ''}>{libelleStock(p)}{p.demo ? ' · exemple' : ''}</small>{attente(p.id) ? <small class="attente">{pluriel(attente(p.id), 'client attend', 'clients attendent')} son retour</small> : null}
                  <span class="ligne-pastilles">{R.estEnVente(p) ? <Pastille ton="ok" point>En vente</Pastille> : <Pastille ton="neutre" point>Brouillon</Pastille>}{R.estImport(p) ? <Pastille ton="info" icone="avion">Import</Pastille> : null}{R.venteFlash(p) ? <Pastille ton="warn" icone="horloge">Flash −{R.venteFlash(p).pct} %</Pastille> : null}</span></span>
                <span class="ligne-fin">{R.num(p.price) > 0 ? <b>{dollars(p.price)}</b> : <small class="discret">Sans prix</small>}{marge !== null ? <small>marge {marge} %</small> : null}</span>
              </a>
            );
          })}
        </div>
        <AfficherPlus page={page} total={liste.length} libelle="produit" />
      </>) : <div class="carte"><Vide icone="etiquette" titre={ps.length ? 'Aucun produit ici' : 'Ajoutez votre premier produit'} texte={ps.length ? 'Changez de filtre ou de recherche.' : 'Photo, prix, couleurs, tailles et stock : il apparaît aussitôt dans la boutique.'}>{ps.length ? null : <a class="btn btn-primaire" href={lien('/produits/nouveau')}><Icone n="plus" />Ajouter un produit</a>}</Vide></div>}
      <div class="fab seulement-mobile">
        {ia ? <a class="btn btn-doux btn-l" href={lien('/produits/nouveau?ia=1')} aria-label="Ajouter avec l’IA"><Icone n="ia" />IA</a> : null}
        <a class="btn btn-primaire btn-l" href={lien('/produits/nouveau')}><Icone n="plus" />Ajouter</a>
      </div>
    </>
  );
}

const nouveau = () => ({ title: '', description: '', details: '', price: '', compareAt: '', cost: '', source: 'local', status: 'active', collectionIds: [], tags: '', featured: false, images: [], options: { colors: [], sizes: [] }, variants: {}, stock: 0, sku: '', sold: 0,
  variantPrices: {}, wholesale: [], flash: null, sizeGuide: null, weight: '', dims: null, video: null, supplier: null });
const lireFichier = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = ko; r.readAsDataURL(blob); });
const media = ({ type, id, f, w, h }) => ({ type, id, f, w, h });
/* Photo retouchée ⇄ photo d'origine : les deux restent sur la fiche, la description et la couleur suivent. */
const basculerRetouche = (m) => {
  const { orig, retouche, ...reste } = m;
  return orig ? { ...reste, ...media(orig), retouche: media(m) } : { ...reste, ...media(retouche), orig: media(m) };
};
const MESSAGES_IA = {
  no_key: 'L’assistant n’est pas encore activé sur le serveur : console du serveur → sudo /opt/sokoyetu/ia.sh VOTRE_CLE',
  bad_key: 'La clé de l’assistant est refusée. Enregistrez-en une nouvelle avec ia.sh.',
  rate_limited: 'Trop de demandes pour le moment. Réessayez dans quelques minutes.', limite: 'Trop de demandes pour le moment. Réessayez dans une minute.',
  image_rejected: 'Cette photo n’a pas pu être lue. Essayez une autre image (JPEG ou PNG).', invalid_json: 'La réponse de l’assistant était incomplète. Réessayez.',
  refused: 'L’assistant n’a pas pu décrire cette photo. Essayez une photo plus nette de l’article seul.', reseau: 'Pas de connexion internet. Réessayez une fois reconnecté.',
  daily_limit: 'L’assistant a atteint sa limite d’aujourd’hui (fiches et cadrages de photos). Il sera de nouveau disponible demain (limite réglable sur le serveur, voir le guide).',
  no_credit: 'Le crédit de l’assistant est épuisé ou sa limite de dépense est atteinte : rechargez-le sur console.anthropic.com (Billing).',
  network: 'L’assistant ne répond pas pour le moment. Réessayez dans un instant.'
};

function FormulaireProduit() {
  const segs = route.value.segs; const id0 = segs[1]; const nouveauProduit = id0 === 'nouveau';
  const source = nouveauProduit ? null : produits.value.find((p) => p.id === id0);
  const duplique = segs[2] === 'copie';
  const [id] = useState(() => (nouveauProduit || duplique ? uid() : id0));
  const initial = useRef(null);
  const [f, setF] = useState(() => {
    let base = source ? copie(source) : nouveau();
    if (duplique) { base = { ...base, title: base.title + ' (copie)', sold: 0 }; delete base.demo; delete base.createdAt; }
    delete base.id; base.options = base.options || { colors: [], sizes: [] }; base.options.colors = base.options.colors || []; base.options.sizes = base.options.sizes || []; base.variants = base.variants || {};
    initial.current = duplique || nouveauProduit ? null : copie(base);
    return base;
  });
  const [envois, setEnvois] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const [ia, setIa] = useState({ occupe: false, message: '', erreur: false, rayon: '', indice: '' });
  const [cadrage, setCadrage] = useState(() => Local.lire('cadrage-auto', true) !== false);
  const [enRetouche, setEnRetouche] = useState(null);
  const [rayonLien, setRayonLien] = useState('');
  const [couleur, setCouleur] = useState({ nom: '', hex: NUANCIER[0] });
  const [tailleNouvelle, setTailleNouvelle] = useState('');
  const [erreurs, setErreurs] = useState({});
  const choixIA = useRef(null);
  const reference = useRef(JSON.stringify(f));
  const modifie = JSON.stringify(f) !== reference.current;
  useEffect(() => garder(() => JSON.stringify(f) !== reference.current), [f]);
  useEffect(() => { if (route.value.query.get('ia') === '1' && etatServeur.value.ia) setTimeout(() => choixIA.current && choixIA.current.click(), 300); }, []);

  if (!pret.value) return <Chargement />;
  if (!nouveauProduit && !source) return <><TetePage titre="Produit" parent="/produits" /><div class="carte"><Vide icone="etiquette" titre="Produit introuvable" texte="Il a peut-être été supprimé." /></div></>;

  const maj = (p) => setF((x) => ({ ...x, ...p }));
  const champ = (k) => (e) => { maj({ [k]: e.currentTarget.value }); if (erreurs[k]) setErreurs({ ...erreurs, [k]: '' }); };
  const cles = R.clesVariantes(f);

  /* Cadre de l'article demandé à l'assistant (sauf s'il est déjà connu), puis photo recadrée et éclairée ; null si rien à faire. */
  async function retoucher(fichier, cadreConnu) {
    let cadre = cadreConnu;
    if (cadre === undefined) { const a = await compresser(fichier, 1024, 0.8); cadre = (await cadreIA(await lireFichier(a.blob), a.blob.type, f.title)).cadre; }
    return cadre ? cadrerPhoto(fichier, cadre) : null;
  }

  async function ajouterPhotos(fichiers, couleurPhoto, cadreConnu) {
    const l = [...fichiers].filter((x) => /^image\//.test(x.type)).slice(0, 10);
    const auto = etatServeur.value.ia && cadrage;
    for (const fichier of l) {
      setEnvois((n) => n + 1);
      try {
        const c = await compresser(fichier, 1600, 0.82);
        const envoi = envoyerPhoto(c.blob);
        let r = null;
        if (auto) { try { r = await retoucher(fichier, cadreConnu); } catch (e) { r = null; } }
        let m = { ...(await envoi), w: c.w, h: c.h };
        if (r) m = { ...(await envoyerPhoto(r.blob)), w: r.w, h: r.h, orig: m };
        setF((x) => ({ ...x, images: [...(x.images || []), { ...m, ...(couleurPhoto ? { color: couleurPhoto } : {}) }] }));
        toast(r ? 'Photo cadrée et éclairée par l’assistant' : auto ? 'Photo ajoutée telle quelle (l’assistant n’a pas pu la cadrer)' : `Photo ajoutée (${taille(c.avant)} → ${taille(c.apres)})`, { icone: r ? 'ia' : 'image' });
      } catch (e) { gererErreur(e, 'Cette photo n’a pas pu être ajoutée'); }
      setEnvois((n) => n - 1);
    }
  }

  /* Photo déjà sur la fiche (ajoutée avant le cadrage automatique) : l'assistant la cadre, l'originale reste disponible. */
  async function retoucherExistante(i) {
    const m0 = f.images[i]; if (!m0 || m0.type !== 'pb' || enRetouche) return;
    setEnRetouche(m0);
    try {
      const rep = await fetch(urlFichierServeur(m0)); if (!rep.ok) throw new Error('photo');
      const r = await retoucher(await rep.blob());
      if (!r) toast('L’assistant n’a pas trouvé d’article à cadrer sur cette photo', { icone: 'alerte' });
      else {
        const m = { ...(await envoyerPhoto(r.blob)), w: r.w, h: r.h };
        setF((x) => ({ ...x, images: x.images.map((y) => (y === m0 ? { ...y, ...m, orig: media(y) } : y)) }));
        toast('Photo cadrée et éclairée par l’assistant', { icone: 'ia' });
      }
    } catch (e) {
      if (MESSAGES_IA[e.code]) toast(MESSAGES_IA[e.code], { icone: 'alerte', ton: 'danger', duree: 5000 });
      else gererErreur(e, 'L’assistant n’a pas pu cadrer cette photo');
    }
    setEnRetouche(null);
  }

  async function remplirIA(fichier) {
    if (!fichier || ia.occupe) return;
    setIa({ ...ia, occupe: true, message: '', erreur: false, rayon: '' });
    let photoAjoutee = false;
    try {
      const c = await compresser(fichier, 1280, 0.85);
      const r = await ficheIA(await lireFichier(c.blob), c.blob.type, ia.indice);
      setF((x) => ({
        ...x, title: r.title || x.title, description: r.description || x.description, details: r.details || x.details, tags: r.tags || x.tags,
        options: { colors: x.options.colors.length ? x.options.colors : r.colors, sizes: x.options.sizes.length ? x.options.sizes : r.sizes },
        collectionIds: [...new Set([...(x.collectionIds || []), ...(r.collectionIds || [])])]
      }));
      // Le cadre vient avec la fiche : un seul appel à l'assistant pour le texte et la photo.
      photoAjoutee = true; await ajouterPhotos([fichier], undefined, r.cadre || null);
      if (r.alt) setF((x) => ({ ...x, images: x.images.map((m, i) => (i === x.images.length - 1 && !m.alt ? { ...m, alt: r.alt } : m)) }));
      setIa((s) => ({ ...s, occupe: false, erreur: false, rayon: r.collectionIds && r.collectionIds.length ? '' : r.newCollection, message: `Fiche remplie par l’assistant. Relisez-la, puis indiquez le prix${f.source === 'import' ? '' : ' et le stock'}.` }));
    } catch (e) {
      if (!photoAjoutee) ajouterPhotos([fichier], undefined, null);
      setIa((s) => ({ ...s, occupe: false, erreur: true, message: MESSAGES_IA[e.code] || (e.status === 403 ? 'Session expirée : reconnectez-vous.' : 'L’assistant n’a pas répondu. Réessayez dans un instant.') }));
    }
  }
  async function creerRayonIA(nom = ia.rayon) {
    if (!nom) return;
    const existe = rayons.value.find((r) => r.name.trim().toLowerCase() === nom.toLowerCase());
    let rid = existe && existe.id;
    if (!rid) { rid = slug(nom) || uid(); if (rayons.value.some((r) => r.id === rid)) rid = uid(); try { await sauver('collections', rid, { name: nom, visible: true, order: rayons.value.length + 1 }); toast(`Rayon « ${nom} » créé`); } catch (e) { gererErreur(e); return; } }
    maj({ collectionIds: [...new Set([...(f.collectionIds || []), rid])] }); setIa({ ...ia, rayon: '' }); setRayonLien('');
  }

  function ajouterCouleur() {
    const nom = couleur.nom.trim().replace(/[.|]/g, '');
    if (!nom) { toast('Nommez la couleur', { icone: 'alerte', ton: 'danger' }); return; }
    if (f.options.colors.some((c) => c.name.toLowerCase() === nom.toLowerCase())) { toast('Cette couleur existe déjà', { icone: 'alerte', ton: 'danger' }); return; }
    maj({ options: { ...f.options, colors: [...f.options.colors, { name: nom, hex: couleur.hex }] } }); setCouleur({ ...couleur, nom: '' });
  }
  function ajouterTailles(l) {
    const t = l.map((x) => String(x).trim().replace(/[.|]/g, '')).filter((x) => x && !f.options.sizes.includes(x));
    if (t.length) maj({ options: { ...f.options, sizes: [...f.options.sizes, ...t] } });
  }

  async function enregistrer() {
    const e = {};
    const d = { ...f, title: R.nettoyer(f.title, 120), description: String(f.description || '').trim().slice(0, 3000), details: String(f.details || '').trim().slice(0, 1000), tags: R.nettoyer(f.tags, 200), sku: R.nettoyer(f.sku, 40) };
    d.price = R.arrondi(f.price); d.compareAt = R.arrondi(f.compareAt); d.cost = R.arrondi(f.cost);
    if (d.title.length < 2) e.title = 'Donnez un titre au produit.';
    if (!(d.price > 0) || d.price > 100000) e.price = 'Indiquez un prix de vente (entre $0.01 et $100 000).';
    if (d.cost < 0 || d.cost > 100000) e.cost = 'Coût invalide.';
    nettoyerComplements(d, e);
    if (Object.keys(e).length) { setErreurs(e); toast(Object.values(e)[0], { icone: 'alerte', ton: 'danger', duree: 4200 }); setTimeout(() => document.querySelector('.en-erreur .saisie')?.focus(), 50); return; }
    if (d.compareAt <= d.price) d.compareAt = 0;
    d.stock = Math.min(99999, R.int(d.stock)); d.sold = R.int(d.sold);
    d.variants = Object.fromEntries(R.clesVariantes(d).map((k) => [k, Math.min(99999, R.int((d.variants || {})[k]))]));
    d.images = (d.images || []).map((m) => (m.color && !d.options.colors.some((c) => c.name === m.color) ? (({ color, ...r }) => r)(m) : m));
    setOccupe(true);
    try {
      await sauverProduit(id, d, initial.current);
      reference.current = JSON.stringify(f);
      toast(nouveauProduit || duplique ? 'Produit ajouté à la boutique' : 'Produit enregistré');
      aller('/produits', { remplacer: true, forcer: true });
    } catch (err) { gererErreur(err); setOccupe(false); }
  }
  async function supprimerProduit() {
    if (!(await confirmer({ titre: 'Supprimer ce produit ?', texte: 'Il disparaît de la boutique. Les commandes passées restent intactes.', ok: 'Supprimer', danger: true }))) return;
    try { await retirer('products', id); reference.current = JSON.stringify(f); toast('Produit supprimé', { icone: 'poubelle' }); aller('/produits', { remplacer: true, forcer: true }); } catch (e) { gererErreur(e, 'Suppression impossible'); }
  }
  const decrirePhoto = (i) => {
    let texte = (f.images[i] && f.images[i].alt) || '';
    const fid = ouvrirFeuille({
      titre: 'Décrire la photo',
      contenu: () => <div class="formulaire"><p class="attenue petit">Une phrase courte de ce que montre la photo : lue par les lecteurs d’écran et utile au référencement.</p><div class="apercu-photo"><Photo m={f.images[i]} alt="" /></div><input class="saisie" defaultValue={texte} onInput={(e) => { texte = e.currentTarget.value; }} maxlength="140" placeholder={f.title ? `${f.title}, vue de face` : 'Ex. : robe fleurie verte, vue de face'} aria-label="Description de la photo" autofocus /></div>,
      pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => { setF((x) => ({ ...x, images: x.images.map((m, j) => (j === i ? { ...m, alt: R.nettoyer(texte, 140) } : m)) })); fermerFeuille(fid); }}>Enregistrer</button>
    });
  };
  const pr = R.num(f.price), co = R.num(f.cost); const marge = pr && co ? pr - co : null;

  return (
    <>
      <TetePage titre={nouveauProduit || duplique ? 'Nouveau produit' : 'Modifier le produit'} sous={source && !duplique ? source.title : ''} parent="/produits"
        actions={source && !duplique && R.estEnVente(source) ? <a class="btn btn-secondaire btn-s seulement-ordi" href={adresseBoutique(`/p/${id}/${slug(source.title)}`)} target="_blank" rel="noopener"><Icone n="oeil" />Voir dans la boutique</a> : null} />
      {f.demo ? <Note ton="info" icone="info" classe="marge-bas">Produit d’exemple : modifiez-le pour en faire le vôtre, ou supprimez-le.</Note> : null}
      <div class="formulaire-grille">
        <div class="pile-l">
          {etatServeur.value.ia ? (
            <section class="carte carte-ia">
              <div class="ia-tete"><span class="ia-icone"><Icone n="ia" /></span><div><h2>Assistant IA</h2><p>Ajoutez une photo de l’article : l’assistant rédige le titre, la description et les caractéristiques, repère les couleurs et choisit le rayon. Vous vérifiez, puis vous mettez le prix.</p></div></div>
              <Champ libelle="Indication pour l’assistant" facultatif>{(a) => <input class="saisie" {...a} value={ia.indice} onInput={(e) => setIa({ ...ia, indice: e.currentTarget.value })} maxlength="200" placeholder="Ex. : cuir véritable, existe aussi en marron" />}</Champ>
              <div class="rangee-l espace-haut">
                <label class={classes('btn btn-primaire', ia.occupe && 'charge')}><Icone n="envoyer" />{f.images.length ? 'Nouvelle photo' : 'Choisir une photo'}<input ref={choixIA} type="file" accept="image/*" hidden disabled={ia.occupe} onChange={(e) => { const x = e.currentTarget.files[0]; e.currentTarget.value = ''; remplirIA(x); }} /></label>
              </div>
              {ia.occupe ? <p class="ia-etat" role="status"><span class="rouet" aria-hidden="true" />L’assistant regarde la photo et rédige la fiche…</p> : ia.message ? <p class={classes('ia-etat', ia.erreur ? 'erreur' : 'ok')} role="status"><Icone n={ia.erreur ? 'alerte' : 'coche'} />{ia.message}</p> : null}
              {ia.rayon && !ia.occupe ? <button class="btn btn-doux btn-s espace-haut" onClick={() => creerRayonIA()}><Icone n="plus" />Créer le rayon « {ia.rayon} » et l’utiliser</button> : null}
            </section>
          ) : null}
          {nouveauProduit || duplique || !f.images.length ? <CarteLien setF={setF} onRayon={setRayonLien} /> : null}
          {rayonLien ? <button class="btn btn-doux btn-s" style={{ justifySelf: 'start' }} onClick={() => creerRayonIA(rayonLien)}><Icone n="plus" />Créer le rayon « {rayonLien} » et l’utiliser</button> : null}

          <section class="carte">
            <h2 class="carte-titre"><Icone n="image" />Photos<span class="fin">{f.images.length ? pluriel(f.images.length, 'photo') : ''}</span></h2>
            <div class="grille-photos">
              {f.images.map((m, i) => (
                <div key={(m.id || m.src || '') + i} class={classes('tuile-photo', i === 0 && 'principale')}>
                  <Photo m={m} alt={f.title} tailles="160px" />
                  {enRetouche === m ? <span class="tp-retouche" role="status" aria-label="L’assistant cadre la photo"><span class="rouet" /></span> : null}
                  {i === 0 ? <span class="tp-badge">Principale</span> : <button class="tp-badge bouton" aria-label={`Mettre la photo ${i + 1} en premier`} onClick={() => { const l = [...f.images]; const [x] = l.splice(i, 1); l.unshift(x); maj({ images: l }); }}>En premier</button>}
                  {m.orig || m.retouche ? (
                    <button class={classes('btn-icone mini tp-ia', m.orig && 'retouchee')} aria-pressed={m.orig ? 'true' : 'false'} aria-label={`Retouche de l’assistant sur la photo ${i + 1}`} title={m.orig ? 'Retouchée : toucher pour revoir l’originale' : 'Originale : toucher pour reprendre la retouche'} onClick={() => maj({ images: f.images.map((x, j) => (j === i ? basculerRetouche(x) : x)) })}><Icone n="ia" /></button>
                  ) : etatServeur.value.ia && m.type === 'pb' ? (
                    <button class="btn-icone mini tp-ia" aria-label={`Cadrer la photo ${i + 1} avec l’assistant`} title="Cadrer avec l’assistant" disabled={!!enRetouche} onClick={() => retoucherExistante(i)}><Icone n="ia" /></button>
                  ) : null}
                  <div class="tp-actions">
                    <button class="btn-icone mini" aria-label={`Décrire la photo ${i + 1}`} onClick={() => decrirePhoto(i)} title="Description"><Icone n="crayon" /></button>
                    <button class="btn-icone mini" aria-label={`Retirer la photo ${i + 1}`} onClick={() => maj({ images: f.images.filter((_, j) => j !== i) })}><Icone n="poubelle" /></button>
                  </div>
                  {f.options.colors.length ? (
                    <select class="tp-couleur" value={m.color || ''} aria-label={`Couleur montrée sur la photo ${i + 1}`} onChange={(e) => maj({ images: f.images.map((x, j) => (j === i ? { ...x, color: e.currentTarget.value || undefined } : x)) })}>
                      <option value="">Toutes couleurs</option>{f.options.colors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  ) : null}
                </div>
              ))}
              {Array.from({ length: envois }, (_, i) => <div key={'e' + i} class="tuile-photo envoi"><span class="rouet" /></div>)}
              <label class="tuile-photo ajout"><Icone n="envoyer" /><span>Ajouter des photos</span><input type="file" accept="image/*" multiple hidden onChange={(e) => { const l = e.currentTarget.files; ajouterPhotos(l); e.currentTarget.value = ''; }} /></label>
            </div>
            {etatServeur.value.ia ? <div class="espace-haut"><Bascule actif={cadrage} onClick={() => { Local.ecrire('cadrage-auto', !cadrage); setCadrage(!cadrage); }} libelle="Cadrage automatique par l’assistant" sous="L’article est centré en grand au format de la boutique, la lumière est corrigée. La photo d’origine reste disponible sur chaque photo." /></div> : null}
            <p class="champ-aide espace-haut">Les photos sont redimensionnées et compressées automatiquement. Présentez l’article seul, sur un fond clair. Associez une photo à une couleur : elle s’affiche quand le client choisit cette couleur.</p>
          </section>

          <CarteVideo f={f} maj={maj} setEnvois={setEnvois} />

          <section class="carte">
            <h2 class="carte-titre"><Icone n="crayon" />Informations</h2>
            <div class="formulaire">
              <Champ libelle="Titre" erreur={erreurs.title}>{(a) => <input class="saisie" {...a} value={f.title} onInput={champ('title')} maxlength="120" placeholder="Ex. : Montre double fuseau en cuir" />}</Champ>
              <Champ libelle="Description" aide="Matière, usage, conseils : utile aux clients et au référencement.">{(a) => <textarea class="saisie" {...a} rows="4" value={f.description} onInput={champ('description')} maxlength="3000" />}</Champ>
              <Champ libelle="Caractéristiques" facultatif aide="Une ligne par caractéristique, au format « Nom : valeur ».">{(a) => <textarea class="saisie" {...a} rows="3" value={f.details} onInput={champ('details')} maxlength="1000" placeholder={'Matière : Cuir\nÉtanchéité : 3 ATM'} />}</Champ>
            </div>
          </section>

          <section class="carte">
            <h2 class="carte-titre"><Icone n="etiquette" />Prix et marge</h2>
            <div class="formulaire">
              <div class="deux-colonnes">
                <Champ libelle="Prix de vente" erreur={erreurs.price}>{(a) => <div class="saisie-groupe"><span class="prefixe">$</span><input class="saisie" {...a} inputmode="decimal" value={f.price === 0 ? '' : f.price} onInput={champ('price')} placeholder="0.00" /></div>}</Champ>
                <Champ libelle="Prix barré" facultatif aide="Ancien prix, pour une promotion.">{(a) => <div class="saisie-groupe"><span class="prefixe">$</span><input class="saisie" {...a} inputmode="decimal" value={f.compareAt || ''} onInput={champ('compareAt')} placeholder="0.00" /></div>}</Champ>
              </div>
              <Champ libelle="Coût par article" erreur={erreurs.cost} aide={`Achat + transport + douane. Jamais visible des clients.${prixFournisseur(f.supplier) ? ` Prix chez le fournisseur : ${prixFournisseur(f.supplier)}.` : ''}`}>{(a) => <div class="saisie-groupe"><span class="prefixe">$</span><input class="saisie" {...a} inputmode="decimal" value={f.cost || ''} onInput={champ('cost')} placeholder="0.00" /></div>}</Champ>
              {marge !== null ? (
                <div class="marge"><div><small>Marge par article</small><b style={{ color: marge >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{dollars(marge)}</b></div><div><small>Taux de marge</small><b>{Math.round((marge / pr) * 100)} %</b></div>{R.num(f.compareAt) > pr ? <div><small>Remise affichée</small><b>−{Math.round((1 - pr / R.num(f.compareAt)) * 100)} %</b></div> : null}</div>
              ) : <p class="champ-aide">Indiquez le prix et le coût pour voir votre marge.</p>}
              {f.supplier && f.supplier.url ? <p class="champ-aide">Page du fournisseur : <a class="lien" href={f.supplier.url} target="_blank" rel="noopener noreferrer">{(f.supplier.url.match(/^https?:\/\/([^/]+)/) || [])[1] || 'ouvrir'}</a></p> : null}
              <PrixGros f={f} maj={maj} />
            </div>
          </section>

          <section class="carte">
            <h2 class="carte-titre"><Icone n="calques" />Couleurs et tailles</h2>
            <div class="pile">
              <span class="champ-libelle">Couleurs</span>
              <div class="etiquettes">{f.options.colors.length ? f.options.colors.map((c, i) => <span key={c.name} class="etiq"><i style={{ background: c.hex }} />{c.name}<button aria-label={`Retirer ${c.name}`} onClick={() => maj({ options: { ...f.options, colors: f.options.colors.filter((_, j) => j !== i) } })}><Icone n="fermer" /></button></span>) : <span class="discret petit">Aucune couleur : article unique</span>}</div>
              <div class="ajout-ligne">
                <input class="saisie" value={couleur.nom} onInput={(e) => setCouleur({ ...couleur, nom: e.currentTarget.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterCouleur(); } }} placeholder="Nom de la couleur" maxlength="24" aria-label="Nom de la nouvelle couleur" />
                <input type="color" class="choix-couleur" value={couleur.hex} onInput={(e) => setCouleur({ ...couleur, hex: e.currentTarget.value })} aria-label="Teinte de la nouvelle couleur" />
                <button class="btn btn-secondaire" onClick={ajouterCouleur}><Icone n="plus" />Ajouter</button>
              </div>
              <div class="nuancier">{NUANCIER.map((h) => <button key={h} style={{ '--c': h }} aria-pressed={couleur.hex === h ? 'true' : 'false'} aria-label={`Teinte ${h}`} onClick={() => setCouleur({ ...couleur, hex: h })} />)}</div>
              <span class="champ-libelle espace-haut">Tailles</span>
              <div class="etiquettes">{f.options.sizes.length ? f.options.sizes.map((t, i) => <span key={t} class="etiq">{t}<button aria-label={`Retirer ${t}`} onClick={() => maj({ options: { ...f.options, sizes: f.options.sizes.filter((_, j) => j !== i) } })}><Icone n="fermer" /></button></span>) : <span class="discret petit">Aucune taille</span>}</div>
              <div class="ajout-ligne">
                <input class="saisie" value={tailleNouvelle} onInput={(e) => setTailleNouvelle(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterTailles([tailleNouvelle]); setTailleNouvelle(''); } }} placeholder="Ex. : M, 42, 6 ans" maxlength="14" aria-label="Nouvelle taille" />
                <button class="btn btn-secondaire" onClick={() => { ajouterTailles([tailleNouvelle]); setTailleNouvelle(''); }}><Icone n="plus" />Ajouter</button>
              </div>
              <div class="rangee-l">{PRESETS.map(([t, l]) => <button key={t} class="puce" onClick={() => ajouterTailles(l)}><Icone n="plus" />{t}</button>)}</div>
            </div>
          </section>

          {f.source !== 'import' ? (
            <section class="carte">
              <h2 class="carte-titre"><Icone n="colis" />{cles.length ? 'Stock et prix par variante' : 'Stock'}<span class="fin">{cles.length ? `${cles.reduce((a, k) => a + R.int(f.variants[k]), 0)} au total` : ''}</span></h2>
              {cles.length ? <TableauVariantes f={f} maj={maj} cles={cles} avecStock /> : <div class="formulaire"><Champ libelle="Quantité en stock">{(a) => <input class="saisie" {...a} inputmode="numeric" value={f.stock} onInput={(e) => maj({ stock: e.currentTarget.value.replace(/\D/g, '') })} />}</Champ></div>}
              <p class="champ-aide espace-haut">Le stock baisse automatiquement à chaque commande et revient si la commande est annulée.</p>
              <AttenteClients id={id} />
              <div class="formulaire espace-haut"><Champ libelle="Référence (SKU)" facultatif>{(a) => <input class="saisie" {...a} value={f.sku} onInput={champ('sku')} maxlength="40" />}</Champ></div>
            </section>
          ) : cles.length ? (
            <section class="carte">
              <h2 class="carte-titre"><Icone n="etiquette" />Prix par variante</h2>
              <TableauVariantes f={f} maj={maj} cles={cles} />
            </section>
          ) : null}

          <CarteGuide f={f} maj={maj} />
        </div>

        <div class="pile-l colonne-cote">
          <section class="carte">
            <h2 class="carte-titre"><Icone n="oeil" />Statut</h2>
            <Segment plein libelle="Statut" options={[['active', 'En vente'], ['draft', 'Brouillon']]} valeur={f.status === 'draft' ? 'draft' : 'active'} onChange={(v) => maj({ status: v })} />
            <p class="champ-aide espace-haut">{f.status === 'draft' ? 'Masqué dans la boutique.' : 'Visible dans la boutique dès l’enregistrement.'}</p>
          </section>
          <CarteFlash f={f} maj={maj} />
          {erreurs.flash ? <p class="champ-erreur" role="alert"><Icone n="alerte" />{erreurs.flash}</p> : null}
          <section class="carte">
            <h2 class="carte-titre"><Icone n="avion" />Disponibilité</h2>
            <Segment plein libelle="Disponibilité" options={[['local', 'En stock'], ['import', 'Import Chine']]} valeur={f.source === 'import' ? 'import' : 'local'} onChange={(v) => maj({ source: v })} />
            <p class="champ-aide espace-haut">{f.source === 'import' ? `Vendu sur commande, livré en ≈ ${cfg.value.importDays} jours. Pas de stock à gérer.` : `Expédié depuis ${cfg.value.city}, livré sous 24–48 h.`}</p>
          </section>
          <CarteColis f={f} maj={maj} />
          <section class="carte">
            <h2 class="carte-titre"><Icone n="rayons" />Organisation</h2>
            <span class="champ-libelle">Rayons</span>
            <div class="rangee-l espace-haut-s">{rayons.value.length ? rayons.value.map((r) => { const on = (f.collectionIds || []).includes(r.id); return <button key={r.id} class="puce" aria-pressed={on ? 'true' : 'false'} onClick={() => maj({ collectionIds: on ? f.collectionIds.filter((x) => x !== r.id) : [...(f.collectionIds || []), r.id] })}>{on ? <Icone n="coche" /> : null}{r.name}</button>; }) : <a class="lien petit" href={lien('/rayons/nouveau')}>Créer un rayon</a>}</div>
            <div class="formulaire espace-haut">
              <Champ libelle="Mots-clés" facultatif aide="Aident les clients à trouver l’article.">{(a) => <input class="saisie" {...a} value={f.tags} onInput={champ('tags')} maxlength="200" placeholder="Ex. : cadeau, cuir, homme" />}</Champ>
              <Bascule actif={!!f.featured} onClick={() => maj({ featured: !f.featured })} libelle="Mettre en avant" sous="Badge « Tendance » et place en tête de la boutique" />
            </div>
          </section>
          {source && !duplique ? (
            <section class="carte">
              <h2 class="carte-titre"><Icone n="plusieurs" />Autres actions</h2>
              <div class="pile">
                {R.estEnVente(source) ? <a class="btn btn-secondaire btn-bloc" href={adresseBoutique(`/p/${id}/${slug(source.title)}`)} target="_blank" rel="noopener"><Icone n="oeil" />Voir dans la boutique</a> : null}
                <LienAvis id={id} />
                <a class="btn btn-secondaire btn-bloc" href={lien(`/produits/${id}/copie`)}><Icone n="dupliquer" />Dupliquer</a>
                <button class="btn btn-danger btn-bloc" onClick={supprimerProduit}><Icone n="poubelle" />Supprimer</button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <BarreEnregistrer modifie={modifie} occupe={occupe} desactive={envois > 0} onEnregistrer={enregistrer} onAnnuler={() => aller('/produits')} libelle={nouveauProduit || duplique ? 'Ajouter le produit' : 'Enregistrer'} />
    </>
  );
}

/* Avis des clients sur cet article (note moyenne des avis publiés) : mène à la page Avis, filtrée sur l'article. */
function LienAvis({ id }) {
  if (!peut('avis')) return null;
  const l = avis.value.filter((a) => a.produit === id);
  if (!l.length) return null;
  const publies = l.filter((a) => a.etat === 'publie');
  const note = publies.length ? publies.reduce((t, a) => t + a.note, 0) / publies.length : 0;
  return <a class="btn btn-secondaire btn-bloc" href={lien('/avis?produit=' + encodeURIComponent(id))}><Icone n="etoile" />Avis des clients{publies.length ? ` · ${noteFr(Math.round(note * 10) / 10)} ★ (${publies.length})` : ` (${l.length})`}</a>;
}

/* La fiche n'est montée qu'une fois les données chargées (ouverture directe par un lien). */
/* Clients qui attendent cet article (« Prévenez-moi ») : prévenus d'eux-mêmes dès que le stock revient. */
function AttenteClients({ id }) {
  useEffect(() => { chargerAttentes(); }, [id]);
  const a = attentes.value[id];
  if (!a || !a.total) return null;
  const detail = Object.entries(a.variantes).filter(([k]) => k).map(([k, n]) => `${R.libelleVariante(k)} : ${n}`).join(', ');
  return <Note ton="info" icone="cloche" classe="espace-haut">{pluriel(a.total, 'client attend', 'clients attendent')} le retour de cet article{detail ? ` (${detail})` : ''}. Ils seront prévenus d’eux-mêmes, par notification, dès que vous remettez du stock.</Note>;
}

export function FicheProduit() {
  if (!pret.value) return <Chargement />;
  return <FormulaireProduit key={route.value.cle} />;
}
