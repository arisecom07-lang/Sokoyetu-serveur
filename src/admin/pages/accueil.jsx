// Sokoyetu (administration) — connexion et tableau de bord.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Note, Segment, Pastille } from '../../commun/js/interface.jsx';
import { Local } from '../../commun/js/stockage.js';
import { DEMO } from '../../commun/js/api.js';
import { dollars, date, debutJour, JOUR, pluriel, ilya, classes } from '../../commun/js/outils.js';
import { lien } from '../routeur.js';
import { cfg, commandes, produits, produitsParId, nbExemples, seConnecter, pret, paiementServeur } from '../etat.js';
import { TetePage, Kpi, adresseBoutique } from '../composants/cadre.jsx';
import { Histogramme } from '../composants/graphique.jsx';
import { statutPaiement, statutPreparation, avecPoints } from './commandes.jsx';

export function Connexion() {
  const [email, setEmail] = useState(DEMO ? 'demo@sokoyetu.com' : Local.lire('dernierEmail', ''));
  const [mdp, setMdp] = useState(DEMO ? 'Sokoyetu-demo' : '');
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const envoyer = async (e) => {
    e.preventDefault();
    if (!email.trim() || !mdp) { setErreur('Indiquez votre e-mail et votre mot de passe.'); return; }
    setOccupe(true); setErreur('');
    try { await seConnecter(email, mdp); Local.ecrire('dernierEmail', email.trim().toLowerCase()); }
    catch (err) {
      setOccupe(false);
      setErreur(err.code === 'limite' ? 'Trop d’essais. Patientez quelques secondes.' : err.status === 400 ? 'E-mail ou mot de passe incorrect.' : err.status === 403 ? err.message : 'Connexion au serveur impossible. Vérifiez votre connexion.');
    }
  };
  return (
    <main class="connexion" id="contenu">
      <form class="connexion-carte entree" onSubmit={envoyer} noValidate>
        <img src="icone-192.png" alt="" width="64" height="64" class="connexion-logo" />
        <h1><span class="marque">Sokoyetu<i>.</i></span><small>Administration</small></h1>
        <p class="attenue">Connectez-vous avec le compte administrateur de la boutique.</p>
        {DEMO ? <Note ton="info" icone="info">Démonstration : le compte est déjà rempli, touchez « Se connecter ».</Note> : null}
        <div class="formulaire">
          <Champ libelle="E-mail">{(a) => <input class="saisie" {...a} type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck={false} value={email} onInput={(e) => setEmail(e.currentTarget.value)} autofocus={!email} />}</Champ>
          <Champ libelle="Mot de passe">{(a) => (
            <div class="saisie-groupe">
              <input class="saisie" {...a} type={voir ? 'text' : 'password'} autocomplete="current-password" value={mdp} onInput={(e) => setMdp(e.currentTarget.value)} style={{ paddingRight: 52 }} autofocus={!!email} />
              <button type="button" class="btn-icone voir-mdp" onClick={() => setVoir(!voir)} aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}><Icone n={voir ? 'oeilBarre' : 'oeil'} /></button>
            </div>
          )}</Champ>
          {erreur ? <p class="champ-erreur" role="alert"><Icone n="alerte" />{erreur}</p> : null}
          <button class={classes('btn btn-primaire btn-l btn-bloc', occupe && 'charge')} type="submit">Se connecter</button>
        </div>
        <details class="aide-mdp">
          <summary>Mot de passe oublié ?</summary>
          <p>Il se change depuis la console du serveur (DigitalOcean → votre Droplet → Console) :</p>
          <code>sudo /opt/sokoyetu/mot-de-passe.sh votre@email.com 'NouveauMotDePasse'</code>
        </details>
        <a class="lien petit" href={adresseBoutique('/')} target="_blank" rel="noopener">Ouvrir la boutique</a>
      </form>
    </main>
  );
}

