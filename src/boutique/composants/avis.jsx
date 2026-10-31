// Sokoyetu (boutique) — avis des clients : note des cartes et de la fiche, avis publiés, formulaire d'avis.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { toast, ouvrirFeuille, fermerFeuille, Champ, Note } from '../../commun/js/interface.jsx';
import { Etoiles, ChoixEtoiles, Repartition, noteFr } from '../../commun/js/etoiles.jsx';
import { date, pluriel, classes } from '../../commun/js/outils.js';
import { cfg, produitsParId, profil, client } from '../etat.js';
import { articleANoter, chargerANoter, donnerAvis, avisPublies } from '../avis.js';
import { t, tx } from '../../commun/js/langue.js';

const jourMois = (t) => date(t, { day: 'numeric', month: 'long', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });

/* Note d'un article sur sa carte : « ★ 4,6 (12) ». */
export function NoteCarte({ p }) {
  if (!p.avis || !p.avis.nombre || !cfg.value.reviews.enabled) return null;
  return (
    <p class="cp-note">
      <span class="sr">{tx('Note {0} sur 5, {1}', [noteFr(p.avis.note), pluriel(p.avis.nombre, 'avis', 'avis')])}</span>
      <span aria-hidden="true"><Icone n="etoile" plein /><b>{noteFr(p.avis.note)}</b><small>({p.avis.nombre})</small></span>
    </p>
  );
}

