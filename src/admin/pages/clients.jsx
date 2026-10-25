// Sokoyetu (administration) — clients, menu « Plus », compte.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Champ, Note, Vide, Bascule, Pastille, toast, confirmer, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { changerMotDePasse } from '../../commun/js/api.js';
import { Local } from '../../commun/js/stockage.js';
import { themeSombre, basculerTheme } from '../../commun/js/theme.js';
import { dollars, pluriel, telephone, lienWhatsApp, lienAppel, ilya, date, normaliser, copier } from '../../commun/js/outils.js';
import { lien, route } from '../routeur.js';
import { cfg, clients, comptes, produitsParId, pret, compte, etatServeur, effacerClient, seDeconnecter, gererErreur, rayons, bannieres, remises } from '../etat.js';
import { TetePage, Kpi, adresseBoutique } from '../composants/cadre.jsx';
import { Chargement, LigneCommandeCourte } from './accueil.jsx';

/* Panier d'un compte : lignes avec leur article (ceux retirés du catalogue sont écartés) et sa valeur. */
export function panierDuCompte(a) {
  const m = produitsParId.value;
  const lignes = (a.panier || []).map((l) => ({ ...l, p: m.get(l.productId), depuis: (a.dates || {})['panier:' + l.productId] || 0 })).filter((l) => l.p);
  return { lignes, valeur: lignes.reduce((s, l) => s + R.num(l.p.price) * l.qty, 0), depuis: Math.max(0, ...lignes.map((l) => l.depuis)) };
}

export function Clients() {
  const [q, setQ] = useState('');
  const tous = clients.value; const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const liste = tous.filter((c) => !mots.length || mots.every((m) => normaliser(c.nom + ' ' + c.tel).includes(m)));
  const nComptes = comptes.value.length;
  return (
    <>
      <TetePage titre="Clients" sous={`${pluriel(tous.length, 'client')}${nComptes ? ` · ${pluriel(nComptes, 'compte')}` : ''}${tous.length ? ` · ${dollars(tous.reduce((a, c) => a + c.depense, 0))} dépensés` : ''}`} />
      <div class="outils-liste"><label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nom ou téléphone" aria-label="Rechercher un client" /></label></div>
      {!pret.value ? <Chargement /> : liste.length ? (
        <div class="liste">
          {liste.map((c) => {
            const pa = c.compte ? panierDuCompte(c.compte) : null;
            return (
              <a key={c.tel} class="ligne" href={lien('/clients/' + c.tel)}>
                <span class="ligne-vignette ronde" aria-hidden="true">{(c.nom || '?')[0].toUpperCase()}</span>
                <span class="ligne-texte"><b>{c.nom || 'Client'}</b><small>{telephone(c.affiche) || c.affiche} · {pluriel(c.commandes.length, 'commande')}{c.zone ? ' · ' + c.zone : ''}</small>
                  {c.compte ? <span class="ligne-pastilles">
                    <Pastille ton="info" icone="personne">Compte</Pastille>
                    {pa.lignes.length ? <Pastille ton="marque" icone="sac">{pluriel(pa.lignes.reduce((s, l) => s + l.qty, 0), 'article')} au panier</Pastille> : null}
                    {c.compte.favoris.length ? <Pastille ton="neutre" icone="coeur">{pluriel(c.compte.favoris.length, 'favori')}</Pastille> : null}
                  </span> : null}</span>
                <span class="ligne-fin"><b>{dollars(c.depense)}</b><small>{ilya(Math.max(c.derniere, (c.compte && c.compte.seen) || 0))}</small></span>
              </a>
            );
          })}
        </div>
      ) : <div class="carte"><Vide icone="personnes" titre={tous.length ? 'Aucun client trouvé' : 'Vos clients apparaîtront ici'} texte={tous.length ? '' : 'Chaque personne qui commande ou crée son compte est ajoutée automatiquement, avec son historique.'} /></div>}
    </>
  );
}

