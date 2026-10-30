// Sokoyetu (administration) — audience de la boutique : qui est en ligne, visiteurs par jour, et chaque article en détail
// (vues, paniers, favoris, commandes). Les chiffres viennent du serveur et se rafraîchissent seuls toutes les 15 secondes.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Note, Segment, Pastille, Vide } from '../../commun/js/interface.jsx';
import { Local } from '../../commun/js/stockage.js';
import { debutJour, JOUR, pluriel, groupe, classes, dollars, ilya, telephone } from '../../commun/js/outils.js';
import { lien, route } from '../routeur.js';
import { cfg, commandes, clients, comptes, produitsParId, pret, lireAudience, lireAudienceArticle, gererErreur } from '../etat.js';
import { TetePage, Kpi } from '../composants/cadre.jsx';
import { Histogramme } from '../composants/graphique.jsx';
import { Chargement, LigneCommandeCourte, venteDu, estVente } from './accueil.jsx';
import { panierDuCompte } from './clients.jsx';

/* Un client avec compte : nom, téléphone, et ce qu'il a mis de côté. */
const LigneCompte = ({ a, texte }) => (
  <a class="ligne" href={lien('/clients/' + R.chiffres(a.phone))}>
    <span class="ligne-vignette ronde" aria-hidden="true">{(a.name || '?')[0].toUpperCase()}</span>
    <span class="ligne-texte"><b>{a.name || 'Client'}</b><small>{telephone(a.phone) || a.phone} · {texte}</small></span>
    <Icone n="droite" classe="chevron" />
  </a>
);

const RYTHME = 15000;
const PERIODES = [[1, 'Aujourd’hui'], [7, '7 jours'], [30, '30 jours']];
const LIBELLES = { 1: 'aujourd’hui', 7: 'sur 7 jours', 30: 'sur 30 jours' };
const nb = (n) => groupe(R.int(n));
// Les jours du serveur (« 2026-10-25 », heure de Bukavu) deviennent des dates locales pour l'histogramme.
const versDate = (j) => new Date(j + 'T00:00:00').getTime();

/* Lit les chiffres tout de suite, puis toutes les 15 s tant que la page est à l'écran. */
export function useEnDirect(lire, deps) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    let fini = false, minuteur = 0;
    const tour = async () => {
      clearTimeout(minuteur);
      if (document.visibilityState !== 'hidden') {
        try { const r = await lire(); if (!fini) { setDonnees(r); setErreur(false); } }
        catch (e) { if (!fini) { setErreur(true); if (e.status === 401) gererErreur(e); } }
      }
      if (!fini) minuteur = setTimeout(tour, RYTHME);
    };
    const visible = () => { if (document.visibilityState === 'visible') tour(); };
    tour(); document.addEventListener('visibilitychange', visible);
    return () => { fini = true; clearTimeout(minuteur); document.removeEventListener('visibilitychange', visible); };
  }, deps);
  return [donnees, erreur];
}

function usePeriode() {
  const [periode, setPeriode] = useState(Local.lire('periodeAudience', 7));
  return [periode, (p) => { setPeriode(p); Local.ecrire('periodeAudience', p); }];
}

/* Commandes payées de chaque article sur la période (quantités et clients différents). */
function ventesParArticle(debut) {
  const m = new Map();
  commandes.value.forEach((o) => {
    if (!estVente(o) || venteDu(o) < debut) return;
    (o.items || []).forEach((i) => {
      const v = m.get(i.productId) || { commandes: 0, qte: 0 };
      v.commandes++; v.qte += R.int(i.qty); m.set(i.productId, v);
    });
  });
  return m;
}

const EnDirect = ({ n, texte }) => <span class={classes('en-direct', n > 0 && 'actif')}><i aria-hidden="true" />{texte}</span>;

const TRIS = [['vues', 'Les plus vus'], ['enLigne', 'Regardés en ce moment'], ['dansPaniers', 'Dans des paniers'], ['dansFavoris', 'En favoris'], ['paniers', 'Mis au panier sur la période'], ['commandes', 'Les plus commandés']];

