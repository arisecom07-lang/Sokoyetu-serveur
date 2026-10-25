// Sokoyetu (boutique) — reçu de commande, compte, commandes, suivi, commande retrouvée par son numéro.
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Note, Vide, Bascule, toast, ouvrirFeuille, fermerFeuille, confirmer, Pastille } from '../../commun/js/interface.jsx';
import { themeSombre, basculerTheme } from '../../commun/js/theme.js';
import { dollars, dateHeure, telephone, lienWhatsApp, pluriel, copier, classes } from '../../commun/js/outils.js';
import { lien, route, naviguer } from '../routeur.js';
import { cfg, commandes, suivis, commandesChargees, actualiserMesCommandes, suivreCommande, jetonDe, profil, enregistrerProfil, favoris, effacerAppareil, produitsParId, retrouverCommande, remettreAuPanier } from '../etat.js';
import { EnteteBoutique, EntetePage, Pied, Marque, ouvrirLivraisonPaiement } from '../composants/cadre.jsx';
import { installable, installer, estIOS } from '../installation.jsx';
import { Montants as MontantsDevis } from './commander.jsx';
import { useSeo } from './commun.jsx';

const imageLigne = (i) => i.image || R.imagePrincipale(produitsParId.value.get(i.productId) || {});
const lienSuivi = (id) => { const t = jetonDe(id); return t ? `${location.origin}/suivi/${id}#${t}` : ''; };
/* 0991234567 → « 099 ••• 4567 » */
const masque = (tel) => { const t = telephone(tel); return t ? t.replace(/^(.*?)(\d{3})( ?)(\d{4})$/, (_, a, b, s, d) => `${a}•••${s}${d}`) : ''; };
const jourLong = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const ouvrirPaiement = (o) => R.enAttentePaiement(o);

/* Délai annoncé au client : « jeudi 7 novembre (environ 21 jours, article importé) ». */
function texteLivraison(o) {
  const d = o.delivery; if (!d || !d.at) return '';
  if (R.estRetraitCmd(o) && !d.days) return 'Dès que possible : nous vous appelons quand elle est prête';
  return `${R.estRetraitCmd(o) ? 'Prête vers le' : 'Vers le'} ${jourLong(d.at)} (environ ${pluriel(d.days, 'jour')}${d.import ? ', article importé' : ''})`;
}
const montantsCommande = (o) => ({ sousTotal: o.subtotal, remise: o.discount, livraison: o.shippingFee, frais: o.serviceFee, fraisPct: o.serviceFeePct, total: o.total });

function Articles({ o }) {
  return (
    <ul class="recap-articles">
      {(o.items || []).map((i, k) => <li key={k}><span class="ra-photo"><Photo m={imageLigne(i)} alt="" tailles="56px" />{i.qty > 1 ? <i>{i.qty}</i> : null}</span><span class="ra-texte"><b>{i.title}</b><small>{[i.color, i.size].filter(Boolean).join(' · ')}</small></span><span class="num">{dollars(i.price * i.qty)}</span></li>)}
    </ul>
  );
}
const Montants = ({ o, libelleTotal }) => <MontantsDevis m={montantsCommande(o)} zone={o.shipping && o.shipping.zoneName} libelleTotal={libelleTotal} />;