export function Client() {
  const tel = route.value.segs[1]; const c = clients.value.find((x) => x.tel === tel);
  if (!pret.value) return <Chargement />;
  if (!c) return <><TetePage titre="Client" parent="/clients" /><div class="carte"><Vide icone="personnes" titre="Client introuvable" /></div></>;
  const valides = c.commandes.filter((o) => o.status !== 'cancelled' && R.estPayee(o));
  const effacer = async () => {
    if (!(await confirmer({ titre: `Effacer les données de ${c.nom || 'ce client'} ?`, texte: 'Nom, téléphones et adresses sont retirés de toutes ses commandes. Les montants restent pour la comptabilité. C’est définitif.', ok: 'Effacer définitivement', danger: true }))) return;
    try { const r = await effacerClient(c.tel); toast(`Données effacées (${pluriel(r.effacees, 'commande')})`, { icone: 'poubelle' }); history.back(); } catch (e) { gererErreur(e, 'Effacement impossible'); }
  };
  return (
    <>
      <TetePage titre={c.nom || 'Client'} sous={`${telephone(c.affiche) || c.affiche}${c.zone ? ' · ' + c.zone : ''}`} parent="/clients" />
      <div class="pile-l">
        <div class="kpis">
          <Kpi libelle="Commandes payées" icone="recu" valeur={String(valides.length)} sous={c.commandes.length - valides.length ? `${c.commandes.length - valides.length} non payée(s) ou annulée(s)` : ''} />
          <Kpi libelle="Total dépensé" icone="portefeuille" valeur={dollars(c.depense)} />
          <Kpi libelle="Panier moyen" icone="sac" valeur={dollars(c.depense / Math.max(1, valides.length))} />
          <Kpi libelle="Dernière commande" icone="calendrier" valeur={c.derniere ? date(c.derniere, { day: 'numeric', month: 'short' }) : '—'} sous={c.derniere ? ilya(c.derniere) : 'pas encore de commande'} />
        </div>
        <div class="rangee-l">
          <a class="btn btn-primaire" href={lienWhatsApp(c.affiche, `Bonjour ${String(c.nom).split(' ')[0]}, `)} target="_blank" rel="noopener"><Icone n="bulle" />WhatsApp</a>
          <a class="btn btn-secondaire" href={lienAppel(c.affiche)}><Icone n="appel" />Appeler</a>
          <button class="btn btn-secondaire" onClick={async () => { if (await copier(R.chiffres(c.affiche))) toast('Numéro copié'); }}><Icone n="copier" />Copier le numéro</button>
        </div>
        {c.compte ? <CompteClient a={c.compte} /> : null}
        <section class="carte"><h2 class="carte-titre"><Icone n="recu" />Commandes</h2>{c.commandes.length ? <div class="liste sans-bord">{c.commandes.map((o) => <LigneCommandeCourte key={o.id} o={o} />)}</div> : <p class="attenue petit">Pas encore de commande.</p>}</section>
        <section class="carte">
          <h2 class="carte-titre"><Icone n="cadenas" />Données personnelles</h2>
          <p class="attenue petit">À la demande du client (droit à l’effacement), ses données sont retirées de toutes ses commandes{c.compte ? ' et son compte est supprimé' : ''}. Les montants restent pour la comptabilité.</p>
          <button class="btn btn-danger btn-s espace-haut" onClick={effacer}><Icone n="poubelle" />Effacer les données de ce client</button>
        </section>
      </div>
    </>
  );
}

/* Compte du client : son panier en ce moment (à relancer), ses favoris, depuis quand. */
function CompteClient({ a }) {
  const pa = panierDuCompte(a);
  const favs = a.favoris.map((id) => ({ id, p: produitsParId.value.get(id), depuis: (a.dates || {})['favori:' + id] || 0 })).filter((x) => x.p);
  const ligne = (p, texte, k) => (
    <a key={k} class="ligne" href={lien('/audience/' + p.id)}>
      <span class="ligne-vignette"><Photo m={R.imagePrincipale(p)} alt="" tailles="48px" /></span>
      <span class="ligne-texte"><b>{p.title}</b><small>{texte}</small></span>
    </a>
  );
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="personne" />Compte client<span class="fin">créé {ilya(a.created)}{a.seen ? ` · vu ${ilya(a.seen)}` : ''}</span></h2>
      <div class="pile-l">
        <div>
          <p class="intertitre">Panier en ce moment{pa.lignes.length ? ` · ${dollars(pa.valeur)}` : ''}</p>
          {pa.lignes.length ? <div class="liste sans-bord">{pa.lignes.map((l, k) => ligne(l.p, [pluriel(l.qty, 'pièce'), [l.color, l.size].filter(Boolean).join(' · '), l.depuis ? 'ajouté ' + ilya(l.depuis) : ''].filter(Boolean).join(' · '), k))}</div>
            : <p class="attenue petit">Panier vide.</p>}
        </div>
        <div>
          <p class="intertitre">Favoris</p>
          {favs.length ? <div class="liste sans-bord">{favs.map((x) => ligne(x.p, x.depuis ? 'en favori ' + ilya(x.depuis) : 'en favori', x.id))}</div> : <p class="attenue petit">Aucun favori.</p>}
        </div>
        {pa.lignes.length ? <Note ton="info" icone="bulle">Ce client n’a pas encore commandé son panier. Un message, un appel ou une réduction peut l’aider à finir son achat (boutons ci-dessus).</Note> : null}
      </div>
    </section>
  );
}