/* Note de la fiche article, sous le titre : mène aux avis. */
export function NoteProduit({ p }) {
  if (!p.avis || !p.avis.nombre || !cfg.value.reviews.enabled) return null;
  const voir = () => { const s = document.getElementById('avis'); if (s) s.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  return (
    <button type="button" class="note-produit" onClick={voir}>
      <Etoiles note={p.avis.note} /><b>{noteFr(p.avis.note)}</b><span>{pluriel(p.avis.nombre, 'avis', 'avis')}</span>
    </button>
  );
}

/* Formulaire d'avis (feuille) : note, texte facultatif ; « apres(avis) » une fois enregistré. */
export function ouvrirAvis(a, { note, apres } = {}) {
  const f = ouvrirFeuille({
    titre: a.avis ? t('Modifier mon avis') : t('Donner mon avis'),
    contenu: () => <FormulaireAvis a={a} note0={note} fini={(x) => { fermerFeuille(f); if (apres) apres(x); }} />
  });
}

function FormulaireAvis({ a, note0, fini }) {
  const p = produitsParId.value.get(a.produit);
  const [note, setNote] = useState(note0 || (a.avis && a.avis.note) || 0);
  const [texte, setTexte] = useState((a.avis && a.avis.texte) || '');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const nom = R.nomPublic((client.value && client.value.name) || profil.value.name);
  async function envoyer(e) {
    e.preventDefault();
    if (!note) { setErreur(t('Choisissez une note, de 1 à 5 étoiles.')); return; }
    if (envoi) return;
    setEnvoi(true); setErreur('');
    try {
      const x = await donnerAvis({ produit: a.produit, commande: a.commande, note, texte });
      toast(x.etat === 'attente' ? t('Merci ! Votre avis sera publié après vérification') : t('Merci ! Votre avis est publié'), { icone: 'etoile', duree: 3500 });
      fini(x);
    } catch (err) { setErreur(err.message || t('Avis non envoyé. Vérifiez la connexion, puis réessayez.')); setEnvoi(false); }
  }
  return (
    <form class="pile-l formulaire-avis" onSubmit={envoyer} noValidate>
      <div class="avis-article">
        <span class="avis-article-photo"><Photo m={p ? R.imagePrincipale(p) : null} alt="" tailles="56px" /></span>
        <span class="avis-article-texte"><b>{a.titre}</b><small>{a.variante ? a.variante + ' · ' : ''}{a.livree ? t('Reçu le {0}', [jourMois(a.livree)]) : t('Commande #{0}', [a.numero])}</small></span>
      </div>
      <ChoixEtoiles valeur={note} onChange={(n) => { setNote(n); setErreur(''); }} libelle={t('Votre note pour {0}', [a.titre])} grande />
      <Champ libelle={t('Votre avis')} facultatif aide={t('Publié avec votre prénom et l’initiale de votre nom (« {0} »), jamais votre numéro.', [nom])}>
        {(attrs) => <textarea {...attrs} class="saisie" rows="4" maxlength={R.MAX_AVIS} value={texte} onInput={(e) => setTexte(e.currentTarget.value)} placeholder={t('Qualité, taille, couleur, livraison : qu’en pensez-vous ?')} />}
      </Champ>
      {erreur ? <p class="champ-erreur" role="alert"><Icone n="alerte" />{erreur}</p> : null}
      <button type="submit" class={classes('btn btn-primaire btn-l btn-bloc', envoi && 'charge')}><Icone n="etoile" />{a.avis ? t('Enregistrer mon avis') : t('Publier mon avis')}</button>
    </form>
  );
}

/* Un avis publié : nom public, note, date, option achetée, texte et réponse de la boutique. */
export function CarteAvis({ x, boutique }) {
  return (
    <li class="avis">
      <div class="avis-tete">
        <span class="initiale avis-initiale" aria-hidden="true">{(x.nom || '?')[0].toUpperCase()}</span>
        <span class="avis-qui"><b>{x.nom}</b><small>{jourMois(x.cree)}{x.variante ? ` · ${x.variante}` : ''}</small></span>
        <Etoiles note={x.note} />
      </div>
      <p class="avis-verifie"><Icone n="coche" />{t('Achat vérifié')}</p>
      {x.texte ? <p class="avis-texte">{x.texte}</p> : null}
      {x.reponse ? <div class="avis-reponse"><b><Icone n="boutique" />{tx('Réponse de {0}', [boutique])}</b><p>{x.reponse}</p></div> : null}
    </li>
  );
}

/* L'avis de ce client sur l'article (publié, en attente ou masqué avec son motif), modifiable. */
function MonAvis({ a, apres }) {
  const x = a.avis;
  const etat = x.etat === 'attente' ? { ton: 'info', texte: t('En attente de vérification par la boutique.') }
    : x.etat === 'masque' ? { ton: 'alerte', texte: t('Non publié : {0}. Vous pouvez le modifier.', [x.motif || t('ne respecte pas les règles des avis')]) } : null;
  return (
    <div class="carte carte-s mon-avis">
      <div class="entre"><b>{t('Votre avis')}</b><Etoiles note={x.note} /></div>
      {x.texte ? <p class="avis-texte">{x.texte}</p> : null}
      {etat ? <Note ton={etat.ton} icone={x.etat === 'masque' ? 'alerte' : 'horloge'}>{etat.texte}</Note> : null}
      <button type="button" class="btn btn-secondaire btn-s" style={{ justifySelf: 'start' }} onClick={() => ouvrirAvis(a, { apres })}><Icone n="crayon" />{t('Modifier mon avis')}</button>
    </div>
  );
}

/* Section « Avis des clients » de la fiche article : résumé, répartition (filtre par note), avis publiés page par page. */
export function AvisProduit({ p }) {
  const c = cfg.value;
  const vide = { resume: null, avis: [], suite: false, page: 0, note: 0, charge: false, erreur: false, occupe: false };
  const [etat, setEtat] = useState(vide);
  const charger = async (page, note, ajouter) => {
    setEtat((x) => ({ ...x, occupe: true }));
    try {
      const r = await avisPublies(p.id, page, note);
      setEtat((x) => ({ resume: r.resume, avis: ajouter ? [...x.avis, ...r.avis] : r.avis, suite: r.suite, page, note, charge: true, erreur: false, occupe: false }));
    } catch (e) { setEtat((x) => ({ ...x, charge: true, erreur: true, occupe: false })); }
  };
  useEffect(() => {
    if (!c.reviews.enabled) return;
    setEtat(vide); charger(0, 0, false); chargerANoter().catch(() => { });
  }, [p.id]);
  if (!c.reviews.enabled) return null;
  const a = articleANoter(p.id);
  const resume = etat.resume || { note: (p.avis && p.avis.note) || 0, nombre: (p.avis && p.avis.nombre) || 0, repartition: {} };
  const relire = () => { charger(0, etat.note, false); chargerANoter({ force: true }).catch(() => { }); };
  return (
    <section class="avis-produit" id="avis" aria-labelledby="avis-titre">
      <h2 class="sous-titre" id="avis-titre">{t('Avis des clients')}</h2>
      {resume.nombre ? (
        <div class="avis-resume">
          <div class="avis-moyenne">
            <b class="avis-note">{noteFr(resume.note)}<small>/5</small></b>
            <Etoiles note={resume.note} />
            <small>{tx('{0} · achats vérifiés', [pluriel(resume.nombre, 'avis', 'avis')])}</small>
          </div>
          {etat.resume ? <Repartition resume={resume} choisie={etat.note} choisir={(n) => charger(0, n, false)} /> : null}
        </div>
      ) : etat.charge || !etat.occupe ? <p class="attenue">{t('Pas encore d’avis sur cet article. Les clients qui l’ont reçu peuvent donner le leur.')}</p> : null}
      {a ? (a.avis ? <MonAvis a={a} apres={relire} /> : (
        <div class="carte carte-s inviter-avis">
          <span><b>{t('Vous avez reçu cet article')}</b><small>{t('Votre avis aide les autres clients.')}</small></span>
          <button type="button" class="btn btn-primaire" onClick={() => ouvrirAvis(a, { apres: relire })}><Icone n="etoile" />{t('Donner mon avis')}</button>
        </div>
      )) : null}
      {etat.note ? <p class="petit attenue">{tx('Avis à {0} seulement ·', [pluriel(etat.note, 'étoile')])}{' '}<button type="button" class="lien" onClick={() => charger(0, 0, false)}>{t('Voir tous les avis')}</button></p> : null}
      {etat.avis.length ? <ul class="liste-avis">{etat.avis.map((x) => <CarteAvis key={x.id} x={x} boutique={c.name} />)}</ul> : null}
      {etat.suite ? <button type="button" class={classes('btn btn-secondaire btn-bloc', etat.occupe && 'charge')} onClick={() => charger(etat.page + 1, etat.note, true)}>{t('Voir plus d’avis')}</button> : null}
      {etat.erreur ? <Note ton="alerte" icone="alerte">{t('Avis indisponibles pour le moment.')}{' '}<button type="button" class="lien" onClick={() => charger(0, etat.note, false)}>{t('Réessayer')}</button></Note> : null}
    </section>
  );
}