function texteRecu(o) {
  const c = cfg.value; const p = o.payment || {};
  return [
    `Reçu ${c.name} · commande #${o.number}`,
    `Payée le ${dateHeure(p.paidAt || o.createdAt)} · ${p.label}${p.reference ? ` · réf. ${p.reference}` : ''}`,
    ...(o.items || []).map((i) => `• ${i.title}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(' / ')})` : ''} × ${i.qty} : ${dollars(i.price * i.qty)}`),
    o.discount ? `Code ${o.discount.code} : −${dollars(o.discount.amount)}` : '',
    `Livraison : ${o.shippingFee ? dollars(o.shippingFee) : 'gratuite'}`,
    o.serviceFee ? `Frais de service (${R.num(o.serviceFeePct)} %) : ${dollars(o.serviceFee)}` : '',
    `Total payé : ${dollars(o.total)}`,
    texteLivraison(o) ? `Livraison prévue : ${texteLivraison(o)}` : '',
    `Retrouvez votre commande sur ${location.host} avec le numéro ${o.number}.`
  ].filter(Boolean).join('\n');
}
async function partagerRecu(o) {
  const texte = texteRecu(o);
  if (navigator.share) { try { await navigator.share({ title: `Reçu · commande #${o.number}`, text: texte }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  if (await copier(texte)) toast('Reçu copié : collez-le où vous voulez', { icone: 'copier' });
}

/* Le reçu : numéro de commande, paiement, articles, montants, délai de livraison. */
function Recu({ o }) {
  const c = cfg.value; const p = o.payment || {}; const retrait = R.estRetraitCmd(o);
  return (
    <article class="recu" aria-labelledby="recu-titre">
      <header class="recu-tete">
        <Marque />
        <div><h2 id="recu-titre">Reçu de commande</h2><small>{dateHeure(p.paidAt || o.createdAt)}</small></div>
      </header>
      <div class="recu-numero">
        <div><small>Numéro de commande</small><b class="code">{o.number}</b></div>
        <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(o.number)) toast('Numéro copié'); }}><Icone n="copier" />Copier</button>
      </div>
      <dl class="infos recu-infos">
        <dt>Statut</dt><dd><Pastille ton="ok" point>{p.status === 'refunded' ? 'Remboursée' : 'Payée'}</Pastille></dd>
        <dt>Payée avec</dt><dd>{p.label}{p.phone ? ` · ${masque(p.phone)}` : ''}</dd>
        {p.reference ? <><dt>Transaction</dt><dd class="code">{p.reference}</dd></> : null}
        <dt>Client</dt><dd>{o.customer.name}</dd>
        <dt>{retrait ? 'Retrait' : 'Livraison'}</dt><dd>{o.shipping.zoneName}{o.shipping.address ? ` · ${o.shipping.address}` : ''}</dd>
        {texteLivraison(o) ? <><dt>{retrait ? 'Prête' : 'Prévue'}</dt><dd><b>{texteLivraison(o)}</b></dd></> : null}
      </dl>
      <div class="recu-trait" aria-hidden="true" />
      <Articles o={o} />
      <Montants o={o} libelleTotal="Total payé" />
      <footer class="recu-pied">
        {p.test ? <p><b>Commande de test :</b> aucun argent n’a été débité.</p> : null}
        <p>Gardez ce numéro : avec votre téléphone, il permet de retrouver la commande depuis n’importe quel appareil (Mon compte → Retrouver une commande).</p>
        <p>{(c.legal && c.legal.company) || c.name} · {c.city}</p>
      </footer>
    </article>
  );
}