const item = (href, icone, titre, sous, externe) => (
  <a class="menu-item" href={href} target={externe ? '_blank' : undefined} rel={externe ? 'noopener' : undefined}>
    <span class="menu-icone"><Icone n={icone} /></span><span class="menu-texte"><b>{titre}</b>{sous ? <small>{sous}</small> : null}</span><Icone n="droite" classe="chevron" />
  </a>
);

export function Plus() {
  const c = cfg.value; const ms = R.moyensDePaiement(c);
  return (
    <>
      <TetePage titre="Plus" sous="Catalogue, vitrine et réglages" />
      <div class="pile-l formulaire-etroit">
        <p class="intertitre">Suivi</p>
        <div class="menu">{item(lien('/audience'), 'oeil', 'Audience', 'En ligne maintenant, visiteurs, vues, paniers et favoris par article')}</div>
        <p class="intertitre">Catalogue</p>
        <div class="menu">
          {item(lien('/rayons'), 'rayons', 'Rayons', pluriel(rayons.value.length, 'rayon'))}
          {item(lien('/remises'), 'pourcent', 'Réductions', pluriel(remises.value.filter((d) => d.active !== false).length, 'code actif', 'codes actifs'))}
        </div>
        <p class="intertitre">Boutique en ligne</p>
        <div class="menu">
          {item(lien('/bannieres'), 'megaphone', 'Bannières d’accueil', bannieres.value.length ? pluriel(bannieres.value.filter((b) => b.active !== false).length, 'bannière active', 'bannières actives') : 'Images du port par défaut')}
          {item(lien('/reglages/boutique'), 'boutique', 'Identité de la boutique', `${c.name} · ${c.tagline}`)}
          {item(adresseBoutique('/'), 'oeil', 'Voir la boutique', 'Comme vos clients la voient', true)}
        </div>
        <p class="intertitre">Réglages</p>
        <div class="menu">
          {item(lien('/reglages/paiements'), 'portefeuille', 'Paiements Mobile Money', ms.length ? ms.map((m) => m.label).join(', ') : 'À configurer')}
          {item(lien('/reglages/livraison'), 'camion', 'Livraison', c.zones.map((z) => z.name).join(', '))}
          {item(lien('/reglages/general'), 'reglages', 'Général', 'Contact, devise, échanges, statistiques, exemples')}
          {item(lien('/reglages/legal'), 'recu', 'Informations légales', 'RCCM, adresse, conditions de vente')}
        </div>
        <p class="intertitre">Compte</p>
        <div class="menu">{item(lien('/compte'), 'personne', 'Mon compte', compte.value && compte.value.email)}</div>
      </div>
    </>
  );
}

function ouvrirMotDePasse() {
  const v = { ancien: '', nouveau: '', confirme: '' };
  const id = ouvrirFeuille({
    titre: 'Changer le mot de passe',
    contenu: () => (
      <form class="formulaire" onSubmit={(e) => e.preventDefault()}>
        <input type="email" autocomplete="username" value={compte.value && compte.value.email} hidden readOnly />
        <Champ libelle="Mot de passe actuel">{(a) => <input class="saisie" {...a} type="password" autocomplete="current-password" onInput={(e) => { v.ancien = e.currentTarget.value; }} />}</Champ>
        <Champ libelle="Nouveau mot de passe" aide="10 caractères minimum.">{(a) => <input class="saisie" {...a} type="password" autocomplete="new-password" onInput={(e) => { v.nouveau = e.currentTarget.value; }} />}</Champ>
        <Champ libelle="Confirmer le nouveau mot de passe">{(a) => <input class="saisie" {...a} type="password" autocomplete="new-password" onInput={(e) => { v.confirme = e.currentTarget.value; }} />}</Champ>
      </form>
    ),
    pied: () => <button class="btn btn-primaire btn-bloc" onClick={async () => {
      if (v.nouveau.length < 10) { toast('10 caractères minimum', { icone: 'alerte', ton: 'danger' }); return; }
      if (v.nouveau !== v.confirme) { toast('Les deux mots de passe diffèrent', { icone: 'alerte', ton: 'danger' }); return; }
      try { await changerMotDePasse(v.ancien, v.nouveau); fermerFeuille(id); toast('Mot de passe modifié'); }
      catch (e) { toast(e.status === 400 ? 'Mot de passe actuel incorrect' : 'Modification impossible', { icone: 'alerte', ton: 'danger' }); }
    }}>Enregistrer</button>
  });
}

