// Sokoyetu (boutique) — après la commande, compte, suivi des commandes.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Note, Vide, Bascule, toast, ouvrirFeuille, fermerFeuille, confirmer, Pastille } from '../../commun/js/interface.jsx';
import { themeSombre, basculerTheme } from '../../commun/js/theme.js';
import { dollars, dateHeure, telephone, lienWhatsApp, pluriel, copier } from '../../commun/js/outils.js';
import { lien, route, naviguer } from '../routeur.js';
import { cfg, commandes, suivis, commandesChargees, actualiserMesCommandes, suivreCommande, jetonDe, profil, enregistrerProfil, favoris, effacerAppareil, produitsParId } from '../etat.js';
import { EnteteBoutique, EntetePage, Pied, ouvrirLivraisonPaiement } from '../composants/cadre.jsx';
import { installable, installer, estIOS } from '../installation.jsx';
import { useSeo } from './commun.jsx';

const imageLigne = (i) => i.image || R.imagePrincipale(produitsParId.value.get(i.productId) || {});
const lienSuivi = (id) => { const t = jetonDe(id); return t ? `${location.origin}/suivi/${id}#${t}` : ''; };

function texteWhatsApp(o) {
  const c = cfg.value;
  return `Bonjour ${c.name}, voici ma commande #${o.number} :\n` + (o.items || []).map((i) => `• ${i.title}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(' / ')})` : ''} × ${i.qty} — ${dollars(i.price * i.qty)}`).join('\n')
    + `\nTotal : ${dollars(o.total)}\nPaiement : ${o.payment.label} · code ${o.payment.ref}\nLivraison : ${o.shipping.zoneName}${o.shipping.address ? `, ${o.shipping.address}` : ''}\n${o.customer.name} · ${o.customer.phone}${lienSuivi(o.id) ? `\nSuivi : ${lienSuivi(o.id)}` : ''}`;
}

function Articles({ o }) {
  return (
    <ul class="recap-articles">
      {(o.items || []).map((i, k) => <li key={k}><span class="ra-photo"><Photo m={imageLigne(i)} alt="" tailles="56px" />{i.qty > 1 ? <i>{i.qty}</i> : null}</span><span class="ra-texte"><b>{i.title}</b><small>{[i.color, i.size].filter(Boolean).join(' · ')}</small></span><span class="num">{dollars(i.price * i.qty)}</span></li>)}
    </ul>
  );
}

function Montants({ o }) {
  return (
    <dl class="montants espace-haut">
      <div><dt>Sous-total</dt><dd class="num">{dollars(o.subtotal)}</dd></div>
      {o.discount ? <div><dt>Code {o.discount.code}</dt><dd class="moins num">−{dollars(o.discount.amount)}</dd></div> : null}
      <div><dt>Livraison · {o.shipping && o.shipping.zoneName}</dt><dd class="num">{o.shippingFee ? dollars(o.shippingFee) : 'Gratuite'}</dd></div>
      <div class="total"><dt class="lib">Total</dt><dd class="num">{dollars(o.total)}</dd></div>
    </dl>
  );
}

export function Merci() {
  const id = route.value.params.id; const o = commandes.value.get(id); const c = cfg.value;
  useSeo(() => ({ titre: 'Merci pour votre commande', noindex: true }), []);
  useEffect(() => { if (!o && jetonDe(id)) actualiserMesCommandes(); }, [id]);
  if (!o) return <><EnteteBoutique /><main id="contenu" class="page conteneur"><Vide icone="recu" titre="Commande enregistrée" texte="Retrouvez-la dans « Mes commandes »."><a class="btn btn-primaire" href={lien('/compte/commandes')}>Mes commandes</a></Vide></main></>;
  const wa = lienWhatsApp(c.whatsapp, texteWhatsApp(o));
  const prenom = String(o.customer.name || '').split(/\s+/)[0];
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur page-merci">
        <section class="merci-tete entree">
          <div class="merci-coche" aria-hidden="true"><Icone n="coche" /></div>
          <h1 class="titre-serif">Merci, {prenom} !</h1>
          <p class="attenue">Votre commande <span class="code">#{o.number}</span> est bien enregistrée.</p>
        </section>
        <div class="pile-l merci-corps">
          {o.review ? <Note ton="alerte" icone="alerte"><b>Un point est à vérifier.</b> Le stock ou un prix a changé pendant votre commande : la boutique vous contacte rapidement au {telephone(o.customer.phone)}. Votre paiement est bien enregistré.</Note>
            : <Note ton="info" icone="horloge"><b>Paiement en vérification.</b> La boutique vérifie votre paiement {o.payment.label} ({o.payment.ref}). Vous serez prévenu au {telephone(o.customer.phone)} dès sa confirmation.</Note>}
          <section class="carte">
            <h2 class="carte-titre"><Icone n="drapeau" />La suite</h2>
            <ol class="suivi">
              {R.etapesSuivi(o).map((e, i) => <li key={i} class={'suivi-etape ' + (i === 0 ? 'faite' : i === 1 ? 'actuelle' : 'a-venir')}><span class="suivi-puce"><Icone n={i === 0 ? 'coche' : e.icone} /></span><div><b>{e.titre}</b>{i === 0 ? <small>{dateHeure(o.createdAt)}</small> : i === 1 ? <small>En cours de vérification</small> : null}</div></li>)}
            </ol>
          </section>
          <section class="carte"><h2 class="carte-titre"><Icone n="recu" />Votre commande</h2><Articles o={o} /><Montants o={o} /></section>
          <div class="pile">
            <a class="btn btn-primaire btn-l btn-bloc" href={lien('/suivi/' + o.id)}><Icone n="camion" />Suivre ma commande</a>
            {wa ? <a class="btn btn-secondaire btn-l btn-bloc" href={wa} target="_blank" rel="noopener"><Icone n="bulle" />Envoyer aussi sur WhatsApp</a> : null}
            <a class="btn btn-fantome btn-bloc" href={lien('/')}>Continuer mes achats</a>
          </div>
        </div>
      </main>
      <Pied />
    </>
  );
}

function ouvrirProfil() {
  let nom = profil.value.name || '', tel = profil.value.phone || '';
  const id = ouvrirFeuille({
    titre: 'Mes coordonnées',
    contenu: () => (
      <div class="formulaire">
        <p class="attenue petit">Elles pré-remplissent vos prochaines commandes. Elles restent sur ce téléphone.</p>
        <Champ libelle="Nom complet">{(a) => <input class="saisie" {...a} defaultValue={nom} onInput={(e) => { nom = e.currentTarget.value; }} autocomplete="name" />}</Champ>
        <Champ libelle="Téléphone">{(a) => <input class="saisie" {...a} defaultValue={tel} onInput={(e) => { tel = e.currentTarget.value; }} type="tel" inputmode="tel" autocomplete="tel" placeholder="099 123 4567" />}</Champ>
      </div>
    ),
    pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => {
      const n = nom.trim() ? R.valider.nom(nom) : ''; const t = tel.trim() ? R.valider.telephone(tel) : '';
      if (nom.trim() && !n) { toast('Nom invalide (2 à 60 lettres)', { icone: 'alerte', ton: 'danger' }); return; }
      if (tel.trim() && !t) { toast('Numéro invalide, ex. 099 123 4567', { icone: 'alerte', ton: 'danger' }); return; }
      enregistrerProfil({ name: n, phone: t }); fermerFeuille(id); toast('Coordonnées enregistrées');
    }}>Enregistrer</button>
  });
}

function ouvrirInstallationIOS() {
  ouvrirFeuille({
    titre: 'Installer sur iPhone',
    contenu: () => (
      <ol class="etapes-paiement">
        <li><span>1</span><p>Ouvrez cette page dans <b>Safari</b> (depuis WhatsApp ou Facebook : « Ouvrir dans Safari »).</p></li>
        <li><span>2</span><p>Touchez le bouton <b>Partager</b> <Icone n="partager" taille={16} style={{ display: 'inline', verticalAlign: '-3px' }} /> en bas de l’écran.</p></li>
        <li><span>3</span><p>Choisissez <b>« Sur l’écran d’accueil »</b>, puis <b>« Ajouter »</b>.</p></li>
      </ol>
    )
  });
}

export function Compte() {
  const c = cfg.value; const pf = profil.value;
  useEffect(() => { actualiserMesCommandes(); }, []);
  useSeo(() => ({ titre: 'Mon compte', noindex: true }), []);
  const liste = [...commandes.value.values()];
  const enCours = liste.filter((o) => o.status !== 'cancelled' && o.fulfillment !== 'delivered');
  const wa = lienWhatsApp(c.whatsapp, `Bonjour ${c.name}, j’ai une question.`);
  const item = (props) => {
    const contenu = <><span class="menu-icone"><Icone n={props.icone} /></span><span class="menu-texte"><b>{props.titre}</b>{props.sous ? <small>{props.sous}</small> : null}</span><Icone n="droite" classe="chevron" /></>;
    return props.href ? <a class="menu-item" href={props.href} target={props.externe ? '_blank' : undefined} rel={props.externe ? 'noopener' : undefined}>{contenu}</a> : <button class="menu-item" onClick={props.onClick}>{contenu}</button>;
  };
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur page-compte">
        <div class="titre-page"><h1 class="titre-serif">Mon compte</h1></div>
        <section class="carte profil">
          <span class="initiale" aria-hidden="true">{(pf.name || '?').trim()[0].toUpperCase()}</span>
          <div class="profil-texte"><b>{pf.name || 'Bienvenue'}</b><small>{pf.phone ? telephone(pf.phone) : 'Pas de compte à créer : vos commandes sont suivies sur ce téléphone.'}</small></div>
          <button class="btn btn-secondaire btn-s" onClick={ouvrirProfil}><Icone n="crayon" />{pf.phone ? 'Modifier' : 'Ajouter'}</button>
        </section>
        {enCours.length ? (
          <a class="carte encours" href={lien(enCours.length === 1 ? '/suivi/' + enCours[0].id : '/compte/commandes')}>
            <span class="menu-icone"><Icone n="camion" /></span>
            <span class="menu-texte"><b>{pluriel(enCours.length, 'commande en cours', 'commandes en cours')}</b><small>{enCours.length === 1 ? `#${enCours[0].number} · ${R.statutClient(enCours[0]).label}` : 'Suivez-les étape par étape'}</small></span>
            <Icone n="droite" classe="chevron" />
          </a>
        ) : null}
        <div class="compte-grille">
          <div class="menu">
            {item({ href: lien('/compte/commandes'), icone: 'recu', titre: 'Mes commandes', sous: suivis.value.length ? pluriel(suivis.value.length, 'commande') : 'Suivi et historique' })}
            {item({ href: lien('/favoris'), icone: 'coeur', titre: 'Mes favoris', sous: favoris.value.size ? pluriel(favoris.value.size, 'article') : 'Vos coups de cœur' })}
            {item({ onClick: ouvrirLivraisonPaiement, icone: 'camion', titre: 'Livraison et paiement', sous: 'Zones, délais, Mobile Money' })}
            {wa ? item({ href: wa, externe: true, icone: 'bulle', titre: 'Contacter la boutique', sous: `WhatsApp · ${telephone(c.whatsapp)}` }) : null}
          </div>
          <div class="menu">
            <Bascule actif={themeSombre.value} onClick={basculerTheme} libelle="Thème sombre" sous={themeSombre.value ? 'Activé sur ce téléphone' : 'Désactivé : thème clair'} />
            {installable.value ? item({ onClick: () => (estIOS ? ouvrirInstallationIOS() : installer()), icone: 'mobile', titre: 'Installer l’application', sous: 'Sur l’écran d’accueil, même avec une connexion faible' }) : null}
            {item({ href: lien('/infos/conditions'), icone: 'recu', titre: 'Conditions et confidentialité', sous: 'Vente, retours, données personnelles' })}
            {item({ onClick: async () => { if (await confirmer({ titre: 'Effacer les données de ce téléphone ?', texte: 'Panier, favoris, coordonnées et liens de suivi seront supprimés de ce téléphone. Vos commandes restent enregistrées chez la boutique.', ok: 'Effacer', danger: true })) { effacerAppareil(); toast('Données de ce téléphone effacées', { icone: 'poubelle' }); naviguer('/'); } }, icone: 'poubelle', titre: 'Effacer mes données de ce téléphone', sous: 'Panier, favoris, coordonnées' })}
          </div>
        </div>
      </main>
      <Pied />
    </>
  );
}

