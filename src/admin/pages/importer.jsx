// Sokoyetu (administration) — import en masse : tableau Excel/CSV (ou copié depuis Google Sheets), ou liste de liens fournisseurs.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Note, Bascule, Segment, Pastille, toast } from '../../commun/js/interface.jsx';
import { dollars, pluriel, uid, classes, normaliser, slug } from '../../commun/js/outils.js';
import { aller } from '../routeur.js';
import { rayons, etatServeur, sauver, lireFournisseur, copierPhoto, gererErreur } from '../etat.js';
import { TetePage } from '../composants/cadre.jsx';
import { MESSAGES_IMPORT, MAX_PHOTOS_IMPORT, prixFournisseur } from './produits-plus.jsx';

const MAX_LIGNES = 300;
const MAX_LIENS = 30;

/* ---------- Lecture des tableaux ---------- */

/* CSV ou texte collé depuis un tableur : séparateur deviné (point-virgule d'Excel en français, virgule, tabulation). */
export function lireCsv(texte) {
  texte = String(texte || '').replace(/^﻿/, '');
  const premiere = texte.split(/\r?\n/)[0] || '';
  const sep = ['\t', ';', ','].map((s) => [s, premiere.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lignes = []; let ligne = []; let cell = ''; let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (guillemets) {
      if (ch === '"' && texte[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') guillemets = false; else cell += ch;
    } else if (ch === '"' && !cell) guillemets = true;
    else if (ch === sep) { ligne.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texte[i + 1] === '\n') i++; ligne.push(cell); lignes.push(ligne); ligne = []; cell = ''; }
    else cell += ch;
  }
  if (cell || ligne.length) { ligne.push(cell); lignes.push(ligne); }
  return lignes.filter((l) => l.some((c) => String(c).trim()));
}

/* Fichier Excel (.xlsx) : première feuille, lue dans le navigateur (aucun envoi). */
async function lireXlsx(buf) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne lit pas les fichiers Excel : enregistrez le tableau en CSV, ou copiez-collez ses cellules.');
  const dv = new DataView(buf); const dec = new TextDecoder();
  let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Fichier Excel illisible.');
  const fichiers = {}; let o = dv.getUint32(e + 16, true);
  for (let i = 0, n = dv.getUint16(e + 10, true); i < n; i++) {
    const nl = dv.getUint16(o + 28, true), el = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true);
    fichiers[dec.decode(new Uint8Array(buf, o + 46, nl))] = { methode: dv.getUint16(o + 10, true), taille: dv.getUint32(o + 20, true), local: dv.getUint32(o + 42, true) };
    o += 46 + nl + el + cl;
  }
  const lire = async (nom) => {
    const f = fichiers[nom]; if (!f) return '';
    const debut = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = new Uint8Array(buf, debut, f.taille);
    if (f.methode === 0) return dec.decode(data);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const textes = [...xml(await lire('xl/sharedStrings.xml') || '<sst/>').getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  // Première feuille du classeur (son fichier est donné par les relations du classeur).
  let chemin = 'xl/worksheets/sheet1.xml';
  try {
    const feuille = xml(await lire('xl/workbook.xml')).getElementsByTagName('sheet')[0];
    const rid = feuille && (feuille.getAttribute('r:id') || feuille.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = [...xml(await lire('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    if (rel) chemin = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
  } catch (err) { }
  const colonne = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const lignes = [];
  for (const r of xml(await lire(chemin)).getElementsByTagName('row')) {
    const l = [];
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0];
      const val = t === 's' ? textes[+((v && v.textContent) || 0)] || '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v ? v.textContent : '';
      l[colonne(c.getAttribute('r'))] = val;
    }
    lignes.push(Array.from(l, (x) => x || ''));
  }
  return lignes.filter((l) => l.some((c) => String(c).trim()));
}

/* ---------- Colonnes du modèle ---------- */

const COLONNES = {
  title: ['titre', 'nom', 'title', 'produit', 'article'], price: ['prix', 'prixdevente', 'price', 'prixvente'], compareAt: ['prixbarre', 'ancienprix', 'compareat'],
  cost: ['cout', 'coutachat', 'cost', 'prixachat', 'coutpararticle'], stock: ['stock', 'quantite', 'qte'], source: ['disponibilite', 'source', 'provenance'],
  rayon: ['rayon', 'rayons', 'categorie', 'categories', 'category'], colors: ['couleurs', 'couleur', 'colors', 'color'], sizes: ['tailles', 'taille', 'sizes', 'size'],
  description: ['description'], details: ['caracteristiques', 'details', 'caracteristique'], tags: ['motscles', 'tags', 'motcle'],
  photos: ['photos', 'photo', 'images', 'image'], sku: ['reference', 'sku', 'ref'], weight: ['poids', 'poidskg', 'weight'],
  supplier: ['lienfournisseur', 'fournisseur', 'lien', 'url'], status: ['statut', 'status', 'etat']
};
const MODELE = [
  ['titre', 'prix', 'prix_barre', 'cout', 'stock', 'disponibilite', 'rayon', 'couleurs', 'tailles', 'description', 'caracteristiques', 'mots_cles', 'photos', 'reference', 'poids', 'lien_fournisseur', 'statut'],
  ['Robe midi bordeaux', '25', '32', '9.5', '4', 'stock', 'Femmes', 'Bordeaux, Noir', 'S, M, L, XL', 'Robe d’été mi-longue, cintrée à la taille.', 'Matière : Polyester | Longueur : Mi-mollet', 'robe, été', 'https://exemple.com/robe-1.jpg https://exemple.com/robe-2.jpg', 'RB-001', '0.4', '', 'en vente'],
  ['Montre connectée', '39', '', '14', '', 'import', 'Électronique', 'Noir', '', 'Suivi des pas, du sommeil et des appels.', 'Écran : 1,8 pouce | Autonomie : 7 jours', 'montre, sport', '', '', '0.2', 'https://detail.1688.com/offer/000000000.html', 'brouillon']
];
const TEINTES = { noir: '#1F1D22', blanc: '#F5F3F0', gris: '#9A9AA0', rouge: '#C8344A', bordeaux: '#7A1F2B', rose: '#F4A7C0', violet: '#9C8BD1', mauve: '#B48CC8', bleu: '#3F6EA8', bleuciel: '#8EC3E6', marine: '#1F2F4F', bleumarine: '#1F2F4F', turquoise: '#3FB8AF', vert: '#4F8A5B', kaki: '#6B6B3A', jaune: '#F2B544', orange: '#D0663D', marron: '#8B5E3C', chocolat: '#5A3A22', camel: '#C19A6B', beige: '#D8CFC2', creme: '#F3E9D2', dore: '#C9A227', or: '#C9A227', argent: '#C0C0C0', argente: '#C0C0C0', black: '#1F1D22', white: '#F5F3F0', red: '#C8344A', blue: '#3F6EA8', green: '#4F8A5B', pink: '#F4A7C0' };
const cleColonne = (s) => normaliser(s).replace(/[^a-z0-9]/g, '');
const liste = (s) => String(s || '').split(/\s*[,;|/]\s*/).map((x) => x.trim()).filter(Boolean);

function telechargerModele() {
  const csv = MODELE.map((l) => l.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'modele-produits-sokoyetu.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* Une ligne du tableau → { doc, photos, rayons, alertes, erreur }. */
export function versProduit(entete, cells) {
  const idx = {};
  entete.forEach((h, i) => { const k = cleColonne(h); for (const [champ, noms] of Object.entries(COLONNES)) if (noms.includes(k) && !(champ in idx)) idx[champ] = i; });
  const v = (k) => (k in idx ? String(cells[idx[k]] == null ? '' : cells[idx[k]]).trim() : '');
  const alertes = [];
  const title = R.nettoyer(v('title'), 120);
  if (title.length < 2) return { erreur: 'Titre manquant' };
  const couleurs = liste(v('colors')).slice(0, 12).map((n) => ({ name: R.nettoyer(n, 24).replace(/[.|]/g, ''), hex: TEINTES[cleColonne(n)] || '#9A9AA0' }));
  const tailles = [...new Set(liste(v('sizes')).map((t) => R.nettoyer(t, 14).replace(/[.|]/g, '')))].slice(0, 20);
  const source = /import|chine|commande/i.test(v('source')) ? 'import' : 'local';
  const doc = {
    title, description: v('description').slice(0, 3000), details: v('details').split(/\s*\|\s*|\n/).map((x) => x.trim()).filter(Boolean).join('\n').slice(0, 1000),
    price: R.arrondi(v('price')), compareAt: R.arrondi(v('compareAt')), cost: R.arrondi(v('cost')), source,
    status: /brouillon|draft|masqu/i.test(v('status')) ? 'draft' : 'active', collectionIds: [], tags: R.nettoyer(v('tags'), 200), featured: false, images: [],
    options: { colors: couleurs, sizes: tailles }, variants: {}, stock: 0, sku: R.nettoyer(v('sku'), 40), sold: 0,
    variantPrices: {}, wholesale: [], flash: null, sizeGuide: null, weight: Math.min(1000, R.arrondi(v('weight'))) || 0, dims: null, video: null,
    supplier: /^https?:\/\//i.test(v('supplier')) ? { url: v('supplier').slice(0, 600), price: 0, currency: '' } : null
  };
  if (doc.compareAt <= doc.price) doc.compareAt = 0;
  if (!(doc.price > 0)) { doc.price = 0; doc.status = 'draft'; alertes.push('sans prix : ajouté en brouillon'); }
  const qte = Math.min(99999, R.int(v('stock')));
  if (R.aDesOptions(doc)) doc.variants = Object.fromEntries(R.clesVariantes(doc).map((k) => [k, source === 'import' ? 0 : qte]));
  else doc.stock = source === 'import' ? 0 : qte;
  if (source === 'local' && !qte) alertes.push('stock à 0');
  const photos = v('photos').split(/[\s,;|]+/).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
  return { doc, photos, rayons: liste(v('rayon')).slice(0, 4), alertes };
}

/* Rayon par son nom : existant, ou créé (une seule fois par import). */
async function rayonPour(nom, crees) {
  const k = normaliser(nom).trim();
  const r = rayons.value.find((x) => normaliser(x.name).trim() === k) || crees.get(k);
  if (r) return r.id;
  let id = slug(nom) || uid(); if (rayons.value.some((x) => x.id === id)) id = uid();
  await sauver('collections', id, { name: R.nettoyer(nom, 40), visible: true, order: rayons.value.length + 1 });
  crees.set(k, { id }); return id;
}

/* ---------- Page ---------- */

export function ImportProduits() {
  const [mode, setMode] = useState('tableau');
  const [lignes, setLignes] = useState([]);       // [{ doc, photos, rayons, alertes, erreur, choisi, etat, apercu }]
  const [colle, setColle] = useState('');
  const [liens, setLiens] = useState('');
  const [avecIA, setAvecIA] = useState(true);
  const [taux, setTaux] = useState('7.2');
  const [coef, setCoef] = useState('2.5');
  const [enVente, setEnVente] = useState(false);
  const [travail, setTravail] = useState(null);   // { fait, total, texte }
  const ia = etatServeur.value.ia;

  function depuisTableau(t) {
    if (t.length < 2) { toast('Le tableau doit avoir une ligne de titres et au moins un produit', { icone: 'alerte', ton: 'danger' }); return; }
    if (t.length - 1 > MAX_LIGNES) toast(`${MAX_LIGNES} produits au plus par import : les suivants sont ignorés`, { icone: 'alerte', ton: 'danger' });
    const [entete, ...reste] = t;
    if (!entete.some((h) => COLONNES.title.includes(cleColonne(h)))) { toast('Colonne « titre » introuvable : partez du modèle à télécharger', { icone: 'alerte', ton: 'danger', duree: 5000 }); return; }
    setLignes(reste.slice(0, MAX_LIGNES).map((c) => { const r = versProduit(entete, c); return { ...r, choisi: !r.erreur, etat: '' }; }));
  }
  async function choisirFichier(fichier) {
    if (!fichier) return;
    try {
      const t = /\.xlsx$/i.test(fichier.name) ? await lireXlsx(await fichier.arrayBuffer()) : lireCsv(await fichier.text());
      depuisTableau(t);
    } catch (e) { toast(e.message || 'Fichier illisible', { icone: 'alerte', ton: 'danger', duree: 5000 }); }
  }

  /* Liens fournisseurs : chaque page est lue (et rédigée par l'assistant), les photos ne sont copiées qu'à l'ajout. */
  async function lireLiens() {
    const l = [...new Set(liens.split(/\s+/).filter((u) => /^https?:\/\//i.test(u)))].slice(0, MAX_LIENS);
    if (!l.length) { toast('Collez au moins un lien, un par ligne', { icone: 'alerte', ton: 'danger' }); return; }
    const out = [];
    for (let i = 0; i < l.length; i++) {
      setTravail({ fait: i, total: l.length, texte: 'Lecture des pages' });
      try {
        const r = await lireFournisseur(l[i], ia && avecIA);
        const fi = r.fiche || {};
        const cout = r.currency === 'CNY' ? R.arrondi(R.num(r.price) / Math.max(0.1, R.num(taux))) : r.currency === 'USD' ? R.arrondi(r.price) : 0;
        const doc = {
          title: R.nettoyer(fi.title || r.title, 120) || 'Article importé', description: fi.description || '', details: fi.details || '',
          price: cout ? R.arrondi(cout * Math.max(1, R.num(coef))) : 0, compareAt: 0, cost: cout, source: 'import', status: enVente && cout ? 'active' : 'draft',
          collectionIds: fi.collectionIds || [], tags: fi.tags || '', featured: false, images: [], options: { colors: fi.colors || [], sizes: fi.sizes || [] }, variants: {}, stock: 0, sku: '', sold: 0,
          variantPrices: {}, wholesale: [], flash: null, sizeGuide: null, weight: 0, dims: null, video: null,
          supplier: { url: r.url, price: R.arrondi(r.price), currency: r.currency || '' }
        };
        const alertes = [!r.fiche ? 'titre à traduire' : '', !cout ? 'prix à indiquer' : '', !r.images.length ? 'aucune photo' : ''].filter(Boolean);
        out.push({ doc, photos: r.images.slice(0, MAX_PHOTOS_IMPORT), rayons: fi.newCollection && !(fi.collectionIds || []).length ? [fi.newCollection] : [], alertes, choisi: true, etat: '', alt: fi.alt || '' });
      } catch (e) {
        if (e.status === 401) { gererErreur(e); setTravail(null); return; }
        out.push({ erreur: `${l[i].replace(/^https?:\/\//, '').slice(0, 48)}… : ${MESSAGES_IMPORT[e.code] ? MESSAGES_IMPORT[e.code].split('.')[0] : e.message || 'illisible'}`, choisi: false });
      }
      setLignes([...out]);
    }
    setTravail(null);
  }

  async function ajouter() {
    const a = lignes.map((l, i) => [l, i]).filter(([l]) => l.choisi && !l.erreur && l.etat !== 'ok');
    if (!a.length) return;
    const crees = new Map(); let ok = 0;
    for (let n = 0; n < a.length; n++) {
      const [l, i] = a[n];
      setTravail({ fait: n, total: a.length, texte: 'Ajout des produits' });
      try {
        const images = [];
        for (const u of l.photos || []) { try { images.push(await copierPhoto(u)); } catch (e) { if (e.status === 401) throw e; } }
        if (images[0] && l.alt) images[0] = { ...images[0], alt: l.alt };
        const ids = [...(l.doc.collectionIds || [])];
        for (const nom of l.rayons || []) ids.push(await rayonPour(nom, crees));
        await sauver('products', uid(), { ...l.doc, images, collectionIds: [...new Set(ids)], createdAt: Date.now() });
        ok++;
        setLignes((x) => x.map((y, j) => (j === i ? { ...y, etat: 'ok', photosCopiees: images.length } : y)));
      } catch (e) {
        if (e.status === 401) { gererErreur(e); break; }
        setLignes((x) => x.map((y, j) => (j === i ? { ...y, etat: 'echec', message: e.message || 'échec' } : y)));
      }
    }
    setTravail(null);
    if (ok) toast(`${pluriel(ok, 'produit ajouté', 'produits ajoutés')}`, { icone: 'coche' });
  }

  const valides = lignes.filter((l) => !l.erreur);
  const choisis = valides.filter((l) => l.choisi && l.etat !== 'ok');
  const faits = lignes.filter((l) => l.etat === 'ok').length;
  return (
    <>
      <TetePage titre="Importer des produits" sous="Plusieurs articles d’un coup" parent="/produits" />
      <div class="pile-l import-page">
        <Segment plein libelle="Source" options={[['tableau', 'Tableau Excel ou CSV'], ['liens', 'Liens fournisseurs']]} valeur={mode} onChange={(v) => { setMode(v); setLignes([]); }} />

        {mode === 'tableau' ? (
          <section class="carte">
            <h2 class="carte-titre"><Icone n="telecharger" />Tableau de produits</h2>
            <ol class="etapes-import">
              <li>Téléchargez le modèle et ouvrez-le dans Excel, Google Sheets ou WPS : une ligne par produit.</li>
              <li>Photos : collez leurs liens (séparés par un espace). Couleurs et tailles : séparées par des virgules. Stock : quantité pour chaque couleur et taille.</li>
              <li>Choisissez le fichier (.xlsx ou .csv), ou copiez les cellules et collez-les ci-dessous.</li>
            </ol>
            <div class="rangee-l espace-haut">
              <button class="btn btn-secondaire" onClick={telechargerModele}><Icone n="telecharger" />Télécharger le modèle</button>
              <label class="btn btn-primaire"><Icone n="envoyer" />Choisir le fichier<input type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const x = e.currentTarget.files[0]; e.currentTarget.value = ''; choisirFichier(x); }} /></label>
            </div>
            <div class="formulaire espace-haut">
              <Champ libelle="Ou collez les cellules" facultatif aide="Avec la ligne des titres de colonnes.">{(a) => <textarea class="saisie mono" {...a} rows="4" value={colle} onInput={(e) => setColle(e.currentTarget.value)} placeholder={'titre\tprix\tstock\nRobe midi\t25\t4'} />}</Champ>
              {colle.trim() ? <button class="btn btn-doux btn-s" style={{ justifySelf: 'start' }} onClick={() => depuisTableau(lireCsv(colle))}><Icone n="coche" />Lire le tableau collé</button> : null}
            </div>
          </section>
        ) : (
          <section class="carte">
            <h2 class="carte-titre"><Icone n="lien" />Liens fournisseurs</h2>
            <p class="champ-aide">Un lien par ligne (1688, Alibaba, AliExpress, Taobao…), {MAX_LIENS} au plus. Chaque page est lue : photos, titre et prix d’usine. Les articles sont ajoutés en « Import Chine ».</p>
            <div class="formulaire espace-haut">
              <Champ libelle="Liens">{(a) => <textarea class="saisie mono" {...a} rows="5" value={liens} onInput={(e) => setLiens(e.currentTarget.value)} placeholder={'https://detail.1688.com/offer/…\nhttps://www.alibaba.com/product-detail/…'} />}</Champ>
              {ia ? <Bascule actif={avecIA} onClick={() => setAvecIA(!avecIA)} libelle="Fiches rédigées en français par l’assistant" sous="Traduction du titre, description, couleurs et tailles" /> : <Note ton="info" icone="info">Sans l’assistant IA, les titres restent dans la langue du fournisseur : traduisez-les avant de mettre en vente.</Note>}
              <div class="deux-colonnes">
                <Champ libelle="Taux du yuan" aide="Yuans pour 1 $ (prix 1688, Taobao).">{(a) => <div class="saisie-groupe a-suffixe sans-prefixe"><input class="saisie" {...a} inputmode="decimal" value={taux} onInput={(e) => setTaux(e.currentTarget.value)} /><span class="suffixe">¥</span></div>}</Champ>
                <Champ libelle="Prix de vente" aide="Coût d’usine multiplié par ce nombre.">{(a) => <div class="saisie-groupe"><span class="prefixe">×</span><input class="saisie" {...a} inputmode="decimal" value={coef} onInput={(e) => setCoef(e.currentTarget.value)} /></div>}</Champ>
              </div>
              <Bascule actif={enVente} onClick={() => setEnVente(!enVente)} libelle="Mettre en vente directement" sous={enVente ? 'Visibles dans la boutique dès l’ajout (sauf ceux sans prix)' : 'Ajoutés en brouillon : vous relisez chaque fiche avant de la publier'} />
              <button class={classes('btn btn-primaire', travail && 'charge')} style={{ justifySelf: 'start' }} onClick={lireLiens} disabled={!!travail || !liens.trim()}><Icone n="recherche" />Lire les pages</button>
            </div>
          </section>
        )}

        {travail ? <div class="carte"><p class="ia-etat" role="status"><span class="rouet" aria-hidden="true" />{travail.texte} : {travail.fait + 1} sur {travail.total}…</p><div class="jauge"><i style={{ width: `${Math.round((travail.fait / travail.total) * 100)}%` }} /></div></div> : null}

        {lignes.length ? (
          <section class="carte">
            <h2 class="carte-titre"><Icone n="etiquette" />Aperçu<span class="fin">{faits ? `${faits} ajouté${faits > 1 ? 's' : ''} · ` : ''}{pluriel(choisis.length, 'à ajouter', 'à ajouter')}</span></h2>
            <div class="liste">
              {lignes.map((l, i) => l.erreur ? (
                <div key={i} class="ligne import-ligne"><span class="ligne-vignette"><Icone n="alerte" /></span><span class="ligne-texte"><b>Ligne {i + 1}</b><small class="texte-danger">{l.erreur}</small></span></div>
              ) : (
                <label key={i} class={classes('ligne import-ligne', l.etat === 'ok' && 'fait')}>
                  <input type="checkbox" checked={l.choisi} disabled={l.etat === 'ok' || !!travail} onChange={() => setLignes((x) => x.map((y, j) => (j === i ? { ...y, choisi: !y.choisi } : y)))} aria-label={`Ajouter ${l.doc.title}`} />
                  <span class="ligne-vignette grande">{l.photos && l.photos[0] ? <Photo m={{ type: 'url', src: l.photos[0] }} alt="" tailles="64px" /> : <Icone n="image" />}</span>
                  <span class="ligne-texte"><b>{l.doc.title}</b>
                    <small>{[l.doc.source === 'import' ? 'Import Chine' : R.aDesOptions(l.doc) ? `${R.stockTotal(l.doc)} en stock · ${pluriel(R.clesVariantes(l.doc).length, 'variante')}` : `${l.doc.stock} en stock`, l.photos && l.photos.length ? pluriel(l.photos.length, 'photo') : 'sans photo', (l.rayons || []).join(', '), prixFournisseur(l.doc.supplier) ? `usine ${prixFournisseur(l.doc.supplier)}` : ''].filter(Boolean).join(' · ')}</small>
                    <span class="ligne-pastilles">{l.etat === 'ok' ? <Pastille ton="ok" icone="coche">Ajouté</Pastille> : l.etat === 'echec' ? <Pastille ton="danger" icone="alerte">{l.message}</Pastille> : null}{l.doc.status === 'draft' ? <Pastille ton="neutre" point>Brouillon</Pastille> : null}{(l.alertes || []).map((t) => <Pastille key={t} ton="warn">{t}</Pastille>)}</span>
                  </span>
                  <span class="ligne-fin"><b>{l.doc.price ? dollars(l.doc.price) : '—'}</b>{l.doc.cost ? <small>coût {dollars(l.doc.cost)}</small> : null}</span>
                </label>
              ))}
            </div>
            <div class="rangee-l espace-haut">
              <button class={classes('btn btn-primaire', travail && 'charge')} onClick={ajouter} disabled={!!travail || !choisis.length}><Icone n="plus" />Ajouter {pluriel(choisis.length, 'produit')}</button>
              {faits ? <button class="btn btn-secondaire" onClick={() => aller('/produits', { forcer: true })}>Voir les produits</button> : null}
            </div>
            <p class="champ-aide espace-haut">Les photos sont copiées sur votre serveur. Vérifiez ensuite chaque fiche : prix, stock et guide des tailles.</p>
          </section>
        ) : null}
      </div>
    </>
  );
}