/* Une vente = une commande payée (confirmée par l'opérateur), comptée le jour du paiement. */
const venteDu = (o) => (o.payment && o.payment.paidAt) || o.createdAt || 0;
const estVente = (o) => o.status !== 'cancelled' && R.estPayee(o);
function statistiques(liste, debut, fin) {
  const l = liste.filter((o) => estVente(o) && venteDu(o) >= debut && venteDu(o) < fin);
  const ventes = l.reduce((a, o) => a + R.num(o.total), 0);
  const frais = l.reduce((a, o) => a + R.num(o.serviceFee), 0);
  const marge = l.reduce((a, o) => a + R.margeCommande(o).marge, 0);
  const margeConnue = l.every((o) => R.margeCommande(o).connue);
  return { l, ventes, frais, marge, margeConnue, n: l.length, panier: l.length ? ventes / l.length : 0 };
}
function evolution(a, b) {
  if (!b) return a ? { texte: 'Nouveau', ton: 'ok' } : null;
  const p = Math.round(((a - b) / b) * 100);
  if (!p) return { texte: '= période précédente', ton: '' };
  return { texte: `${p > 0 ? '▲ +' : '▼ '}${p} % vs période précédente`, ton: p > 0 ? 'ok' : 'danger' };
}

function etapesDemarrage(c) {
  const ps = produits.value;
  return [
    { texte: 'Ajouter vos propres produits', fait: ps.some((p) => !p.demo), href: '/produits/nouveau' },
    { texte: 'Brancher le paiement Mobile Money (FlexPay)', fait: paiementServeur.value.pret && paiementServeur.value.fournisseur === 'flexpay', href: '/reglages/paiements' },
    { texte: 'Vérifier les zones et frais de livraison', fait: !!(c.setup && c.setup.livraison), href: '/reglages/livraison' },
    { texte: 'Ajouter le numéro WhatsApp de la boutique', fait: !!R.chiffres(c.whatsapp), href: '/reglages/general' },
    { texte: 'Compléter les informations légales (RCCM, adresse)', fait: !!(c.legal && c.legal.company && c.legal.address && (c.legal.rccm || c.legal.idnat)), href: '/reglages/legal' },
    { texte: 'Passer une commande test', fait: commandes.value.some(R.estPayee), href: null }
  ];
}