export function Merci() {
  const id = route.value.params.id; const o = commandes.value.get(id);
  const [verif, setVerif] = useState(false);
  useSeo(() => ({ titre: 'Reçu de commande', noindex: true }), []);
  useEffect(() => { if (jetonDe(id)) actualiserMesCommandes().then(() => setVerif(true)); else setVerif(true); }, [id]);
  useEffect(() => { if (o && ouvrirPaiement(o)) naviguer('/paiement/' + id, { remplacer: true }); else if (o && !R.estPayee(o) && o.payment.status !== 'refunded') naviguer('/suivi/' + id, { remplacer: true }); }, [o && o.payment.status, o && o.status]);
  if (!o) {
    return <><EnteteBoutique /><main id="contenu" class="page conteneur">{!verif ? <div class="squelette" style={{ height: 420 }} /> : <Vide icone="recu" titre="Reçu introuvable sur ce téléphone" texte="Retrouvez votre commande avec son numéro et votre téléphone."><a class="btn btn-primaire" href={lien('/compte/retrouver')}><Icone n="recherche" />Retrouver ma commande</a></Vide>}</main></>;
  }
  const prenom = String(o.customer.name || '').split(/\s+/)[0];
  return (
    <>
      <EnteteBoutique />
      <main id="contenu" class="page conteneur page-merci">
        <section class="merci-tete entree non-imprime">
          <div class="merci-coche" aria-hidden="true"><Icone n="coche" /></div>
          <h1 class="titre-serif">Paiement reçu, merci {prenom} !</h1>
          <p class="attenue">Votre commande est confirmée. Voici votre reçu.</p>
        </section>
        <div class="pile-l merci-corps">
          {o.review ? <Note ton="alerte" icone="alerte" classe="non-imprime"><b>Un point est à vérifier.</b> Votre paiement est arrivé après le délai : la boutique vérifie que vos articles sont toujours disponibles et vous appelle au {telephone(o.customer.phone)}.</Note> : null}
          <Recu o={o} />
          <div class="pile non-imprime">
            <a class="btn btn-primaire btn-l btn-bloc" href={lien('/suivi/' + o.id)}><Icone n="camion" />Suivre ma commande</a>
            <div class="rangee-boutons">
              <button class="btn btn-secondaire btn-bloc" onClick={() => partagerRecu(o)}><Icone n="partager" />Partager le reçu</button>
              <button class="btn btn-secondaire btn-bloc" onClick={() => window.print()}><Icone n="telecharger" />Enregistrer en PDF</button>
            </div>
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
  const seule = enCours.length === 1 ? enCours[0] : null;
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
          <a class="carte encours" href={lien(seule ? (ouvrirPaiement(seule) ? '/paiement/' : '/suivi/') + seule.id : '/compte/commandes')}>
            <span class="menu-icone"><Icone n="camion" /></span>
            <span class="menu-texte"><b>{pluriel(enCours.length, 'commande en cours', 'commandes en cours')}</b><small>{seule ? `#${seule.number} · ${R.statutClient(seule).label}` : 'Suivez-les étape par étape'}</small></span>
            <Icone n="droite" classe="chevron" />
          </a>
        ) : null}
        <div class="compte-grille">
          <div class="menu">
            {item({ href: lien('/compte/commandes'), icone: 'recu', titre: 'Mes commandes', sous: suivis.value.length ? pluriel(suivis.value.length, 'commande') : 'Reçus, suivi et historique' })}
            {item({ href: lien('/compte/retrouver'), icone: 'recherche', titre: 'Retrouver une commande', sous: 'Avec le numéro de votre reçu' })}
            {item({ href: lien('/favoris'), icone: 'coeur', titre: 'Mes favoris', sous: favoris.value.size ? pluriel(favoris.value.size, 'article') : 'Vos coups de cœur' })}
            {item({ onClick: ouvrirLivraisonPaiement, icone: 'camion', titre: 'Livraison et paiement', sous: 'Zones, délais, Mobile Money' })}
            {wa ? item({ href: wa, externe: true, icone: 'bulle', titre: 'Contacter la boutique', sous: `WhatsApp · ${telephone(c.whatsapp)}` }) : null}
          </div>
          <div class="menu">
            <Bascule actif={themeSombre.value} onClick={basculerTheme} libelle="Thème sombre" sous={themeSombre.value ? 'Activé sur ce téléphone' : 'Désactivé : thème clair'} />
            {installable.value ? item({ onClick: () => (estIOS ? ouvrirInstallationIOS() : installer()), icone: 'mobile', titre: 'Installer l’application', sous: 'Sur l’écran d’accueil, même avec une connexion faible' }) : null}
            {item({ href: lien('/infos/conditions'), icone: 'recu', titre: 'Conditions et confidentialité', sous: 'Vente, retours, données personnelles' })}
            {item({ onClick: async () => { if (await confirmer({ titre: 'Effacer les données de ce téléphone ?', texte: 'Panier, favoris, coordonnées et liens de suivi seront supprimés de ce téléphone. Vos commandes restent enregistrées chez la boutique : retrouvez-les avec leur numéro.', ok: 'Effacer', danger: true })) { effacerAppareil(); toast('Données de ce téléphone effacées', { icone: 'poubelle' }); naviguer('/'); } }, icone: 'poubelle', titre: 'Effacer mes données de ce téléphone', sous: 'Panier, favoris, coordonnées' })}
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
      <EntetePage titre="Mes commandes" sous={liste.length ? 'Passées ou retrouvées sur ce téléphone' : ''} repli="/compte" />
      <main id="contenu" class="page conteneur">
        {!liste.length && suivis.value.length && !commandesChargees.value ? <div class="pile">{[1, 2].map((i) => <div key={i} class="squelette" style={{ height: 120 }} />)}</div>
          : !liste.length ? (
            <Vide icone="recu" titre="Aucune commande ici" texte="Les commandes passées depuis ce téléphone apparaissent ici. Commande passée ailleurs ? Retrouvez-la avec le numéro de son reçu.">
              <a class="btn btn-primaire" href={lien('/compte/retrouver')}><Icone n="recherche" />Retrouver une commande</a>
              <a class="btn btn-fantome" href={lien('/')}>Commencer mes achats</a>
            </Vide>
          ) : (
            <>
              <ul class="pile commandes-liste">
                {liste.map((o) => {
                  const s = R.statutClient(o);
                  return (
                    <li key={o.id}>
                      <a class="carte carte-commande" href={lien((ouvrirPaiement(o) ? '/paiement/' : '/suivi/') + o.id)}>
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
              <p class="centre espace-haut"><a class="lien" href={lien('/compte/retrouver')}>Une commande manque ? Retrouvez-la avec son numéro</a></p>
            </>
          )}
      </main>
      <Pied />
    </>
  );
}

/* Commande passée sur un autre téléphone, ou historique effacé : numéro du reçu + téléphone du client. */
export function Retrouver() {
  const [f, setF] = useState({ numero: '', tel: profil.value.phone || '', erreurs: {}, envoi: false });
  const maj = (p) => setF((x) => ({ ...x, ...p }));
  useSeo(() => ({ titre: 'Retrouver une commande', noindex: true }), []);
  async function chercher(e) {
    e.preventDefault();
    if (f.envoi) return;
    const erreurs = {};
    if (!R.numeroValide(f.numero)) erreurs.numero = 'Le numéro figure sur votre reçu : 6 lettres et chiffres, par exemple K7M2QX.';
    if (!R.valider.telephone(f.tel)) erreurs.tel = 'Numéro invalide. Exemple : 099 123 4567.';
    if (Object.keys(erreurs).length) { maj({ erreurs }); return; }
    maj({ envoi: true, erreurs: {} });
    try {
      const id = await retrouverCommande(R.numeroNettoye(f.numero), f.tel);
      toast('Commande retrouvée');
      naviguer('/suivi/' + id, { remplacer: true });
    } catch (err) {
      maj({ envoi: false });
      if (err.status === 404 || err.status === 400) maj({ envoi: false, erreurs: { numero: err.message } });
      else toast(err.message, { icone: 'alerte', ton: 'danger', duree: 5000 });
    }
  }
  return (
    <>
      <EntetePage titre="Retrouver une commande" repli="/compte" />
      <main id="contenu" class="page conteneur page-retrouver">
        <form class="carte pile-l" onSubmit={chercher} noValidate>
          <div class="pile">
            <h1 class="titre-serif">Retrouver une commande</h1>
            <p class="attenue">Saisissez le numéro inscrit sur votre reçu et le téléphone donné à la commande (ou celui qui a payé). La commande s’ajoute à « Mes commandes » sur ce téléphone.</p>
          </div>
          <div class="formulaire">
            <Champ libelle="Numéro de commande" erreur={f.erreurs.numero}>{(a) => <input class="saisie saisie-code" {...a} value={f.numero} onInput={(e) => maj({ numero: e.currentTarget.value.toUpperCase(), erreurs: {} })} autocomplete="off" autocapitalize="characters" spellcheck={false} maxlength="9" placeholder="Ex. : K7M2QX" />}</Champ>
            <Champ libelle="Téléphone" erreur={f.erreurs.tel}>{(a) => <input class="saisie" {...a} value={f.tel} onInput={(e) => maj({ tel: e.currentTarget.value, erreurs: {} })} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="099 123 4567" />}</Champ>
          </div>
          <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit"><Icone n="recherche" />Retrouver ma commande</button>
        </form>
      </main>
      <Pied />
    </>
  );
}

const STATUT_PAIEMENT = { paid: 'Payé', pending: 'En attente de votre validation', failed: 'Non abouti', expired: 'Non reçu dans le délai', refunded: 'Remboursé' };

export function Suivi() {
  const id = route.value.params.id;
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
          {!verif ? <div class="squelette" style={{ height: 260 }} /> : <Vide icone="recu" titre="Commande introuvable sur ce téléphone" texte="Ouvrez le lien de suivi de la commande, ou retrouvez-la avec le numéro de son reçu et votre téléphone."><a class="btn btn-primaire" href={lien('/compte/retrouver')}><Icone n="recherche" />Retrouver ma commande</a></Vide>}
        </main>
      </>
    );
  }
  const s = R.statutClient(o); const etapes = R.etapesSuivi(o);
  const quand = [o.createdAt, o.payment && o.payment.paidAt, o.preparingAt || ((o.timeline || []).find((e) => /^Préparation/.test(e.text)) || {}).at, o.shippedAt, o.deliveredAt];
  const ls = lienSuivi(o.id);
  const attente = ouvrirPaiement(o); const payee = R.estPayee(o) || o.payment.status === 'refunded';
  const livraison = payee && o.status !== 'cancelled' && o.fulfillment !== 'delivered' ? texteLivraison(o) : '';
  return (
    <>
      <EntetePage titre={'Commande #' + o.number} sous={dateHeure(o.createdAt)} repli="/compte/commandes" />
      <main id="contenu" class="page conteneur page-suivi">
        <div class="suivi-grille">
          <div class="pile-l">
            {attente ? (
              <a class="carte encours attente-paiement" href={lien('/paiement/' + o.id)}>
                <span class="menu-icone"><Icone n="mobile" /></span>
                <span class="menu-texte"><b>{o.payment.status === 'failed' ? 'Paiement non abouti' : 'Paiement à valider'}</b><small>{o.payment.status === 'failed' ? 'Réessayez pour confirmer la commande' : `Validez la demande ${o.payment.label} sur votre téléphone`}</small></span>
                <Icone n="droite" classe="chevron" />
              </a>
            ) : null}
            <section class="carte">
              <div class="entre"><h2 class="carte-titre" style={{ margin: 0 }}><Icone n="camion" />Suivi</h2><Pastille ton={s.ton} point>{s.label}</Pastille></div>
              {s.etape < 0 ? (
                <div class="pile espace-haut">
                  <Note ton="danger" icone="alerte">{R.nonAboutie(o) ? 'Le paiement n’est pas arrivé à temps : la commande a été annulée et ses articles remis en vente.' : `Cette commande a été annulée${o.payment && o.payment.status === 'refunded' ? ' et remboursée' : ''}.`}</Note>
                  {R.nonAboutie(o) ? <button class="btn btn-secondaire btn-bloc" onClick={() => { const n = remettreAuPanier(o); toast(n ? 'Articles remis dans votre panier' : 'Ces articles ne sont plus en vente', { icone: n ? 'sac' : 'alerte' }); if (n) naviguer('/panier'); }}><Icone n="sac" />Remettre les articles dans mon panier</button> : null}
                </div>
              ) : (
                <ol class="suivi">
                  {etapes.map((e, i) => {
                    const fait = i < s.etape || (i === 4 && s.etape === 4); const actuelle = i === s.etape && s.etape < 4;
                    return <li key={i} class={'suivi-etape ' + (fait ? 'faite' : actuelle ? 'actuelle' : 'a-venir')}><span class="suivi-puce"><Icone n={fait ? 'coche' : e.icone} /></span><div><b>{e.titre}</b>{quand[i] && (fait || actuelle) ? <small>{dateHeure(quand[i])}</small> : null}{i === 0 && attente ? <small>En attente du paiement</small> : null}</div></li>;
                  })}
                </ol>
              )}
              {o.review && s.etape >= 0 ? <Note ton="alerte" icone="info" classe="espace-haut">Un point de votre commande est à vérifier : la boutique vous appelle.</Note> : null}
            </section>
            <section class="carte"><h2 class="carte-titre"><Icone n="recu" />Articles</h2><Articles o={o} /><Montants o={o} libelleTotal={payee ? 'Total payé' : 'Total'} /></section>
          </div>
          <div class="pile-l">
            <section class="carte">
              <h2 class="carte-titre"><Icone n="portefeuille" />Paiement</h2>
              <dl class="infos">
                <dt>Mode</dt><dd>{o.payment.label}{o.payment.phone ? ` · ${masque(o.payment.phone)}` : ''}</dd>
                {o.payment.reference ? <><dt>Transaction</dt><dd class="code">{o.payment.reference}</dd></> : null}
                <dt>Statut</dt><dd>{STATUT_PAIEMENT[o.payment.status] || 'En attente'}</dd>
              </dl>
              {payee ? <a class="btn btn-secondaire btn-bloc espace-haut" href={lien('/merci/' + o.id)}><Icone n="recu" />Voir le reçu</a> : null}
            </section>
            <section class="carte">
              <h2 class="carte-titre"><Icone n="repere" />{R.estRetraitCmd(o) ? 'Retrait' : 'Livraison'}</h2>
              <dl class="infos"><dt>Zone</dt><dd>{o.shipping.zoneName}</dd>{o.shipping.address ? <><dt>Adresse</dt><dd>{o.shipping.address}</dd></> : null}{o.shipping.landmark ? <><dt>Repère</dt><dd>{o.shipping.landmark}</dd></> : null}{livraison ? <><dt>Prévue</dt><dd>{livraison}</dd></> : null}<dt>Contact</dt><dd>{o.customer.name} · {telephone(o.customer.phone)}</dd></dl>
            </section>
            <div class="pile">
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