export function Commandes() {
  useEffect(() => { actualiserMesCommandes(); }, []);
  useSeo(() => ({ titre: 'Mes commandes', noindex: true }), []);
  const liste = [...commandes.value.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return (
    <>
      <EntetePage titre="Mes commandes" sous={liste.length ? 'Passées depuis ce téléphone' : ''} repli="/compte" />
      <main id="contenu" class="page conteneur">
        {!liste.length && suivis.value.length && !commandesChargees.value ? <div class="pile">{[1, 2].map((i) => <div key={i} class="squelette" style={{ height: 120 }} />)}</div>
          : !liste.length ? <Vide icone="recu" titre="Aucune commande ici" texte="Les commandes passées depuis ce téléphone apparaissent ici. Pour une commande passée ailleurs, ouvrez son lien de suivi."><a class="btn btn-primaire" href={lien('/')}>Commencer mes achats</a></Vide>
            : (
              <ul class="pile commandes-liste">
                {liste.map((o) => {
                  const s = R.statutClient(o);
                  return (
                    <li key={o.id}>
                      <a class="carte carte-commande" href={lien('/suivi/' + o.id)}>
                        <div class="entre"><b class="code">#{o.number}</b><Pastille ton={s.ton} point>{s.label}</Pastille></div>
                        <p class="discret petit">{dateHeure(o.createdAt)} · {pluriel((o.items || []).reduce((a, i) => a + i.qty, 0), 'article')}</p>
                        <div class="cc-bas">
                          <div class="cc-photos">{(o.items || []).slice(0, 4).map((i, k) => <span key={k}><Photo m={imageLigne(i)} alt="" tailles="48px" /></span>)}</div>
                          <span class="prix">{dollars(o.total)}</span>
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
      </main>
      <Pied />
    </>
  );
}

export function Suivi() {
  const id = route.value.params.id; const c = cfg.value;
  const [verif, setVerif] = useState(false);
  useEffect(() => {
    // Lien de suivi partagé : /suivi/<id>#<jeton>
    const t = (location.hash || '').replace(/^#\/?/, '').split('#').pop();
    if (R.valider.jeton(t)) { suivreCommande(id, t); try { history.replaceState(history.state, '', location.pathname); } catch (e) { } }
    actualiserMesCommandes().then(() => setVerif(true));
  }, [id]);
  useSeo(() => ({ titre: 'Suivi de commande', noindex: true }), []);
  const o = commandes.value.get(id);
  if (!o) {
    return (
      <>
        <EntetePage titre="Suivi de commande" repli="/compte/commandes" />
        <main id="contenu" class="page conteneur">
          {!verif ? <div class="squelette" style={{ height: 260 }} /> : <Vide icone="recu" titre="Commande introuvable sur ce téléphone" texte="Ouvrez le lien de suivi reçu après la commande, ou écrivez à la boutique avec votre numéro de commande.">{c.whatsapp ? <a class="btn btn-secondaire" href={lienWhatsApp(c.whatsapp, 'Bonjour, je souhaite suivre ma commande.')} target="_blank" rel="noopener"><Icone n="bulle" />Écrire à la boutique</a> : null}</Vide>}
        </main>
      </>
    );
  }
  const s = R.statutClient(o); const etapes = R.etapesSuivi(o);
  const quand = [o.createdAt, o.payment && o.payment.paidAt, o.preparingAt || ((o.timeline || []).find((e) => /^Préparation/.test(e.text)) || {}).at, o.shippedAt, o.deliveredAt];
  const wa = lienWhatsApp(c.whatsapp, `Bonjour ${c.name}, je vous écris au sujet de ma commande #${o.number}.`);
  const ls = lienSuivi(o.id);
  return (
    <>
      <EntetePage titre={'Commande #' + o.number} sous={dateHeure(o.createdAt)} repli="/compte/commandes" />
      <main id="contenu" class="page conteneur page-suivi">
        <div class="suivi-grille">
          <div class="pile-l">
            <section class="carte">
              <div class="entre"><h2 class="carte-titre" style={{ margin: 0 }}><Icone n="camion" />Suivi</h2><Pastille ton={s.ton} point>{s.label}</Pastille></div>
              {s.etape < 0 ? <Note ton="danger" icone="alerte" classe="espace-haut">Cette commande a été annulée{o.payment && o.payment.status === 'refunded' ? ' et remboursée' : ''}. Contactez la boutique pour toute question.</Note> : (
                <ol class="suivi">
                  {etapes.map((e, i) => {
                    const fait = i < s.etape || (i === 4 && s.etape === 4); const actuelle = i === s.etape && s.etape < 4;
                    return <li key={i} class={'suivi-etape ' + (fait ? 'faite' : actuelle ? 'actuelle' : 'a-venir')}><span class="suivi-puce"><Icone n={fait ? 'coche' : e.icone} /></span><div><b>{e.titre}</b>{quand[i] && (fait || actuelle) ? <small>{dateHeure(quand[i])}</small> : actuelle && i === 1 ? <small>La boutique vérifie votre paiement</small> : null}</div></li>;
                  })}
                </ol>
              )}
              {o.review && s.etape === 0 ? <Note ton="alerte" icone="info" classe="espace-haut">Un point de votre commande est à vérifier : la boutique vous contacte.</Note> : null}
            </section>
            <section class="carte"><h2 class="carte-titre"><Icone n="recu" />Articles</h2><Articles o={o} /><Montants o={o} /></section>
          </div>
          <div class="pile-l">
            <section class="carte">
              <h2 class="carte-titre"><Icone n="portefeuille" />Paiement</h2>
              <dl class="infos"><dt>Mode</dt><dd>{o.payment.label}</dd>{o.payment.ref ? <><dt>Code</dt><dd>{o.payment.ref}</dd></> : null}<dt>Statut</dt><dd>{o.payment.status === 'paid' ? 'Confirmé' : o.payment.status === 'refunded' ? 'Remboursé' : 'En vérification'}</dd></dl>
            </section>
            <section class="carte">
              <h2 class="carte-titre"><Icone n="repere" />Livraison</h2>
              <dl class="infos"><dt>Zone</dt><dd>{o.shipping.zoneName}</dd>{o.shipping.address ? <><dt>Adresse</dt><dd>{o.shipping.address}</dd></> : null}{o.shipping.landmark ? <><dt>Repère</dt><dd>{o.shipping.landmark}</dd></> : null}<dt>Contact</dt><dd>{o.customer.name} · {telephone(o.customer.phone)}</dd></dl>
            </section>
            <div class="pile">
              {wa ? <a class="btn btn-secondaire btn-bloc" href={wa} target="_blank" rel="noopener"><Icone n="bulle" />Une question ? Écrire à la boutique</a> : null}
              {ls ? <button class="btn btn-fantome btn-bloc" onClick={async () => { if (await copier(ls)) toast('Lien de suivi copié'); }}><Icone n="copier" />Copier le lien de suivi</button> : null}
              {ls ? <p class="discret tres-petit centre">Ce lien permet de suivre la commande depuis un autre téléphone. Partagez-le seulement avec vos proches.</p> : null}
            </div>
          </div>
        </div>
      </main>
      <Pied />
    </>
  );
}
