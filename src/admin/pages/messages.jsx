// Sokoyetu (administration) — messages des clients : une discussion par client, réponse dans l'application, gratuite
// (le client est prévenu par une notification, ni SMS ni WhatsApp). Propriétaire et vendeurs (droit « messages »).
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Vide, Pastille, Segment, toast, confirmer, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { FilMessages } from '../../commun/js/discussion.jsx';
import { dollars, pluriel, telephone, ilya, classes, normaliser } from '../../commun/js/outils.js';
import { lien, route } from '../routeur.js';
import { cfg, discussions, produits, produitsParId, donnees, pret, lireDiscussion, repondreDiscussion, marquerDiscussion, supprimerDiscussion, gererErreur, peut } from '../etat.js';
import { TetePage } from '../composants/cadre.jsx';
import { statutPaiement, statutPreparation } from './commandes.jsx';
import { Chargement } from './accueil.jsx';

const nomDe = (d) => (d && d.nom) || (d && d.telephone ? telephone(d.telephone) : 'Client');
const prenom = (d) => String((d && d.nom) || '').trim().split(/\s+/)[0] || '';
const commandeParId = (id) => donnees.value.orders.find((o) => o.id === id) || null;
function etatStock(p) {
  if (!R.estEnVente(p)) return 'Pas en vente';
  if (R.estImport(p)) return 'Sur commande (import)';
  const s = R.stockTotal(p);
  return s > 0 ? `${s} en stock` : 'Épuisé';
}

/* L'article ou la commande dont parle un message. */
function Pieces({ m }) {
  const p = m.produit ? produitsParId.value.get(m.produit) : null;
  const o = m.commande ? commandeParId(m.commande.id) : null;
  const sp = o ? statutPaiement(o) : null; const sf = o ? statutPreparation(o) : null;
  return (
    <>
      {m.produit ? (
        <a class="bulle-piece" href={lien('/produits/' + m.produit)}>
          <span class="bulle-piece-photo">{p ? <Photo m={R.imagePrincipale(p)} alt="" tailles="44px" /> : null}</span>
          <span class="bulle-piece-texte"><b>{p ? p.title : 'Article retiré'}</b><small>{p ? `${dollars(R.prixAffiche(p).prix)} · ${etatStock(p)}` : ''}</small></span>
        </a>
      ) : null}
      {m.commande ? (
        <a class="bulle-piece" href={lien('/commandes/' + m.commande.id)}>
          <span class="bulle-piece-icone"><Icone n="recu" /></span>
          <span class="bulle-piece-texte"><b>Commande #{m.commande.numero || (o && o.number) || ''}</b><small>{o ? `${dollars(o.total)} · ${sf && R.estPayee(o) ? sf.label : sp.label}` : ''}</small></span>
        </a>
      ) : null}
    </>
  );
}