export function Audience() {
  const [periode, changer] = usePeriode();
  const [tri, setTri] = useState(Local.lire('triAudience', 'vues'));
  const [a, erreur] = useEnDirect(() => lireAudience(periode), [periode]);
  if (!pret.value || (!a && !erreur)) return <><TetePage titre="Audience" /><Chargement /></>;
  const lib = LIBELLES[periode];
  const debut = debutJour(Date.now()) - (periode - 1) * JOUR;
  const ventes = ventesParArticle(debut);
  const parId = new Map(((a && a.produits) || []).map((x) => [x.id, x]));
  ventes.forEach((v, id) => { if (!parId.has(id)) parId.set(id, { id, vues: 0, visiteurs: 0, paniers: 0, favoris: 0, dansPaniers: 0, dansFavoris: 0, enLigne: 0 }); });
  const articles = [...parId.values()].map((x) => {
    const p = produitsParId.value.get(x.id); const v = ventes.get(x.id) || { commandes: 0, qte: 0 };
    return { ...x, p, commandes: v.commandes, qte: v.qte };
  }).filter((x) => x.p);
  articles.sort((x, y) => (y[tri] - x[tri]) || (y.vues - x.vues) || (y.dansPaniers - x.dansPaniers));
  const jours = ((a && a.jours) || []).map((j) => ({ t: versDate(j.jour), v: j.visiteurs, n: j.vues }));
  const nClients = clients.value.length;

  return (
    <>
      <TetePage titre="Audience" sous={a ? <EnDirect n={a.enLigne} texte={`En direct · actualisé toutes les 15 s${erreur ? ' · connexion perdue, nouvel essai…' : ''}`} /> : 'Connexion au serveur impossible'}
        actions={<Segment libelle="Période" options={PERIODES} valeur={periode} onChange={(v) => changer(Number(v))} />} />
      {!a ? <div class="carte"><Vide icone="alerte" titre="Chiffres indisponibles" texte="Le serveur ne répond pas. Nouvel essai automatique dans quelques secondes." /></div> : (
        <div class="pile-l">
          <div class="kpis">
            <Kpi grand libelle="En ligne maintenant" icone="oeil" valeur={nb(a.enLigne)} sous={a.enLigne ? pluriel(a.enLigne, 'personne sur la boutique', 'personnes sur la boutique') : 'Personne pour l’instant'} ton={a.enLigne ? 'ok' : ''} />
            <Kpi libelle={`Visiteurs ${lib}`} icone="personnes" valeur={nb(a.visiteurs)} sous={a.nouveaux ? `dont ${pluriel(a.nouveaux, 'nouveau', 'nouveaux')}` : 'appareils différents'} />
            <Kpi libelle={`Articles vus ${lib}`} icone="etiquette" valeur={nb(a.vues)} sous={a.visiteurs ? `${(a.vues / Math.max(1, a.visiteurs)).toFixed(1).replace('.', ',')} par visiteur` : 'pages d’articles ouvertes'} />
            <Kpi libelle="Clients" icone="recu" valeur={nb(nClients)} sous={`${comptes.value.length ? pluriel(comptes.value.length, 'compte') + ' · ' : ''}${nb(a.visiteursTotal)} visiteurs en ${a.gardeJours} j`} href={lien('/clients')} />
          </div>
          <div class="tableau-grille">
            <div class="pile-l">
              <section class="carte">
                <h2 class="carte-titre"><Icone n="graphique" />Visiteurs par jour<span class="fin">{jours.length} derniers jours</span></h2>
                <Histogramme jours={jours} titre="Visiteurs par jour" unites={{ long: (v) => pluriel(R.int(v), 'visiteur'), court: (v) => nb(v), detail: (j) => pluriel(j.n, 'article vu', 'articles vus'), colonnes: ['Articles vus', 'Visiteurs'], vide: 'Aucune visite sur la période' }} />
              </section>
              <section class="carte">
                <h2 class="carte-titre"><Icone n="etiquette" />Articles<span class="fin">{lib}</span></h2>
                <label class="tri-audience"><span class="attenue petit">Trier par</span>
                  <select class="saisie" value={tri} onChange={(e) => { setTri(e.currentTarget.value); Local.ecrire('triAudience', e.currentTarget.value); }}>{TRIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                {articles.length ? <div class="liste sans-bord espace-haut">{articles.slice(0, 50).map((x) => <LigneArticle key={x.id} x={x} />)}</div>
                  : <p class="attenue petit espace-haut">Dès qu’un visiteur ouvre un article, le met au panier ou en favori, il apparaît ici.</p>}
              </section>
            </div>
            <div class="pile-l">
              <section class="carte">
                <h2 class="carte-titre"><Icone n="oeil" />En ce moment</h2>
                {articles.some((x) => x.enLigne) ? <div class="liste sans-bord">{articles.filter((x) => x.enLigne).sort((x, y) => y.enLigne - x.enLigne).slice(0, 8).map((x) => (
                  <a key={x.id} class="ligne" href={lien('/audience/' + x.id)}>
                    <span class="ligne-vignette"><Photo m={R.imagePrincipale(x.p)} alt="" tailles="48px" /></span>
                    <span class="ligne-texte"><b>{x.p.title}</b><small>{pluriel(x.enLigne, 'personne le regarde', 'personnes le regardent')}</small></span>
                  </a>
                ))}</div> : <p class="attenue petit">{a.enLigne ? `${pluriel(a.enLigne, 'visiteur parcourt', 'visiteurs parcourent')} la boutique, sans article ouvert.` : 'Aucun visiteur sur la boutique en ce moment.'}</p>}
              </section>
              <PaniersARelancer />
              <Note ton="info" icone="cadenas">Un visiteur sans compte est un téléphone ou un ordinateur, compté sans nom ni numéro. Vous connaissez une personne quand elle commande, ou quand elle crée son compte : vous voyez alors son nom, son téléphone, son panier et ses favoris. Compteurs effacés au bout de {a.gardeJours} jours.</Note>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* Clients avec compte dont le panier attend : les plus récents d'abord, pour les relancer. */
function PaniersARelancer() {
  const l = comptes.value.map((a) => ({ a, pa: panierDuCompte(a) })).filter((x) => x.pa.lignes.length).sort((x, y) => y.pa.depuis - x.pa.depuis);
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="sac" />Paniers à relancer<span class="fin">{pluriel(l.length, 'client')}</span></h2>
      {l.length ? <div class="liste sans-bord">{l.slice(0, 8).map(({ a, pa }) => <LigneCompte key={a.id} a={a} texte={`${pluriel(pa.lignes.reduce((s, x) => s + x.qty, 0), 'article')} · ${dollars(pa.valeur)}${pa.depuis ? ' · ' + ilya(pa.depuis) : ''}${a.relance ? ' · rappel envoyé ' + ilya(a.relance) : ''}`} />)}</div>
        : <p class="attenue petit">{comptes.value.length ? 'Aucun client avec compte n’a d’article en attente dans son panier.' : 'Quand un client avec compte met un article au panier sans commander, il apparaît ici avec son nom et son téléphone.'}</p>}
      <p class="champ-aide espace-haut">{cfg.value.cartReminder.enabled
        ? `Rappel automatique : ${cfg.value.cartReminder.hours} h après son dernier ajout au panier, le client reçoit une notification gratuite, une fois par panier et au plus une fois par semaine.`
        : 'Rappel automatique des paniers désactivé (Réglages → Général).'}</p>
    </section>
  );
}

function LigneArticle({ x }) {
  const details = [x.vues ? pluriel(x.vues, 'vue') : 'pas vu sur la période', x.paniers ? pluriel(x.paniers, 'mise au panier', 'mises au panier') : '', x.favoris ? pluriel(x.favoris, 'favori') : '', x.commandes ? pluriel(x.commandes, 'commande payée', 'commandes payées') : ''].filter(Boolean);
  return (
    <a class="ligne" href={lien('/audience/' + x.id)}>
      <span class="ligne-vignette"><Photo m={R.imagePrincipale(x.p)} alt="" tailles="48px" /></span>
      <span class="ligne-texte"><b>{x.p.title}</b><small>{details.join(' · ')}</small>
        {x.enLigne || x.dansPaniers || x.dansFavoris ? <span class="ligne-pastilles">
          {x.enLigne ? <Pastille ton="ok" point>{x.enLigne} en ligne</Pastille> : null}
          {x.dansPaniers ? <Pastille ton="marque" icone="sac">{pluriel(x.dansPaniers, 'panier')}</Pastille> : null}
          {x.dansFavoris ? <Pastille ton="info" icone="coeur">{pluriel(x.dansFavoris, 'favori')}</Pastille> : null}
        </span> : null}</span>
      <span class="ligne-fin"><b>{nb(x.vues)}</b><small>vues</small></span>
    </a>
  );
}

export function AudienceArticle() {
  const id = route.value.segs[1];
  const [periode, changer] = usePeriode();
  const [a, erreur] = useEnDirect(() => lireAudienceArticle(id, periode), [id, periode]);
  const p = produitsParId.value.get(id);
  if (!pret.value || (!a && !erreur)) return <><TetePage titre="Article" parent="/audience" /><Chargement /></>;
  if (!p) return <><TetePage titre="Article" parent="/audience" /><div class="carte"><Vide icone="etiquette" titre="Article introuvable" texte="Il a peut-être été supprimé du catalogue." /></div></>;
  const lib = LIBELLES[periode];
  const debut = debutJour(Date.now()) - (periode - 1) * JOUR;
  const avecArticle = commandes.value.filter((o) => (o.items || []).some((i) => i.productId === id));
  const payees = avecArticle.filter((o) => estVente(o) && venteDu(o) >= debut);
  const qte = payees.reduce((s, o) => s + (o.items || []).filter((i) => i.productId === id).reduce((t, i) => t + R.int(i.qty), 0), 0);
  const acheteurs = new Set(payees.map((o) => o.phone || (o.customer && o.customer.name))).size;
  const jours = ((a && a.jours) || []).map((j) => ({ t: versDate(j.jour), v: j.vues, n: j.visiteurs, paniers: j.paniers, favoris: j.favoris }));
  const t = (a && a.total) || { vues: 0, visiteurs: 0, paniers: 0, favoris: 0 };
  const conversion = t.visiteurs ? Math.round((acheteurs / t.visiteurs) * 100) : 0;
  // Clients avec compte qui ont l'article au panier ou en favori, les plus récents d'abord.
  const gardes = comptes.value.map((c) => {
    const ligne = c.panier.find((l) => l.productId === id); const fav = c.favoris.includes(id);
    if (!ligne && !fav) return null;
    const d = c.dates || {}; const quand = Math.max(d['panier:' + id] || 0, d['favori:' + id] || 0);
    return { a: c, quand, texte: [ligne ? `au panier (${ligne.qty})` : '', fav ? 'en favori' : '', quand ? ilya(quand) : ''].filter(Boolean).join(' · ') };
  }).filter(Boolean).sort((x, y) => y.quand - x.quand);

  return (
    <>
      <TetePage titre={p.title} sous={a ? <EnDirect n={a.enLigne} texte={a.enLigne ? `${pluriel(a.enLigne, 'personne le regarde', 'personnes le regardent')} en ce moment` : 'Personne ne le regarde en ce moment'} /> : ''} parent="/audience"
        actions={<Segment libelle="Période" options={PERIODES} valeur={periode} onChange={(v) => changer(Number(v))} />} />
      {!a ? <div class="carte"><Vide icone="alerte" titre="Chiffres indisponibles" texte="Le serveur ne répond pas. Nouvel essai automatique dans quelques secondes." /></div> : (
        <div class="pile-l">
          <div class="kpis">
            <Kpi grand libelle={`Vues ${lib}`} icone="oeil" valeur={nb(t.vues)} sous={t.visiteurs ? pluriel(t.visiteurs, 'visiteur différent', 'visiteurs différents') : 'Pas encore vu sur la période'} />
            <Kpi libelle="Dans des paniers" icone="sac" valeur={nb(a.dansPaniers)} sous={`en ce moment · ${pluriel(t.paniers, 'ajout', 'ajouts')} ${lib}`} />
            <Kpi libelle="En favoris" icone="coeur" valeur={nb(a.dansFavoris)} sous={`en ce moment · ${pluriel(t.favoris, 'ajout', 'ajouts')} ${lib}`} />
            <Kpi libelle={`Commandé ${lib}`} icone="recu" valeur={nb(payees.length)} sous={payees.length ? `${pluriel(qte, 'pièce vendue', 'pièces vendues')}${t.visiteurs ? ` · ${conversion} % des visiteurs` : ''}` : 'aucune commande payée'} />
          </div>
          <div class="tableau-grille">
            <div class="pile-l">
              <section class="carte">
                <h2 class="carte-titre"><Icone n="graphique" />Vues par jour<span class="fin">{jours.length} derniers jours</span></h2>
                <Histogramme jours={jours} titre="Vues de l’article par jour" unites={{ long: (v) => pluriel(R.int(v), 'vue'), court: (v) => nb(v), detail: (j) => `${pluriel(j.n, 'visiteur')} · ${pluriel(j.paniers, 'panier')} · ${pluriel(j.favoris, 'favori')}`, colonnes: ['Visiteurs', 'Vues'], vide: 'Aucune vue sur la période' }} />
              </section>
              <section class="carte">
                <h2 class="carte-titre"><Icone n="personnes" />Ceux qui l’ont commandé<span class="fin">{pluriel(avecArticle.length, 'commande')}</span></h2>
                {avecArticle.length ? <div class="liste sans-bord">{avecArticle.slice(0, 50).map((o) => <LigneCommandeCourte key={o.id} o={o} />)}</div>
                  : <p class="attenue petit">Personne n’a encore commandé cet article. Chaque commande apparaîtra ici avec le nom et le téléphone du client.</p>}
              </section>
            </div>
            <div class="pile-l">
              <section class="carte">
                <div class="ligne sans-bord">
                  <span class="ligne-vignette"><Photo m={R.imagePrincipale(p)} alt="" tailles="48px" /></span>
                  <span class="ligne-texte"><b>{p.title}</b><small>{!R.estEnVente(p) ? 'Pas en vente' : R.estImport(p) ? 'Import sur commande' : pluriel(R.stockTotal(p), 'pièce en stock', 'pièces en stock')}</small></span>
                </div>
                <a class="btn btn-secondaire btn-s espace-haut" href={lien('/produits/' + id)}><Icone n="crayon" />Modifier la fiche</a>
              </section>
              <section class="carte">
                <h2 class="carte-titre"><Icone n="personne" />Clients avec compte<span class="fin">{pluriel(gardes.length, 'client')}</span></h2>
                {gardes.length ? <div class="liste sans-bord">{gardes.map((x) => <LigneCompte key={x.a.id} a={x.a} texte={x.texte} />)}</div>
                  : <p class="attenue petit">Aucun client avec compte n’a cet article dans son panier ou ses favoris.</p>}
              </section>
              <Note ton="info" icone="cadenas">Sans compte, paniers et favoris sont anonymes : la boutique sait combien de personnes ont mis l’article de côté, pas qui. Ceux qui ont un compte sont nommés ci-dessus : vous pouvez les appeler. Pour les autres, une réduction ou une bannière sur cet article est un bon levier.</Note>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
