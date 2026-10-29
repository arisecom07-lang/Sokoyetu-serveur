// Sokoyetu (administration) — fiche produit, compléments : import par lien fournisseur, prix par variante, prix de gros,
// vente flash, guide des tailles, poids et dimensions, vidéo.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { urlMedia, taille } from '../../commun/js/medias.jsx';
import { envoyerVideo } from '../../commun/js/api.js';
import { Champ, Bascule, Pastille, toast } from '../../commun/js/interface.jsx';
import { dollars, dateHeure, classes } from '../../commun/js/outils.js';
import { etatServeur, lireFournisseur, copierPhoto, gererErreur } from '../etat.js';

export const MAX_PHOTOS_IMPORT = 8;
export const MAX_VIDEO = 30 * 1048576;
const DEVISES = { CNY: '¥', USD: '$', EUR: '€' };
export const prixFournisseur = (s) => (s && R.num(s.price) > 0 ? `${DEVISES[s.currency] || (s.currency || '') + ' '}${R.arrondi(s.price).toFixed(2)}` : '');

/* Valeur d'un champ date et heure (heure du téléphone) ↔ instant en millisecondes. */
const versSaisie = (t) => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const depuisSaisie = (v) => (v ? new Date(v).getTime() || 0 : 0);

/* ---------- Import depuis un lien fournisseur (1688, Alibaba, AliExpress…) ---------- */

export const MESSAGES_IMPORT = {
  bad_url: 'Collez le lien d’une page produit : 1688, Alibaba, AliExpress, Taobao, Tmall, Temu, Shein, Made-in-China ou DHgate.',
  blocked: 'Le site du fournisseur n’a pas laissé lire cette page (connexion ou vérification demandée). Enregistrez ses photos sur le téléphone, puis utilisez « Choisir une photo » de l’assistant.',
  network: 'Le site du fournisseur ne répond pas. Réessayez dans un instant.', limite: 'Trop de demandes pour le moment. Réessayez dans une minute.',
  reseau: 'Pas de connexion internet. Réessayez une fois reconnecté.'
};

/* Lit la page, copie les photos dans la boutique et renvoie ce qu'il faut ajouter à la fiche. */
export async function importerLien(url, { ia, hint, auPasse } = {}) {
  const r = await lireFournisseur(url, ia, hint);
  const images = [];
  for (const src of (r.images || []).slice(0, MAX_PHOTOS_IMPORT)) {
    try { images.push(await copierPhoto(src)); if (auPasse) auPasse(images.length); } catch (e) { if (e.status === 401) throw e; }
  }
  const fi = r.fiche || null;
  if (fi && fi.alt && images[0]) images[0] = { ...images[0], alt: fi.alt };
  return {
    lu: r, images,
    champs: {
      title: (fi && fi.title) || R.nettoyer(r.title, 120), description: (fi && fi.description) || '', details: (fi && fi.details) || '', tags: (fi && fi.tags) || '',
      options: { colors: (fi && fi.colors) || [], sizes: (fi && fi.sizes) || [] }, collectionIds: (fi && fi.collectionIds) || [],
      source: 'import', supplier: { url: r.url, price: R.arrondi(r.price), currency: r.currency || '' }
    },
    nouveauRayon: fi && !(fi.collectionIds || []).length ? fi.newCollection : '',
    sansIA: !fi
  };
}