/* Joindre à la réponse un article (recherche) ou une commande de ce client. */
function ChoixPiece({ commandesClient, choisir }) {
  const [q, setQ] = useState('');
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const l = produits.value.filter((p) => R.estEnVente(p) && (!mots.length || mots.every((m) => normaliser(p.title + ' ' + (p.sku || '')).includes(m)))).slice(0, 30);
  return (
    <div class="pile">
      {commandesClient.length ? (
        <>
          <p class="intertitre">Ses commandes</p>
          <div class="liste">
            {commandesClient.map((o) => (
              <button key={o.id} type="button" class="ligne" onClick={() => choisir({ commande: o.id })}>
                <span class="ligne-vignette"><Icone n="recu" /></span>
                <span class="ligne-texte"><b class="code">#{o.number}</b><small>{ilya(o.createdAt)} · {statutPaiement(o).label}</small></span>
                <span class="ligne-fin"><b>{dollars(o.total)}</b></span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p class="intertitre">Un article</p>
      <label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nom ou référence de l’article" aria-label="Rechercher un article" /></label>
      <div class="liste">
        {l.map((p) => (
          <button key={p.id} type="button" class="ligne" onClick={() => choisir({ produit: p.id })}>
            <span class="ligne-vignette"><Photo m={R.imagePrincipale(p)} alt="" tailles="48px" /></span>
            <span class="ligne-texte"><b>{p.title}</b><small>{etatStock(p)}</small></span>
            <span class="ligne-fin"><b>{dollars(R.prixAffiche(p).prix)}</b></span>
          </button>
        ))}
        {!l.length ? <p class="attenue petit" style={{ padding: 16 }}>Aucun article trouvé.</p> : null}
      </div>
    </div>
  );
}

function ListeDiscussions({ actif }) {
  const tous = discussions.value; const n = tous.filter((d) => d.a_repondre).length;
  // Tant que l'équipe n'a pas choisi : les clients qui attendent une réponse d'abord, sinon toutes les discussions.
  const [choix, setFiltre] = useState('');
  const filtre = choix || (n ? 'a-repondre' : 'toutes');
  const [q, setQ] = useState('');
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const l = tous.filter((d) => (filtre !== 'a-repondre' || d.a_repondre || d.id === actif) && (!mots.length || mots.every((m) => normaliser(`${d.nom} ${d.telephone} ${d.dernier}`).includes(m))));
  return (
    <section class="messagerie-liste" aria-label="Discussions">
      <div class="outils-liste messagerie-outils">
        <Segment libelle="Discussions montrées" plein options={[['a-repondre', n ? `À répondre (${n})` : 'À répondre'], ['toutes', 'Toutes']]} valeur={filtre} onChange={setFiltre} />
        {tous.length > 6 ? <label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nom, téléphone, message" aria-label="Rechercher une discussion" /></label> : null}
      </div>
      {l.length ? (
        <div class="liste">
          {l.map((d) => (
            <a key={d.id} class={classes('ligne ligne-discussion', d.id === actif && 'active', d.non_lus && 'non-lue')} href={lien('/messages/' + d.id)} aria-current={d.id === actif ? 'page' : undefined}>
              <span class="ligne-vignette ronde" aria-hidden="true">{(d.nom || '?')[0].toUpperCase()}</span>
              <span class="ligne-texte"><b>{nomDe(d)}</b><small>{d.auteur === 'boutique' ? 'Vous : ' : ''}{d.dernier}</small></span>
              <span class="ligne-fin"><small>{ilya(d.maj)}</small>{d.non_lus ? <span class="pastille-compte">{d.non_lus}</span> : d.a_repondre ? <Pastille ton="alerte">À répondre</Pastille> : null}</span>
            </a>
          ))}
        </div>
      ) : (
        <div class="carte">
          <Vide icone="bulle" titre={!tous.length ? 'Aucun message pour le moment' : filtre === 'a-repondre' && !mots.length ? 'Aucun client n’attend de réponse' : 'Aucune discussion trouvée'}
            texte={!tous.length ? 'Les questions de vos clients (un article, une commande, la livraison) arrivent ici en direct. Ils écrivent depuis la boutique : « Écrire à la boutique », « Une question sur cet article ? ».' : ''} />
        </div>
      )}
    </section>
  );
}

function Discussion({ id }) {
  const d = discussions.value.find((x) => x.id === id);
  const [etat, setEtat] = useState({ messages: [], commandes: [], charge: false, erreur: '' });
  const [texte, setTexte] = useState('');
  const [piece, setPiece] = useState({ produit: '', commande: '' });
  const [envoi, setEnvoi] = useState(null);
  const zone = useRef(null); const bas = useRef(null); const formulaire = useRef(null);

  useEffect(() => {
    let fini = false;
    setEtat({ messages: [], commandes: [], charge: false, erreur: '' }); setTexte(''); setPiece({ produit: '', commande: '' });
    lireDiscussion(id)
      .then((r) => { if (!fini) setEtat({ messages: r.messages, commandes: r.commandes, charge: true, erreur: '' }); })
      .catch((e) => { if (!fini) setEtat((x) => ({ ...x, charge: true, erreur: e.status === 404 ? 'Cette discussion n’existe plus : elle a été supprimée.' : e.message || 'Discussion indisponible pour le moment.' })); });
    return () => { fini = true; };
  }, [id]);

  // Le client écrit (temps réel) : seuls les nouveaux messages sont lus.
  const maj = d ? d.maj : 0;
  const dernier = etat.messages.length ? etat.messages[etat.messages.length - 1] : null;
  useEffect(() => {
    if (!etat.charge || !d || (dernier && maj <= dernier.cree)) return;
    lireDiscussion(id, dernier ? dernier.id : 0).then((r) => setEtat((x) => {
      const ids = new Set(x.messages.map((m) => m.id));
      return { ...x, messages: [...x.messages, ...r.messages.filter((m) => !ids.has(m.id))], commandes: r.commandes };
    })).catch(() => { });
  }, [maj, etat.charge]);

  // Discussion ouverte sous les yeux de l'équipe : les messages du client sont lus (il voit « Vu »).
  const nonLus = d ? d.non_lus : 0;
  useEffect(() => {
    const lire = () => { if (etat.charge && nonLus && !document.hidden) marquerDiscussion(id, 'lue').catch(() => { }); };
    lire();
    document.addEventListener('visibilitychange', lire);
    return () => document.removeEventListener('visibilitychange', lire);
  }, [etat.charge, nonLus, id]);

  const n = etat.messages.length + (envoi ? 1 : 0);
  useEffect(() => { if (n && bas.current) bas.current.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [n]);

  // Sur téléphone, les messages d'information passent au-dessus de la zone de réponse (collée au-dessus de la navigation, ou plus haut).
  const affichee = !!d && !etat.erreur;
  useEffect(() => {
    const f = formulaire.current; const b = document.body.style;
    if (!f) return undefined;
    let image = 0;
    const placer = () => {
      image = 0;
      const haut = f.getBoundingClientRect().top;
      if (matchMedia('(min-width: 1024px)').matches || haut >= innerHeight) b.removeProperty('--bas-toasts');
      else b.setProperty('--bas-toasts', Math.round(innerHeight - haut) + 12 + 'px');
    };
    const demander = () => { if (!image) image = requestAnimationFrame(placer); };
    const o = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(demander) : null;
    if (o) o.observe(f);
    addEventListener('scroll', demander, { passive: true }); addEventListener('resize', demander);
    placer();
    return () => { if (o) o.disconnect(); cancelAnimationFrame(image); removeEventListener('scroll', demander); removeEventListener('resize', demander); b.removeProperty('--bas-toasts'); };
  }, [affichee]);

  if (!d && !etat.charge) return <div class="squelette" style={{ height: 320 }} />;
  if (etat.erreur || !d) return <div class="carte"><Vide icone="bulle" titre="Discussion introuvable" texte={etat.erreur || 'Cette discussion n’existe plus.'}><a class="btn btn-secondaire" href={lien('/messages')}>Toutes les discussions</a></Vide></div>;

  const commandesClient = etat.commandes.map(commandeParId).filter(Boolean);
  const produitJoint = piece.produit ? produitsParId.value.get(piece.produit) : null;
  const commandeJointe = piece.commande ? commandeParId(piece.commande) : null;
  const ajuster = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; };
  const inserer = (x, debut) => { setTexte((t) => (debut ? x + t.replace(/^\s+/, '') : (t.trim() ? t.trimEnd() + ' ' : '') + x)); requestAnimationFrame(() => { ajuster(zone.current); zone.current && zone.current.focus(); }); };
  const joindre = () => {
    const f = ouvrirFeuille({ titre: 'Joindre à la réponse', contenu: () => <ChoixPiece commandesClient={commandesClient} choisir={(x) => { setPiece({ produit: x.produit || '', commande: x.commande || '' }); fermerFeuille(f); requestAnimationFrame(() => zone.current && zone.current.focus()); }} /> });
  };
  const rapides = [[`Bonjour${prenom(d) ? ' ' + prenom(d) : ''}, `, true], ['Oui, il est disponible.'], ['Merci pour votre message !'], ['Merci pour votre commande !']];

  async function envoyer(e) {
    if (e) e.preventDefault();
    const x = texte.trim();
    if (!x || envoi) return;
    const m = { texte: x, produit: piece.produit, commande: piece.commande, apres: dernier ? dernier.id : 0 };
    setEnvoi({ id: 'envoi', auteur: 'boutique', texte: x, produit: piece.produit, commande: commandeJointe ? { id: commandeJointe.id, numero: commandeJointe.number } : null, cree: Date.now(), envoi: true });
    setTexte(''); requestAnimationFrame(() => ajuster(zone.current));
    try {
      const r = await repondreDiscussion(id, m);
      setEtat((s) => { const ids = new Set(s.messages.map((y) => y.id)); return { ...s, messages: [...s.messages, ...r.messages.filter((y) => !ids.has(y.id))], commandes: r.commandes }; });
      setPiece({ produit: '', commande: '' });
    } catch (err) { setTexte((t) => t || x); gererErreur(err, 'Réponse non envoyée'); }
    setEnvoi(null);
  }
  async function traitee() {
    try { await marquerDiscussion(id, 'traitee'); toast('Discussion marquée comme traitée', { icone: 'coche' }); } catch (err) { gererErreur(err, 'Action impossible'); }
  }
  async function supprimer() {
    if (!(await confirmer({ titre: `Supprimer la discussion avec ${nomDe(d)} ?`, texte: 'Tous ses messages sont effacés, pour vous comme pour le client. C’est définitif.', ok: 'Supprimer', danger: true }))) return;
    try { await supprimerDiscussion(id); toast('Discussion supprimée', { icone: 'poubelle' }); location.hash = '#/messages'; } catch (err) { gererErreur(err, 'Suppression impossible'); }
  }

  const messages = envoi ? [...etat.messages, envoi] : etat.messages;
  return (
    <section class="messagerie-fil" aria-label={`Discussion avec ${nomDe(d)}`}>
      <div class="carte messagerie-tete">
        <span class="initiale" aria-hidden="true">{(d.nom || '?')[0].toUpperCase()}</span>
        <div class="messagerie-qui">
          <b>{nomDe(d)}</b>
          <small>{d.telephone ? telephone(d.telephone) : 'Téléphone inconnu'}{commandesClient.length ? ` · ${pluriel(commandesClient.length, 'commande')}` : ''}</small>
          <span class="ligne-pastilles">{d.client ? <Pastille ton="info" icone="personne">Compte</Pastille> : <Pastille ton="neutre">Sans compte</Pastille>}{d.a_repondre ? <Pastille ton="alerte">À répondre</Pastille> : null}</span>
        </div>
        <div class="messagerie-actions">
          {d.telephone && peut('clients') ? <a class="btn btn-secondaire btn-s" href={lien('/clients/' + R.chiffres(d.telephone))}><Icone n="personne" /><span class="libelle">Fiche client</span></a> : null}
          {d.a_repondre ? <button type="button" class="btn btn-secondaire btn-s" onClick={traitee} title="Rien à répondre (un merci, par exemple)"><Icone n="coche" /><span class="libelle">Traitée</span></button> : null}
        </div>
      </div>
      <div class="messagerie-messages">
        {!etat.charge ? <div class="squelette" style={{ height: 160 }} /> : <FilMessages messages={messages} moi="boutique" lu={d.lu_client} autre={nomDe(d)} piece={(m) => <Pieces m={m} />} signature={(m) => (m.auteur === 'boutique' && m.par ? m.par.split('@')[0] : '')} />}
        <div ref={bas} />
      </div>
      <form class="composeur-admin" ref={formulaire} onSubmit={envoyer} noValidate>
        {produitJoint || commandeJointe ? (
          <div class="composeur-sujet">
            {produitJoint ? <span class="bulle-piece-photo"><Photo m={R.imagePrincipale(produitJoint)} alt="" tailles="36px" /></span> : <span class="bulle-piece-icone"><Icone n="recu" /></span>}
            <span class="composeur-sujet-texte"><small>Joint à la réponse</small><b>{produitJoint ? produitJoint.title : `Commande #${commandeJointe.number}`}</b></span>
            <button type="button" class="btn-icone" aria-label="Retirer" onClick={() => setPiece({ produit: '', commande: '' })}><Icone n="fermer" /></button>
          </div>
        ) : null}
        {!texte.trim() ? <div class="composeur-idees" role="group" aria-label="Réponses rapides">{rapides.map(([x, debut]) => <button key={x} type="button" class="puce" onClick={() => inserer(x, debut)}>{x.trim()}</button>)}</div> : null}
        <div class="composeur-ligne">
          <button type="button" class="btn-icone" onClick={joindre} aria-label="Joindre un article ou une commande" title="Joindre un article ou une commande"><Icone n="trombone" /></button>
          <textarea ref={zone} class="saisie" rows="1" value={texte} maxlength={R.MAX_MESSAGE} placeholder={`Répondre à ${prenom(d) || 'ce client'}…`} aria-label="Votre réponse"
            onInput={(e) => { setTexte(e.currentTarget.value); ajuster(e.currentTarget); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) envoyer(e); }} />
          <button type="submit" class={classes('btn btn-primaire composeur-envoyer', envoi && 'charge')} disabled={!texte.trim()} aria-label="Envoyer la réponse"><Icone n="papier" /></button>
        </div>
        <p class="composeur-aide">Le client reçoit votre réponse dans la boutique, avec une notification gratuite sur son téléphone s’il les a activées.</p>
      </form>
      <button type="button" class="lien petit texte-danger messagerie-supprimer" onClick={supprimer}>Supprimer cette discussion</button>
    </section>
  );
}

export function Messages() {
  const id = route.value.segs[1] || '';
  const d = id ? discussions.value.find((x) => x.id === id) : null;
  if (!pret.value) return <Chargement />;
  const n = discussions.value.filter((x) => x.a_repondre).length;
  return (
    <>
      <div class={classes(id && 'seulement-ordi')}>
        <TetePage titre="Messages" sous={n ? `${pluriel(n, 'client attend', 'clients attendent')} une réponse` : `Questions de vos clients, réponses gratuites dans l’application · ${cfg.value.name}`} />
      </div>
      {id ? <div class="seulement-mobile"><TetePage titre={d ? nomDe(d) : 'Discussion'} sous={d && d.telephone ? telephone(d.telephone) : ''} parent="/messages" /></div> : null}
      <div class={classes('messagerie', id && 'avec-fil')}>
        <ListeDiscussions actif={id} />
        {id ? <Discussion key={id} id={id} /> : <div class="messagerie-vide seulement-ordi carte"><Vide icone="bulle" titre="Choisissez une discussion" texte="Vos réponses arrivent chez le client dans la boutique, et en notification gratuite sur son téléphone." /></div>}
      </div>
    </>
  );
}
