// Sokoyetu (administration) — avis des clients sur les articles (propriétaire et vendeurs) : vérifier, répondre
// publiquement, masquer un avis abusif. Seuls les clients qui ont reçu l'article donnent leur avis.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Choix, Note, Vide, Pastille, toast, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { Etoiles, Repartition, noteFr } from '../../commun/js/etoiles.jsx';
import { pluriel, telephone, ilya, classes, normaliser } from '../../commun/js/outils.js';
import { lien, route } from '../routeur.js';
import { cfg, avis, avisAVerifier, produitsParId, modererAvis, gererErreur, peut } from '../etat.js';
import { TetePage, Kpi } from '../composants/cadre.jsx';

const ETATS = { publie: ['ok', 'Publié'], attente: ['alerte', 'À vérifier'], masque: ['neutre', 'Masqué'] };
const sansReponse = (a) => a.etat === 'publie' && a.note <= 3 && !a.reponse;
const FILTRES = [['attente', 'À vérifier', (a) => a.etat === 'attente'], ['sans-reponse', 'Sans réponse', sansReponse], ['tous', 'Tous', () => true], ['masques', 'Masqués', (a) => a.etat === 'masque']];

/* Masquer un avis : seulement s'il est abusif, avec un motif (montré au client qui l'a écrit). */
function ouvrirMasquer(a) {
  const f = ouvrirFeuille({ titre: 'Masquer cet avis', contenu: () => <Masquer a={a} fini={() => fermerFeuille(f)} /> });
}
function Masquer({ a, fini }) {
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);
  async function valider() {
    if (!motif || envoi) return;
    setEnvoi(true);
    try { await modererAvis(a.id, { action: 'masquer', motif }); toast('Avis masqué', { icone: 'oeilBarre' }); fini(); } catch (err) { gererErreur(err, 'Avis non masqué'); setEnvoi(false); }
  }
  return (
    <div class="pile-l">
      <Note icone="info">Un avis négatif mais honnête reste publié : répondez-y plutôt, c’est ce qui rassure les autres clients. Masquez seulement un avis abusif.</Note>
      <div class="pile" role="radiogroup" aria-label="Motif">
        {Object.entries(R.MOTIFS_AVIS).map(([k, t]) => <Choix key={k} actif={motif === k} onClick={() => setMotif(k)} icone="oeilBarre" titre={t} />)}
      </div>
      <p class="champ-aide">Le client voit ce motif dans « Mes avis » et peut modifier son avis : il repasse alors par votre vérification.</p>
      <button type="button" class={classes('btn btn-danger btn-l btn-bloc', envoi && 'charge')} disabled={!motif} onClick={valider}><Icone n="oeilBarre" />Masquer l’avis</button>
    </div>
  );
}