export function CarteLien({ setF, onRayon }) {
  const ia = etatServeur.value.ia;
  const [url, setUrl] = useState('');
  const [avecIA, setAvecIA] = useState(true);
  const [etat, setEtat] = useState({ occupe: false, message: '', erreur: false, photos: 0 });
  async function importer() {
    if (!url.trim() || etat.occupe) return;
    setEtat({ occupe: true, message: '', erreur: false, photos: 0 });
    try {
      const r = await importerLien(url.trim(), { ia: ia && avecIA, auPasse: (n) => setEtat((s) => ({ ...s, photos: n })) });
      setF((x) => {
        const c = r.champs;
        return {
          ...x, title: c.title || x.title, description: c.description || x.description, details: c.details || x.details, tags: c.tags || x.tags,
          options: { colors: x.options.colors.length ? x.options.colors : c.options.colors, sizes: x.options.sizes.length ? x.options.sizes : c.options.sizes },
          collectionIds: [...new Set([...(x.collectionIds || []), ...c.collectionIds])], source: 'import', supplier: c.supplier,
          images: [...(x.images || []), ...r.images]
        };
      });
      if (r.nouveauRayon) onRayon(r.nouveauRayon);
      const pf = prixFournisseur(r.champs.supplier);
      setEtat({ occupe: false, erreur: false, photos: 0, message: `${r.images.length ? `${r.images.length} photo${r.images.length > 1 ? 's' : ''} ajoutée${r.images.length > 1 ? 's' : ''}` : 'Aucune photo trouvée'}${pf ? `, prix fournisseur ${pf}` : ''}. ${r.sansIA ? 'Traduisez le titre et complétez la fiche' : 'Fiche rédigée par l’assistant : relisez-la'}, puis indiquez votre prix de vente.` });
      setUrl('');
    } catch (e) {
      if (e.status === 401) { gererErreur(e); return; }
      setEtat({ occupe: false, erreur: true, photos: 0, message: MESSAGES_IMPORT[e.code] || e.message || 'La page n’a pas pu être lue.' });
    }
  }
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="lien" />Importer depuis un lien</h2>
      <p class="champ-aide">Collez le lien d’un article chez votre fournisseur (1688, Alibaba, AliExpress, Taobao…) : ses photos, son titre et son prix d’usine sont repris dans la fiche.</p>
      <div class="ajout-ligne espace-haut">
        <input class="saisie" type="url" inputmode="url" value={url} onInput={(e) => setUrl(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); importer(); } }} placeholder="https://detail.1688.com/offer/…" aria-label="Lien de l’article chez le fournisseur" disabled={etat.occupe} />
        <button class={classes('btn btn-primaire', etat.occupe && 'charge')} onClick={importer} disabled={etat.occupe || !url.trim()}><Icone n="telecharger" />Importer</button>
      </div>
      {ia ? <div class="espace-haut-s"><Bascule actif={avecIA} onClick={() => setAvecIA(!avecIA)} libelle="Rédiger la fiche en français avec l’assistant" sous="Titre, description, couleurs et tailles traduits depuis la page" /></div> : null}
      {etat.occupe ? <p class="ia-etat" role="status"><span class="rouet" aria-hidden="true" />{etat.photos ? `Copie des photos (${etat.photos})…` : 'Lecture de la page du fournisseur…'}</p> : etat.message ? <p class={classes('ia-etat', etat.erreur ? 'erreur' : 'ok')} role="status"><Icone n={etat.erreur ? 'alerte' : 'coche'} />{etat.message}</p> : null}
    </section>
  );
}

/* ---------- Variantes : prix propre (facultatif) et stock ---------- */

