// Sokoyetu (administration) — l'équipe (propriétaire) : comptes de l'administration et leurs rôles ; page « accès réservé ».
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Champ, Choix, Note, Vide, Pastille, toast, confirmer, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { copier, classes } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { compte, lireEquipe, ajouterMembre, modifierMembre, retirerMembre, gererErreur } from '../etat.js';
import { TetePage } from '../composants/cadre.jsx';

const ICONES = { proprietaire: 'cadenas', vendeur: 'etiquette', livreur: 'camion' };
const TONS = { proprietaire: 'marque', vendeur: 'info', livreur: 'ok' };
const adresseAdmin = () => location.origin;

/* Le choix du rôle, avec ce que chacun permet. */
function ChoixRole({ valeur, onChange }) {
  return (
    <div class="pile" role="radiogroup" aria-label="Rôle">
      {Object.entries(R.ROLES).map(([k, r]) => <Choix key={k} actif={valeur === k} onClick={() => onChange(k)} icone={ICONES[k]} titre={r.label} sous={r.texte} />)}
    </div>
  );
}

/* Identifiants à transmettre au membre : montrés une seule fois (le serveur ne garde que l'empreinte du mot de passe). */
function montrerIdentifiants(m, mdp, nouveau) {
  const texte = `Bonjour ${m.name}, voici votre accès à l’administration de la boutique (${R.ROLES[m.role].label.toLowerCase()}) :\n${adresseAdmin()}\nE-mail : ${m.email}\nMot de passe provisoire : ${mdp}\nChangez-le dès la première connexion (Mon compte → Changer le mot de passe).`;
  ouvrirFeuille({
    titre: nouveau ? 'Membre ajouté' : 'Nouveau mot de passe provisoire',
    contenu: () => (
      <div class="pile">
        <p class="attenue">Donnez ces informations à <b>{m.name}</b>. Le mot de passe ne sera plus affiché.</p>
        <dl class="infos">
          <dt>Adresse</dt><dd class="code">{adresseAdmin().replace(/^https?:\/\//, '')}</dd>
          <dt>E-mail</dt><dd>{m.email}</dd>
          <dt>Mot de passe</dt><dd class="code">{mdp}</dd>
          <dt>Rôle</dt><dd>{R.ROLES[m.role].label}</dd>
        </dl>
        <Note icone="cadenas">Transmettez-le de vive voix ou dans un message privé, jamais dans un groupe.</Note>
      </div>
    ),
    pied: () => <button class="btn btn-primaire btn-bloc" onClick={async () => { if (await copier(texte)) toast('Message copié : collez-le dans un message privé', { icone: 'copier' }); }}><Icone n="copier" />Copier le message</button>
  });
}

function FormulaireAjout({ fin }) {
  const [f, setF] = useState({ name: '', email: '', role: 'vendeur', erreurs: {}, envoi: false });
  const maj = (p) => setF((x) => ({ ...x, ...p }));
  async function envoyer(e) {
    e && e.preventDefault();
    if (f.envoi) return;
    const erreurs = {};
    if (!R.valider.nom(f.name)) erreurs.name = 'Indiquez son nom (2 à 60 lettres).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) erreurs.email = 'Adresse e-mail invalide.';
    if (Object.keys(erreurs).length) { maj({ erreurs }); return; }
    maj({ envoi: true });
    try { const r = await ajouterMembre({ name: f.name, email: f.email, role: f.role }); fin(r); }
    catch (err) { maj({ envoi: false }); if (err.status === 400) maj({ envoi: false, erreurs: { email: err.message } }); else gererErreur(err, 'Ajout impossible'); }
  }
  return (
    <form class="formulaire" onSubmit={envoyer} noValidate>
      <Champ libelle="Nom" erreur={f.erreurs.name}>{(a) => <input class="saisie" {...a} value={f.name} onInput={(e) => maj({ name: e.currentTarget.value, erreurs: {} })} autocomplete="off" maxlength="60" placeholder="Ex. : Amani Bahati" />}</Champ>
      <Champ libelle="E-mail de connexion" erreur={f.erreurs.email}>{(a) => <input class="saisie" {...a} type="email" inputmode="email" value={f.email} onInput={(e) => maj({ email: e.currentTarget.value, erreurs: {} })} autocomplete="off" autocapitalize="off" maxlength="120" />}</Champ>
      <p class="champ-libelle">Rôle</p>
      <ChoixRole valeur={f.role} onChange={(role) => maj({ role })} />
      <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit"><Icone n="plus" />Ajouter à l’équipe</button>
    </form>
  );
}

function FicheMembre({ m, fin }) {
  const [roleChoisi, setRole] = useState(m.role);
  const [occupe, setOccupe] = useState('');
  const moi = compte.value && compte.value.id === m.id;
  const agir = async (quoi, fn) => { setOccupe(quoi); try { await fn(); } catch (e) { gererErreur(e); } setOccupe(''); };
  return (
    <div class="pile-l">
      <div class="pile">
        <p class="attenue">{m.email}{moi ? ' · c’est vous' : ''}</p>
        <ChoixRole valeur={roleChoisi} onChange={setRole} />
        {roleChoisi !== m.role ? <button class={classes('btn btn-primaire btn-bloc', occupe === 'role' && 'charge')} onClick={() => agir('role', async () => { await modifierMembre(m.id, { role: roleChoisi }); toast(`${m.name} est maintenant ${R.ROLES[roleChoisi].label.toLowerCase()}`); fin(); })}>Enregistrer le rôle</button> : null}
      </div>
      {!moi ? (
        <div class="pile separe">
          <button class={classes('btn btn-secondaire btn-bloc', occupe === 'mdp' && 'charge')} onClick={() => agir('mdp', async () => {
            if (!(await confirmer({ titre: `Nouveau mot de passe pour ${m.name} ?`, texte: 'Son mot de passe actuel ne marchera plus : donnez-lui le nouveau.', ok: 'Créer un mot de passe' }))) return;
            const r = await modifierMembre(m.id, { reinitialiser: true }); fin(); montrerIdentifiants(r.membre, r.motDePasse, false);
          })}><Icone n="cadenas" />Nouveau mot de passe provisoire</button>
          <button class={classes('btn btn-danger btn-bloc', occupe === 'retirer' && 'charge')} onClick={() => agir('retirer', async () => {
            if (!(await confirmer({ titre: `Retirer ${m.name} de l’équipe ?`, texte: 'Son accès à l’administration est supprimé tout de suite.', ok: 'Retirer', danger: true }))) return;
            await retirerMembre(m.id); toast(`${m.name} n’a plus accès à l’administration`, { icone: 'poubelle' }); fin();
          })}><Icone n="poubelle" />Retirer de l’équipe</button>
        </div>
      ) : <Note icone="info">Votre mot de passe se change dans « Mon compte ».</Note>}
    </div>
  );
}

export function Equipe() {
  const [membres, setMembres] = useState(null);
  const [erreur, setErreur] = useState('');
  const charger = () => lireEquipe().then((l) => { setMembres(l); setErreur(''); }).catch((e) => setErreur(e.message || 'Équipe indisponible'));
  useEffect(() => { charger(); }, []);
  const ajouter = () => {
    const id = ouvrirFeuille({ titre: 'Ajouter un membre', contenu: () => <FormulaireAjout fin={(r) => { fermerFeuille(id); charger(); montrerIdentifiants(r.membre, r.motDePasse, true); }} /> });
  };
  const ouvrir = (m) => {
    const id = ouvrirFeuille({ titre: m.name || m.email, contenu: () => <FicheMembre m={m} fin={() => { fermerFeuille(id); charger(); }} /> });
  };
  return (
    <>
      <TetePage titre="Équipe" sous="Qui entre dans l’administration, et pour quoi faire" parent="/plus" actions={<button class="btn btn-primaire btn-s" onClick={ajouter}><Icone n="plus" />Ajouter</button>} />
      <div class="pile-l formulaire-etroit">
        {erreur ? <Note ton="danger" icone="alerte">{erreur}</Note> : null}
        {membres === null && !erreur ? <div class="squelette" style={{ height: 180 }} /> : null}
        {membres ? (
          <div class="menu">
            {membres.map((m) => (
              <button key={m.id} class="menu-item" onClick={() => ouvrir(m)}>
                <span class="initiale petite" aria-hidden="true">{(m.name || m.email || '?').trim()[0].toUpperCase()}</span>
                <span class="menu-texte"><b>{m.name || m.email}{compte.value && compte.value.id === m.id ? ' (vous)' : ''}</b><small>{m.email}</small></span>
                <Pastille ton={TONS[m.role]} icone={ICONES[m.role]}>{R.ROLES[m.role].label}</Pastille>
              </button>
            ))}
          </div>
        ) : null}
        <section class="carte">
          <h2 class="carte-titre"><Icone n="bouclier" />Les rôles</h2>
          <dl class="infos">{Object.entries(R.ROLES).flatMap(([k, r]) => [<dt key={k + '-t'}>{r.label}</dt>, <dd key={k}>{r.texte}</dd>])}</dl>
          <p class="champ-aide espace-haut">Chaque membre a son propre e-mail et son mot de passe : ne partagez jamais le vôtre.</p>
        </section>
      </div>
    </>
  );
}

/* Page demandée par un rôle qui n'y a pas accès (lien partagé, ancien favori). */
export function AccesReserve() {
  return (
    <>
      <TetePage titre="Accès réservé" />
      <Vide icone="cadenas" titre="Cette page est réservée" texte="Votre rôle dans l’équipe ne donne pas accès à cette page. Demandez au propriétaire de la boutique si besoin.">
        <a class="btn btn-primaire" href={lien('/')}>Retour à l’accueil</a>
      </Vide>
    </>
  );
}