function LigneAvis({ a }) {
  const p = produitsParId.value.get(a.produit);
  const [reponse, setReponse] = useState(null);   // texte en cours d'écriture (null : formulaire fermé)
  const [envoi, setEnvoi] = useState('');
  const e = ETATS[a.etat] || ETATS.publie;
  const agir = async (corps, message, cle) => {
    setEnvoi(cle);
    try { await modererAvis(a.id, corps); toast(message, { icone: 'coche' }); if (corps.reponse !== undefined) setReponse(null); } catch (err) { gererErreur(err, 'Action impossible'); }
    setEnvoi('');
  };
  return (
    <article class={classes('carte avis-admin', a.etat !== 'publie' && 'etat-' + a.etat)}>
      <div class="avis-admin-tete">
        <a class="avis-admin-produit" href={lien('/produits/' + encodeURIComponent(a.produit))}>
          <span class="avis-admin-photo"><Photo m={p ? R.imagePrincipale(p) : null} alt="" tailles="48px" /></span>
          <span class="ligne-texte"><b>{p ? p.title : 'Article retiré'}</b><small>{a.variante || 'Article reçu'}</small></span>
        </a>
        <Pastille ton={e[0]}>{e[1]}</Pastille>
      </div>
      <div class="avis-admin-note">
        <Etoiles note={a.note} taille={18} />
        <span><b>{a.nom}</b><small>{ilya(a.cree)}{a.numero ? <> · <a class="lien" href={lien('/commandes/' + encodeURIComponent(a.commande))}>#{a.numero}</a></> : null}{a.telephone ? ` · ${telephone(a.telephone)}` : ''}</small></span>
      </div>
      {a.texte ? <p class="avis-texte">{a.texte}</p> : <p class="attenue petit">Note sans commentaire.</p>}
      {a.etat === 'masque' ? <Note ton="neutre" icone="oeilBarre">Masqué : {R.MOTIFS_AVIS[a.motif] || R.MOTIFS_AVIS.autre}.</Note> : null}
      {a.reponse && reponse === null ? <div class="avis-reponse"><b><Icone n="boutique" />Votre réponse{a.reponse_par ? ` · ${a.reponse_par.split('@')[0]}` : ''}</b><p>{a.reponse}</p></div> : null}
      {reponse !== null ? (
        <form class="pile" onSubmit={(ev) => { ev.preventDefault(); if (reponse.trim()) agir({ reponse }, a.reponse ? 'Réponse modifiée' : 'Réponse publiée', 'reponse'); }} noValidate>
          <Champ libelle="Réponse publique de la boutique" aide={`${reponse.length}/${R.MAX_AVIS} · visible sous l’avis, le client est prévenu`}>
            {(attrs) => <textarea {...attrs} class="saisie" rows="3" maxlength={R.MAX_AVIS} value={reponse} onInput={(ev) => setReponse(ev.currentTarget.value)} placeholder={a.note >= 4 ? `Merci ${a.nom.split(' ')[0]} pour votre avis !` : 'Merci pour votre retour. Voici ce que nous faisons…'} />}
          </Champ>
          <div class="rangee">
            <button type="submit" class={classes('btn btn-primaire btn-s', envoi === 'reponse' && 'charge')} disabled={!reponse.trim()}><Icone n="envoyer" />{a.reponse ? 'Enregistrer' : 'Publier la réponse'}</button>
            <button type="button" class="btn btn-fantome btn-s" onClick={() => setReponse(null)}>Annuler</button>
            {a.reponse ? <button type="button" class="btn btn-fantome btn-s texte-danger" onClick={() => agir({ reponse: '' }, 'Réponse retirée', 'reponse')}>Retirer la réponse</button> : null}
          </div>
        </form>
      ) : (
        <div class="rangee avis-admin-actions">
          <button type="button" class="btn btn-secondaire btn-s" onClick={() => setReponse(a.reponse || '')}><Icone n="bulle" />{a.reponse ? 'Modifier la réponse' : 'Répondre'}</button>
          {a.etat !== 'publie' ? <button type="button" class={classes('btn btn-secondaire btn-s', envoi === 'publier' && 'charge')} onClick={() => agir({ action: 'publier' }, 'Avis publié', 'publier')}><Icone n="coche" />Publier</button> : null}
          {a.etat !== 'masque' ? <button type="button" class="btn btn-fantome btn-s" onClick={() => ouvrirMasquer(a)}><Icone n="oeilBarre" />Masquer</button> : null}
        </div>
      )}
    </article>
  );
}

export function AvisClients() {
  const tous = avis.value; const n = avisAVerifier.value; const c = cfg.value;
  const [choix, setFiltre] = useState('');
  const [note, setNote] = useState(0);
  const [q, setQ] = useState('');
  const produit = route.value.query.get('produit') || '';
  // Tant que l'équipe n'a pas choisi : les avis à vérifier d'abord, sinon tous.
  const filtre = choix || (n ? 'attente' : 'tous');
  const duProduit = produit ? tous.filter((a) => a.produit === produit) : tous;
  const resume = R.resumeAvis(duProduit.filter((a) => a.etat === 'publie').reduce((r, a) => { r[a.note] = (r[a.note] || 0) + 1; return r; }, {}));
  const aRepondre = duProduit.filter(sansReponse).length;
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const titre = (a) => { const p = produitsParId.value.get(a.produit); return p ? p.title : ''; };
  const garder = (FILTRES.find((x) => x[0] === filtre) || FILTRES[2])[2];
  const l = duProduit.filter((a) => garder(a) && (!note || a.note === note)
    && (!mots.length || mots.every((m) => normaliser(`${a.nom} ${a.telephone} ${a.texte} ${a.numero} ${titre(a)}`).includes(m))));
  const p = produit ? produitsParId.value.get(produit) : null;
  return (
    <>
      <TetePage titre="Avis des clients" sous={p ? p.title : n ? pluriel(n, 'avis à vérifier', 'avis à vérifier') : 'Notes des clients qui ont reçu leurs articles'} parent={p ? '/produits/' + produit : undefined} />
      <div class="pile-l">
        {!c.reviews.enabled ? <Note ton="alerte" icone="info">Les avis sont désactivés : la boutique ne les montre pas et les clients ne peuvent plus en donner. {peut('reglages') ? <a class="lien" href={lien('/reglages/general')}>Réglages</a> : null}</Note> : null}
        <div class="kpis">
          <Kpi grand libelle="Note moyenne" icone="etoile" valeur={resume.nombre ? `${noteFr(resume.note)} / 5` : '–'} sous={pluriel(resume.nombre, 'avis publié', 'avis publiés')} />
          <Kpi libelle="30 derniers jours" icone="calendrier" valeur={String(duProduit.filter((a) => a.cree > Date.now() - 30 * 864e5).length)} sous="nouveaux avis" />
          <Kpi libelle="À vérifier" icone="horloge" valeur={String(duProduit.filter(FILTRES[0][2]).length)} sous={c.reviews.moderation ? 'Vérification avant publication' : 'Publication directe'} ton={n ? 'alerte' : ''} />
          <Kpi libelle="Sans réponse" icone="bulle" valeur={String(aRepondre)} sous="notes de 3 étoiles ou moins" ton={aRepondre ? 'alerte' : ''} />
        </div>
        {resume.nombre ? <section class="carte avis-admin-resume"><Repartition resume={resume} choisie={note} choisir={setNote} /></section> : null}
        <div class="outils-liste">
          <label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Client, article, commande, mot" aria-label="Rechercher un avis" /></label>
          <div class="puces" role="group" aria-label="Filtrer les avis">{FILTRES.map(([k, t, f]) => <button key={k} type="button" class="puce" aria-pressed={filtre === k ? 'true' : 'false'} onClick={() => setFiltre(k)}>{t}<span class="n">{duProduit.filter(f).length}</span></button>)}</div>
        </div>
        {note ? <p class="petit attenue">Avis à {pluriel(note, 'étoile')} seulement · <button type="button" class="lien" onClick={() => setNote(0)}>Toutes les notes</button></p> : null}
        {l.length ? <div class="pile liste-avis-admin">{l.map((a) => <LigneAvis key={a.id} a={a} />)}</div> : (
          <div class="carte">
            <Vide icone="etoile" titre={!tous.length ? 'Pas encore d’avis' : filtre === 'attente' ? 'Aucun avis à vérifier' : filtre === 'sans-reponse' ? 'Toutes les notes basses ont une réponse' : 'Aucun avis trouvé'}
              texte={!tous.length ? 'Une fois leur commande livrée, les clients notent leurs articles depuis la boutique (une notification gratuite le leur rappelle). Leurs avis arrivent ici en direct.' : ''} />
          </div>
        )}
      </div>
    </>
  );
}