export function TableauVariantes({ f, maj, cles, avecStock }) {
  const prixVar = f.variantPrices || {};
  return (
    <>
      {avecStock ? <div class="ajout-ligne"><input class="saisie" id="stock-partout" inputmode="numeric" placeholder="Même quantité partout" aria-label="Même quantité pour toutes les variantes" /><button class="btn btn-secondaire" onClick={() => { const v = R.int(document.getElementById('stock-partout').value); maj({ variants: Object.fromEntries(cles.map((k) => [k, v])) }); }}>Appliquer</button></div> : null}
      <div class={classes('tableau-stock', 'avec-prix', !avecStock && 'sans-stock')}>
        <div class="ts-ligne ts-tete" aria-hidden="true"><span>Variante</span><small>Prix</small>{avecStock ? <small>Stock</small> : null}</div>
        {cles.map((k) => {
          const [c, t] = k.split('|'); const hex = (f.options.colors.find((x) => x.name === c) || {}).hex; const nom = [c, t].filter(Boolean).join(' ');
          return (
            <div key={k} class="ts-ligne">
              <span>{hex ? <i style={{ background: hex }} /> : null}{[c, t].filter(Boolean).join(' · ')}</span>
              <div class="saisie-groupe compacte"><span class="prefixe">$</span><input class="saisie" inputmode="decimal" value={prixVar[k] || ''} placeholder={R.num(f.price) ? R.arrondi(f.price).toFixed(2) : 'prix'} onInput={(e) => maj({ variantPrices: { ...prixVar, [k]: e.currentTarget.value } })} aria-label={`Prix ${nom}`} /></div>
              {avecStock ? <input class="saisie" inputmode="numeric" value={f.variants[k] ?? 0} onInput={(e) => maj({ variants: { ...f.variants, [k]: e.currentTarget.value.replace(/\D/g, '') } })} aria-label={`Stock ${nom}`} /> : null}
            </div>
          );
        })}
      </div>
      <p class="champ-aide espace-haut">Prix vide : la variante est vendue au prix de l’article. Mettez un prix seulement pour celles qui coûtent plus ou moins cher (ex. XXL).</p>
    </>
  );
}

/* ---------- Prix de gros ---------- */