export function Tableau() {
  const c = cfg.value; const os = commandes.value;
  const [periode, setPeriode] = useState(Local.lire('periode', 7));
  const changer = (p) => { setPeriode(p); Local.ecrire('periode', p); };
  const maintenant = Date.now(); const auj = debutJour(maintenant);
  const debut = auj - (periode - 1) * JOUR; const fin = auj + JOUR;
  const st = statistiques(os, debut, fin); const avant = statistiques(os, debut - periode * JOUR, debut);
  const nJours = Math.max(7, periode); const d0 = auj - (nJours - 1) * JOUR;
  const jours = Array.from({ length: nJours }, (_, i) => ({ t: d0 + i * JOUR, v: 0, n: 0 }));
  os.forEach((o) => { if (!estVente(o)) return; const i = Math.floor((debutJour(venteDu(o)) - d0) / JOUR); if (i >= 0 && i < nJours) { jours[i].v += R.num(o.total); jours[i].n++; } });

  const nPaiement = os.filter(R.enAttentePaiement).length, nPrep = os.filter(R.aPreparer).length, nLiv = os.filter(R.aExpedier).length;
  const nPoints = os.filter(avecPoints).length;
  const p = paiementServeur.value;
  const faibles = produits.value.filter((p) => R.estEnVente(p) && !R.estImport(p) && R.stockTotal(p) <= R.int(c.lowStock));
  const top = {};
  st.l.forEach((o) => (o.items || []).forEach((i) => { const t = top[i.productId] = top[i.productId] || { id: i.productId, titre: i.title, image: i.image || R.imagePrincipale(produitsParId.value.get(i.productId) || {}), qte: 0, ca: 0 }; t.qte += R.int(i.qty); t.ca += R.int(i.qty) * R.num(i.price); }));
  const meilleurs = Object.values(top).sort((a, b) => b.qte - a.qte).slice(0, 5);
  const guide = etapesDemarrage(c); const faits = guide.filter((g) => g.fait).length;
  const h = new Date().getHours();
  const lib = { 1: 'aujourd’hui', 7: 'sur 7 jours', 30: 'sur 30 jours' }[periode];
  const evV = evolution(st.ventes, avant.ventes);

  return (
    <>
      <TetePage grand titre={`${h < 18 ? 'Bonjour' : 'Bonsoir'}${c.ownerName ? ', ' + c.ownerName : ''}`} sous={`${date(maintenant, { weekday: 'long', day: 'numeric', month: 'long' })} · ${os.length ? pluriel(os.length, 'commande') + ' au total' : 'prêt pour vos premières ventes'}`}
        actions={<Segment libelle="Période" options={[[1, 'Aujourd’hui'], [7, '7 jours'], [30, '30 jours']]} valeur={periode} onChange={(v) => changer(Number(v))} />} />
      <div class="pile-l">
        {!p.pret ? <Note ton="danger" icone="portefeuille">La boutique n’encaisse pas encore : le paiement Mobile Money n’est pas branché sur le serveur. <a class="lien" href={lien('/reglages/paiements')}>Voir comment l’activer</a></Note>
          : p.test ? <Note ton="alerte" icone="portefeuille">Paiement en <b>mode test</b> : les commandes sont confirmées sans argent. <a class="lien" href={lien('/reglages/paiements')}>Brancher FlexPay</a></Note> : null}
        {nbExemples.value ? <Note ton="info" icone="info">Le catalogue d’exemple est affiché dans la boutique ({pluriel(nbExemples.value, 'élément')}). Remplacez-le par vos articles, ou retirez-le dans <a class="lien" href={lien('/reglages/general')}>Réglages → Général</a>.</Note> : null}
        <div class="kpis">
          <Kpi grand libelle={`Ventes ${lib}`} icone="graphique" valeur={dollars(st.ventes)} sous={evV ? evV.texte : 'Commandes payées'} ton={evV && evV.ton} />
          <Kpi libelle="Commandes payées" icone="recu" valeur={String(st.n)} sous={nPrep ? `${nPrep} à préparer` : 'Tout est à jour'} href={lien('/commandes')} ton={nPrep ? 'alerte' : 'ok'} />
          <Kpi libelle="Marge estimée" icone="portefeuille" valeur={dollars(st.marge)} sous={st.ventes ? `${Math.round((st.marge / Math.max(1, st.ventes)) * 100)} % des ventes${st.margeConnue ? '' : ' · coûts incomplets'}` : 'après coûts d’achat'} />
          <Kpi libelle="Panier moyen" icone="sac" valeur={dollars(st.panier)} sous={st.frais ? `dont ${dollars(st.frais)} de frais de service` : 'par commande payée'} />
        </div>
        <div class="tableau-grille">
          <div class="pile-l">
            <section class="carte">
              <h2 class="carte-titre"><Icone n="graphique" />Ventes par jour<span class="fin">{nJours} derniers jours</span></h2>
              <Histogramme jours={jours} />
            </section>
            <section class="carte">
              <h2 class="carte-titre"><Icone n="recu" />Dernières commandes{os.length ? <a class="fin lien" href={lien('/commandes')}>Tout voir</a> : null}</h2>
              {os.length ? <div class="liste sans-bord">{os.filter((o) => !R.nonAboutie(o)).slice(0, 5).map((o) => <LigneCommandeCourte key={o.id} o={o} />)}</div>
                : <div class="vide-petit"><p class="attenue">Les commandes de la boutique arrivent ici en direct.</p><a class="btn btn-doux btn-s" href={adresseBoutique('/')} target="_blank" rel="noopener"><Icone n="oeil" />Passer une commande test</a></div>}
            </section>
          </div>
          <div class="pile-l">
            <section class="carte">
              <h2 class="carte-titre"><Icone n="coche" />À faire</h2>
              {nPrep || nLiv || faibles.length || nPoints ? (
                <div class="a-faire">
                  {nPoints ? <a href={lien('/commandes?f=points')}><span class="af-n ton-danger">{nPoints}</span><b>Commande{nPoints > 1 ? 's' : ''} payée{nPoints > 1 ? 's' : ''} avec un point à vérifier</b><Icone n="droite" /></a> : null}
                  {nPrep ? <a href={lien('/commandes?f=preparer')}><span class="af-n ton-info">{nPrep}</span><b>Commande{nPrep > 1 ? 's' : ''} à préparer</b><Icone n="droite" /></a> : null}
                  {nLiv ? <a href={lien('/commandes?f=expediees')}><span class="af-n ton-marque">{nLiv}</span><b>Commande{nLiv > 1 ? 's' : ''} en route à livrer</b><Icone n="droite" /></a> : null}
                  {faibles.length ? <a href={lien('/produits?f=faible')}><span class="af-n ton-danger">{faibles.length}</span><b>Produit{faibles.length > 1 ? 's' : ''} en stock faible</b><Icone n="droite" /></a> : null}
                </div>
              ) : <Note ton="ok" icone="coche">Rien en attente : tout est à jour.</Note>}
              {nPaiement ? <p class="discret petit espace-haut"><a class="lien" href={lien('/commandes?f=paiement')}>{pluriel(nPaiement, 'paiement en cours', 'paiements en cours')}</a> : le client valide sur son téléphone, rien à faire.</p> : null}
            </section>
            <section class="carte">
              <h2 class="carte-titre"><Icone n="etoile" />Meilleures ventes<span class="fin">{lib}</span></h2>
              {meilleurs.length ? <div class="liste sans-bord">{meilleurs.map((t) => (
                <a key={t.id} class="ligne" href={lien('/produits/' + t.id)}>
                  <span class="ligne-vignette"><Photo m={t.image} alt="" tailles="48px" /></span>
                  <span class="ligne-texte"><b>{t.titre}</b><small>{pluriel(t.qte, 'vendu')}</small></span>
                  <span class="ligne-fin"><b>{dollars(t.ca)}</b></span>
                </a>
              ))}</div> : <p class="attenue petit">Vos articles les plus vendus sur la période apparaîtront ici.</p>}
            </section>
            {faits < guide.length ? (
              <section class="carte">
                <h2 class="carte-titre"><Icone n="drapeau" />Bien démarrer<span class="fin">{faits} sur {guide.length}</span></h2>
                <div class="jauge" aria-hidden="true"><i style={{ width: Math.round((faits / guide.length) * 100) + '%' }} /></div>
                <ul class="guide">
                  {guide.map((g, i) => {
                    const contenu = <><span class={classes('guide-coche', g.fait && 'fait')}>{g.fait ? <Icone n="coche" /> : null}</span><span>{g.texte}</span>{g.fait ? null : <Icone n="droite" />}</>;
                    return <li key={i}>{g.href ? <a href={lien(g.href)} class={g.fait ? 'fait' : ''}>{contenu}</a> : <a href={adresseBoutique('/')} target="_blank" rel="noopener" class={g.fait ? 'fait' : ''}>{contenu}</a>}</li>;
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

export function LigneCommandeCourte({ o }) {
  const sp = statutPaiement(o), sf = statutPreparation(o);
  return (
    <a class="ligne" href={lien('/commandes/' + o.id)}>
      <span class="ligne-vignette ronde" aria-hidden="true">{((o.customer && o.customer.name) || '?')[0].toUpperCase()}</span>
      <span class="ligne-texte"><b>{(o.customer && o.customer.name) || 'Client'}</b><small><span class="code">#{o.number}</span> · {ilya(o.createdAt)} · {pluriel((o.items || []).reduce((a, i) => a + R.int(i.qty), 0), 'article')}</small>
        <span class="ligne-pastilles"><Pastille ton={sp.ton} point>{sp.label}</Pastille>{sf && R.estPayee(o) ? <Pastille ton={sf.ton}>{sf.label}</Pastille> : null}</span></span>
      <span class="ligne-fin"><b>{dollars(o.total)}</b></span>
    </a>
  );
}

export const Chargement = () => <div class="chargement-admin" aria-busy="true"><div class="squelette" style={{ height: 120 }} /><div class="squelette" style={{ height: 260 }} /></div>;
export const estPret = () => pret.value;