function AlertesCommandes() {
  const [son, setSon] = useState(Local.lire('sonCommandes', true) !== false);
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'absent');
  const notifier = async () => {
    if (permission === 'granted' || permission === 'absent') return;
    if (permission === 'denied') { toast('Autorisez les notifications dans les réglages du navigateur pour ce site', { icone: 'info', duree: 5000 }); return; }
    try { const r = await Notification.requestPermission(); setPermission(r); if (r === 'granted') toast('Notifications activées', { icone: 'cloche' }); } catch (e) { }
  };
  return (
    <>
      <p class="intertitre">Alertes de commande payée</p>
      <div class="menu">
        <Bascule actif={son} onClick={() => { Local.ecrire('sonCommandes', !son); setSon(!son); }} libelle="Son" sous="Un carillon dès qu’un client a payé" />
        {permission !== 'absent' ? <Bascule actif={permission === 'granted'} onClick={notifier} libelle="Notifications" sous={permission === 'granted' ? 'Activées sur cet appareil, même quand l’onglet est en arrière-plan' : permission === 'denied' ? 'Refusées : à autoriser dans les réglages du navigateur' : 'Être prévenu même quand l’onglet est en arrière-plan'} /> : null}
      </div>
    </>
  );
}

/* Comptes clients : ouverts quand le serveur peut envoyer les codes de connexion (WhatsApp, SMS en secours). */
function ComptesClients({ s }) {
  const x = s || { pret: false, canaux: [], test: false };
  const noms = { whatsapp: 'WhatsApp', sms: 'SMS' };
  return (
    <section class="carte">
      <h2 class="carte-titre"><Icone n="personnes" />Comptes clients</h2>
      {x.pret ? (
        <div class="pile">
          <Note ton={x.test ? 'alerte' : 'ok'} icone={x.test ? 'alerte' : 'coche'}>{x.test ? <><b>Mode test :</b> le code s’affiche à l’écran, rien n’est envoyé. N’ouvrez pas la boutique au public ainsi.</> : <>Ouverts. Code de connexion envoyé par {x.canaux.map((k) => noms[k]).join(', puis ')}.</>}</Note>
          <p class="attenue petit">{pluriel(comptes.value.length, 'compte créé', 'comptes créés')}. Les clients peuvent toujours commander sans compte.</p>
        </div>
      ) : (
        <div class="pile">
          <p class="attenue petit">Fermés pour l’instant : les clients commandent sans compte. Pour les ouvrir, branchez l’envoi des codes par WhatsApp (API WhatsApp Business de Meta) dans la console de votre Droplet :</p>
          <code class="commande">sudo /opt/sokoyetu/codes.sh whatsapp ID_DU_NUMERO 'JETON'</code>
          <p class="attenue petit">SMS de secours, pour les clients sans WhatsApp :</p>
          <code class="commande">sudo /opt/sokoyetu/codes.sh sms-twilio SID 'JETON' Sokoyetu</code>
        </div>
      )}
    </section>
  );
}

export function Compte() {
  const s = etatServeur.value;
  return (
    <>
      <TetePage titre="Mon compte" sous={compte.value && compte.value.email} parent="/plus" />
      <div class="pile-l formulaire-etroit">
        <div class="menu">
          <button class="menu-item" onClick={ouvrirMotDePasse}><span class="menu-icone"><Icone n="cadenas" /></span><span class="menu-texte"><b>Changer le mot de passe</b><small>Recommandé après l’installation</small></span><Icone n="droite" classe="chevron" /></button>
          <Bascule actif={themeSombre.value} onClick={basculerTheme} libelle="Thème sombre" sous={themeSombre.value ? 'Activé sur cet appareil' : 'Désactivé : thème clair'} />
        </div>
        <div class="pile">
          <AlertesCommandes />
        </div>
        <section class="carte">
          <h2 class="carte-titre"><Icone n="ia" />Assistant IA des fiches produits</h2>
          {s.ia ? <Note ton="ok" icone="coche">Activé. Dans Produits, touchez « Ajouter avec l’IA » et prenez l’article en photo.</Note> : (
            <div class="pile">
              <p class="attenue petit">Il rédige une fiche produit à partir d’une photo. Pour l’activer, créez une clé sur console.anthropic.com (API Keys), puis dans la console de votre Droplet :</p>
              <code class="commande">sudo /opt/sokoyetu/ia.sh 'sk-ant-…'</code>
            </div>
          )}
        </section>
        <ComptesClients s={s.codes} />
        <section class="carte">
          <h2 class="carte-titre"><Icone n="info" />Serveur</h2>
          <dl class="infos"><dt>Version</dt><dd>{s.version || __VERSION__}</dd><dt>Sauvegardes</dt><dd>Chaque nuit, 7 gardées</dd></dl>
          <p class="champ-aide espace-haut">Tableau technique (sauvegardes, journal) : <a class="lien" href={adresseBoutique('/_/')} target="_blank" rel="noopener">{adresseBoutique('/_/').replace(/^https?:\/\//, '')}</a></p>
        </section>
        <button class="btn btn-secondaire" onClick={async () => { if (await confirmer({ titre: 'Se déconnecter ?', ok: 'Se déconnecter' })) seDeconnecter(); }}><Icone n="sortie" />Se déconnecter</button>
      </div>
    </>
  );
}