export function PrixGros({ f, maj }) {
  const l = Array.isArray(f.wholesale) ? f.wholesale : [];
  const pr = R.num(f.price);
  const changer = (i, p) => maj({ wholesale: l.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div class="pile espace-haut">
      <span class="champ-libelle">Prix de gros<span class="facultatif"> (facultatif)</span></span>
      <p class="champ-aide">Moins cher à la pièce quand le client en prend plusieurs (toutes couleurs et tailles confondues). {R.MAX_QTE} pièces au plus par article dans une commande, 50 % de réduction au plus.</p>
      {l.map((x, i) => (
        <div key={i} class="palier">
          <span>Dès</span>
          <input class="saisie" inputmode="numeric" value={x.min} onInput={(e) => changer(i, { min: e.currentTarget.value.replace(/\D/g, '') })} aria-label={`Palier ${i + 1} : nombre de pièces`} />
          <span>pièces :</span>
          <div class="saisie-groupe compacte a-suffixe"><span class="prefixe">−</span><input class="saisie" inputmode="numeric" value={x.pct} onInput={(e) => changer(i, { pct: e.currentTarget.value.replace(/\D/g, '') })} aria-label={`Palier ${i + 1} : réduction en %`} /><span class="suffixe">%</span></div>
          <small class="palier-prix">{pr && R.int(x.pct) ? `${dollars(pr * (100 - Math.min(50, R.int(x.pct))) / 100)} pièce` : ''}</small>
          <button class="btn-icone mini" aria-label={`Retirer le palier ${i + 1}`} onClick={() => maj({ wholesale: l.filter((_, j) => j !== i) })}><Icone n="poubelle" /></button>
        </div>
      ))}
      {l.length < R.MAX_PALIERS ? <button class="btn btn-doux btn-s" style={{ justifySelf: 'start' }} onClick={() => maj({ wholesale: [...l, { min: l.length ? Math.min(R.MAX_QTE, R.int(l[l.length - 1].min) + 3) : 3, pct: l.length ? R.int(l[l.length - 1].pct) + 5 : 5 }] })}><Icone n="plus" />Ajouter un palier</button> : null}
    </div>
  );
}

/* ---------- Vente flash ---------- */

export function CarteFlash({ f, maj }) {
  const fl = f.flash || null; const now = Date.now();
  const pr = R.num(f.price);
  const statut = !fl ? null : !R.int(fl.pct) || !R.num(fl.endsAt) ? ['neutre', 'À compléter'] : R.num(fl.endsAt) <= now ? ['neutre', 'Terminée'] : R.num(fl.startsAt) > now ? ['info', 'Programmée'] : ['ok', 'En cours'];
  const demain = () => { const d = new Date(now + R.JOUR); d.setHours(23, 59, 0, 0); return d.getTime(); };
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="horloge" />Vente flash{statut ? <span class="fin"><Pastille ton={statut[0]} point>{statut[1]}</Pastille></span> : null}</h2>
      <Bascule actif={!!fl} onClick={() => maj({ flash: fl ? null : { pct: 20, startsAt: 0, endsAt: demain() } })} libelle="Réduction pour une durée limitée" sous="Compte à rebours sur la fiche et badge sur la carte de l’article" />
      {fl ? (
        <div class="formulaire espace-haut">
          <Champ libelle="Réduction">{(a) => <div class="saisie-groupe a-suffixe"><span class="prefixe">−</span><input class="saisie" {...a} inputmode="numeric" value={fl.pct} onInput={(e) => maj({ flash: { ...fl, pct: e.currentTarget.value.replace(/\D/g, '') } })} /><span class="suffixe">%</span></div>}</Champ>
          <Champ libelle="Début" facultatif aide="Vide : tout de suite.">{(a) => <input class="saisie" {...a} type="datetime-local" value={versSaisie(fl.startsAt)} onInput={(e) => maj({ flash: { ...fl, startsAt: depuisSaisie(e.currentTarget.value) } })} />}</Champ>
          <Champ libelle="Fin">{(a) => <input class="saisie" {...a} type="datetime-local" value={versSaisie(fl.endsAt)} onInput={(e) => maj({ flash: { ...fl, endsAt: depuisSaisie(e.currentTarget.value) } })} />}</Champ>
          <div class="rangee-l">{[['24 h', 1], ['3 jours', 3], ['7 jours', 7]].map(([t, j]) => <button key={t} class="puce" onClick={() => maj({ flash: { ...fl, startsAt: 0, endsAt: now + j * R.JOUR } })}>{t}</button>)}</div>
          {pr && R.int(fl.pct) ? <p class="champ-aide"><b>{dollars(pr * (100 - Math.min(90, R.int(fl.pct))) / 100)}</b> au lieu de {dollars(pr)}{R.num(fl.endsAt) ? `, jusqu’au ${dateHeure(fl.endsAt)}` : ''}. Après la fin, le prix normal revient tout seul.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Guide des tailles ---------- */

const MESURES = ['Poitrine', 'Taille', 'Hanches', 'Longueur', 'Épaules', 'Manches', 'Entrejambe', 'Longueur du pied', 'Tour de poignet', 'Âge'];
export function CarteGuide({ f, maj }) {
  const tailles = R.taillesDe(f);
  const g = f.sizeGuide || { cols: [], rows: {}, note: '' };
  const [autre, setAutre] = useState('');
  const poser = (p) => maj({ sizeGuide: { ...g, ...p } });
  const ajouterCol = (n) => { n = R.nettoyer(n, 24); if (!n || g.cols.includes(n) || g.cols.length >= 6) return; poser({ cols: [...g.cols, n] }); };
  const retirerCol = (i) => poser({ cols: g.cols.filter((_, j) => j !== i), rows: Object.fromEntries(Object.entries(g.rows || {}).map(([t, v]) => [t, (v || []).filter((_, j) => j !== i)])) });
  const valeur = (t, i, v) => { const l = [...((g.rows || {})[t] || [])]; l[i] = v; poser({ rows: { ...(g.rows || {}), [t]: l } }); };
  if (!tailles.length) return null;
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="repere" />Guide des tailles</h2>
      <p class="champ-aide">Les mesures en centimètres pour chaque taille : le client choisit la bonne du premier coup, moins d’échanges.</p>
      <div class="rangee-l espace-haut">{MESURES.filter((m) => !g.cols.includes(m)).map((m) => <button key={m} class="puce" onClick={() => ajouterCol(m)} disabled={g.cols.length >= 6}><Icone n="plus" />{m}</button>)}</div>
      <div class="ajout-ligne espace-haut-s"><input class="saisie" value={autre} onInput={(e) => setAutre(e.currentTarget.value)} placeholder="Autre mesure" maxlength="24" aria-label="Autre mesure" /><button class="btn btn-secondaire" onClick={() => { ajouterCol(autre); setAutre(''); }} disabled={g.cols.length >= 6}><Icone n="plus" />Ajouter</button></div>
      {g.cols.length ? (
        <div class="guide-tableau espace-haut" style={{ '--n': g.cols.length }}>
          <div class="gt-ligne gt-tete"><span>Taille</span>{g.cols.map((c, i) => <span key={c}>{c}<button class="btn-icone mini" aria-label={`Retirer la colonne ${c}`} onClick={() => retirerCol(i)}><Icone n="fermer" /></button></span>)}</div>
          {tailles.map((t) => <div key={t} class="gt-ligne"><b>{t}</b>{g.cols.map((c, i) => <input key={c} class="saisie" inputmode="decimal" maxlength="12" value={((g.rows || {})[t] || [])[i] || ''} onInput={(e) => valeur(t, i, e.currentTarget.value)} aria-label={`${c}, taille ${t} (cm)`} placeholder="cm" />)}</div>)}
        </div>
      ) : null}
      {g.cols.length ? <div class="formulaire espace-haut"><Champ libelle="Conseil" facultatif>{(a) => <input class="saisie" {...a} value={g.note || ''} onInput={(e) => poser({ note: e.currentTarget.value })} maxlength="160" placeholder="Ex. : coupe ajustée, prenez une taille au-dessus" />}</Champ></div> : null}
    </section>
  );
}

/* ---------- Poids et dimensions ---------- */

export function CarteColis({ f, maj }) {
  const d = f.dims || {};
  const dim = (k) => (e) => maj({ dims: { ...d, [k]: e.currentTarget.value.replace(/[^\d.,]/g, '') } });
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="colis" />Poids et dimensions</h2>
      <div class="formulaire">
        <Champ libelle="Poids du colis" facultatif aide="Emballage compris. Sert au supplément par kilo des zones de livraison (Réglages).">{(a) => <div class="saisie-groupe a-suffixe sans-prefixe"><input class="saisie" {...a} inputmode="decimal" value={f.weight || ''} onInput={(e) => maj({ weight: e.currentTarget.value.replace(/[^\d.,]/g, '') })} placeholder="0.5" /><span class="suffixe">kg</span></div>}</Champ>
        <div><span class="champ-libelle">Dimensions<span class="facultatif"> (facultatif)</span></span>
          <div class="trois-cotes espace-haut-s">
            {[['l', 'Longueur'], ['w', 'Largeur'], ['h', 'Hauteur']].map(([k, t]) => <div key={k} class="saisie-groupe compacte a-suffixe sans-prefixe"><input class="saisie" inputmode="decimal" value={d[k] || ''} onInput={dim(k)} placeholder={t.slice(0, 4) + '.'} aria-label={`${t} (cm)`} /><span class="suffixe">cm</span></div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Vidéo ---------- */

const dureeVideo = (fichier) => new Promise((ok) => {
  const v = document.createElement('video'); const u = URL.createObjectURL(fichier);
  v.preload = 'metadata'; v.muted = true;
  v.onloadedmetadata = () => { ok(v.duration || 0); URL.revokeObjectURL(u); };
  v.onerror = () => { ok(0); URL.revokeObjectURL(u); };
  v.src = u;
});
export function CarteVideo({ f, maj, setEnvois }) {
  const [envoi, setEnvoi] = useState(false);
  async function choisir(fichier) {
    if (!fichier) return;
    if (!/^video\/(mp4|webm|quicktime)$/.test(fichier.type)) { toast('Choisissez une vidéo MP4 ou WebM', { icone: 'alerte', ton: 'danger' }); return; }
    if (fichier.size > MAX_VIDEO) { toast(`Vidéo trop lourde (${taille(fichier.size)}) : 30 Mo au plus. Coupez-la ou réduisez sa qualité.`, { icone: 'alerte', ton: 'danger', duree: 5000 }); return; }
    const d = await dureeVideo(fichier);
    if (d > 90) { toast('Vidéo trop longue : 1 min 30 au plus. 15 à 45 secondes suffisent.', { icone: 'alerte', ton: 'danger', duree: 5000 }); return; }
    setEnvoi(true); setEnvois((n) => n + 1);
    try { const m = await envoyerVideo(fichier); maj({ video: { ...m, duration: Math.round(d) } }); toast(`Vidéo ajoutée (${taille(fichier.size)})`, { icone: 'lecture' }); }
    catch (e) { gererErreur(e, 'La vidéo n’a pas pu être envoyée'); }
    setEnvoi(false); setEnvois((n) => n - 1);
  }
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="lecture" />Vidéo</h2>
      {f.video ? (
        <div class="pile">
          <video class="apercu-video" src={urlMedia(f.video)} controls playsInline preload="metadata" muted />
          <button class="btn btn-fantome btn-s" style={{ justifySelf: 'start' }} onClick={() => maj({ video: null })}><Icone n="poubelle" />Retirer la vidéo</button>
        </div>
      ) : (
        <label class={classes('btn btn-secondaire btn-bloc', envoi && 'charge')}><Icone n="envoyer" />{envoi ? 'Envoi de la vidéo…' : 'Ajouter une vidéo'}<input type="file" accept="video/mp4,video/webm,video/quicktime" hidden disabled={envoi} onChange={(e) => { const x = e.currentTarget.files[0]; e.currentTarget.value = ''; choisir(x); }} /></label>
      )}
      <p class="champ-aide espace-haut">15 à 45 secondes, l’article en main ou porté : elle passe en deuxième position dans la galerie. MP4, 30 Mo au plus.</p>
    </section>
  );
}

/* ---------- Enregistrement : compléments nettoyés ---------- */

export function nettoyerComplements(d, erreurs) {
  const cles = R.clesVariantes(d);
  const vp = {};
  cles.forEach((k) => { const v = R.arrondi((d.variantPrices || {})[k]); if (v > 0 && v <= 100000 && Math.abs(v - d.price) > 0.009) vp[k] = v; });
  d.variantPrices = vp;
  d.wholesale = R.paliersGros(d);
  if (d.flash) {
    const fl = { pct: Math.min(90, R.int(d.flash.pct)), startsAt: R.num(d.flash.startsAt) || 0, endsAt: R.num(d.flash.endsAt) || 0 };
    if (!fl.pct) erreurs.flash = 'Indiquez la réduction de la vente flash.';
    else if (!fl.endsAt) erreurs.flash = 'Indiquez la fin de la vente flash.';
    else if (fl.startsAt && fl.startsAt >= fl.endsAt) erreurs.flash = 'La vente flash doit finir après son début.';
    d.flash = fl;
  } else d.flash = null;
  const tailles = R.taillesDe(d); const g = d.sizeGuide;
  if (g && g.cols && g.cols.length && tailles.length) {
    d.sizeGuide = { cols: g.cols.slice(0, 6), rows: Object.fromEntries(tailles.map((t) => [t, g.cols.slice(0, 6).map((_, i) => R.nettoyer(((g.rows || {})[t] || [])[i], 12))])), note: R.nettoyer(g.note, 160) };
  } else d.sizeGuide = null;
  d.weight = Math.min(1000, R.arrondi(d.weight)) || 0;
  const dims = d.dims || {}; const dd = {}; ['l', 'w', 'h'].forEach((k) => { const v = Math.min(1000, R.arrondi(dims[k])); if (v > 0) dd[k] = v; });
  d.dims = Object.keys(dd).length ? dd : null;
  if (!d.video) d.video = null;
  if (d.supplier && !d.supplier.url) d.supplier = null;
  return d;
}
