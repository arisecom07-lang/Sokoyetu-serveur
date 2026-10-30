// Sokoyetu (administration) — historique des commandes confirmées (paiement reçu), mois par mois, avec export pour la comptabilité.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Vide, Pastille, Segment, toast, useParPage, AfficherPlus } from '../../commun/js/interface.jsx';
import { dollars, dateHeure, pluriel, telephone, normaliser, date } from '../../commun/js/outils.js';
import { Local } from '../../commun/js/stockage.js';
import { lien } from '../routeur.js';
import { cfg, commandes, pret } from '../etat.js';
import { TetePage, Kpi } from '../composants/cadre.jsx';
import { Chargement } from './accueil.jsx';
import { statutPaiement, statutPreparation } from './commandes.jsx';

/* Confirmée = l'opérateur a validé le paiement (y compris si elle a été annulée et remboursée ensuite). */
export const estConfirmee = (o) => R.estPayee(o) || (!!o.payment && o.payment.status === 'refunded');
const estVente = (o) => o.status !== 'cancelled' && R.estPayee(o);
const quand = (o) => (o.payment && o.payment.paidAt) || o.createdAt || 0;
const nbArticles = (o) => (o.items || []).reduce((a, i) => a + R.int(i.qty), 0);

function debutPeriode(p) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (p === 'mois') { d.setDate(1); return d.getTime(); }
  if (p === '3mois') { d.setDate(1); d.setMonth(d.getMonth() - 2); return d.getTime(); }
  if (p === 'annee') { d.setMonth(0, 1); return d.getTime(); }
  return 0;
}
const PERIODES = [['mois', 'Ce mois'], ['3mois', '3 mois'], ['annee', 'Cette année'], ['tout', 'Tout']];
const ETATS = [
  ['toutes', 'Toutes', () => true],
  ['cours', 'En cours', (o) => o.status === 'open' && o.fulfillment !== 'delivered'],
  ['livrees', 'Livrées', (o) => o.status !== 'cancelled' && o.fulfillment === 'delivered'],
  ['annulees', 'Annulées', (o) => o.status === 'cancelled']
];

/* Une ligne par commande, séparateur « ; » et BOM : s'ouvre tel quel dans Excel ou Google Sheets en français. */
function exporter(liste, nom) {
  const cellule = (v) => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const montant = (v) => R.num(v).toFixed(2).replace('.', ',');
  const lignes = [['Numéro', 'Payée le', 'Client', 'Téléphone', 'Zone', 'Articles', 'Sous-total', 'Remise', 'Livraison', 'Frais de service', 'Total', 'Paiement', 'Transaction', 'Statut']];
  liste.forEach((o) => {
    const sf = statutPreparation(o);
    lignes.push([
      o.number, new Date(quand(o)).toLocaleString('fr-FR'), o.customer && o.customer.name, telephone(o.customer && o.customer.phone), o.shipping && o.shipping.zoneName,
      (o.items || []).map((i) => `${i.title}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(' / ')})` : ''} × ${i.qty}`).join(' | '),
      montant(o.subtotal), o.discount ? montant(o.discount.amount) : '', montant(o.shippingFee), montant(o.serviceFee), montant(o.total),
      o.payment && o.payment.label, o.payment && o.payment.reference, o.status === 'cancelled' ? statutPaiement(o).label : sf ? sf.label : 'Payée'
    ]);
  });
  const blob = new Blob(['﻿' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${pluriel(liste.length, 'commande exportée', 'commandes exportées')}`, { icone: 'telecharger' });
}

function LigneHistorique({ o }) {
  const sp = statutPaiement(o), sf = statutPreparation(o);
  const resume = (o.items || []).map((i) => i.title).join(', ');
  return (
    <a class="ligne" href={lien('/commandes/' + o.id)}>
      <span class="ligne-vignette ronde" aria-hidden="true">{((o.customer && o.customer.name) || '?')[0].toUpperCase()}</span>
      <span class="ligne-texte"><b>{(o.customer && o.customer.name) || 'Client'}</b><small><span class="code">#{o.number}</span> · {dateHeure(quand(o))} · {pluriel(nbArticles(o), 'article')}</small>
        {resume ? <small>{resume}</small> : null}
        {o.status === 'cancelled' || sf ? <span class="ligne-pastilles">{o.status === 'cancelled' ? <Pastille ton={sp.ton} point>{sp.label}</Pastille> : <Pastille ton={sf.ton}>{sf.label}</Pastille>}</span> : null}</span>
      <span class="ligne-fin"><b class={o.status === 'cancelled' ? 'montant-annule' : undefined}>{dollars(o.total)}</b><small>{o.payment && o.payment.label}</small></span>
    </a>
  );
}

export function Historique() {
  const [periode, setPeriode] = useState(Local.lire('periodeHistorique', 'tout'));
  const [etat, setEtat] = useState('toutes');
  const [q, setQ] = useState('');
  const changer = (p) => { setPeriode(p); Local.ecrire('periodeHistorique', p); };
  const debut = debutPeriode(periode);
  const confirmees = commandes.value.filter(estConfirmee).sort((a, b) => quand(b) - quand(a));
  const dansPeriode = confirmees.filter((o) => quand(o) >= debut);
  const fn = (ETATS.find((x) => x[0] === etat) || ETATS[0])[2];
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const liste = dansPeriode.filter(fn).filter((o) => !mots.length || mots.every((m) => normaliser([o.number, o.customer && o.customer.name, o.phone, o.customer && o.customer.phone, o.payment && o.payment.reference, (o.items || []).map((i) => i.title).join(' ')].join(' ')).includes(m)));

  const ventes = dansPeriode.filter(estVente);
  const encaisse = ventes.reduce((a, o) => a + R.num(o.total), 0);
  const frais = ventes.reduce((a, o) => a + R.num(o.serviceFee), 0);
  const articles = ventes.reduce((a, o) => a + nbArticles(o), 0);

  // Regroupement par mois du paiement : « octobre 2026 · 12 commandes · 1 240,00 $ ».
  const mois = [];
  liste.forEach((o) => {
    const d = new Date(quand(o)); const cle = d.getFullYear() * 100 + d.getMonth();
    let m = mois[mois.length - 1];
    if (!m || m.cle !== cle) { m = { cle, titre: date(d, { month: 'long', year: 'numeric' }), l: [], total: 0 }; mois.push(m); }
    m.l.push(o); if (estVente(o)) m.total += R.num(o.total);
  });
  // Affichage par pages : les totaux des mois restent ceux de toute la liste.
  const page = useParPage(liste, 60, periode + '|' + etat + '|' + q);
  let budget = page.n;
  const affiches = [];
  for (const m of mois) { if (budget <= 0) break; affiches.push({ ...m, visibles: m.l.slice(0, budget) }); budget -= m.l.length; }
  const nomFichier = `commandes-${R.slug(cfg.value.name || 'sokoyetu')}-${periode}-${new Date().toISOString().slice(0, 10)}.csv`;

  return (
    <>
      <TetePage titre="Historique des commandes" sous="Toutes les commandes dont le paiement a été confirmé" parent="/commandes"
        actions={liste.length ? <button class="btn btn-secondaire btn-s" onClick={() => exporter(liste, nomFichier)}><Icone n="telecharger" />Exporter (Excel)</button> : null} />
      {!pret.value ? <Chargement /> : (
        <div class="pile-l">
          <Segment libelle="Période" plein options={PERIODES} valeur={periode} onChange={changer} />
          <div class="kpis">
            <Kpi grand libelle="Encaissé" icone="portefeuille" valeur={dollars(encaisse)} sous={frais ? `dont ${dollars(frais)} de frais de service` : 'commandes payées, hors annulées'} />
            <Kpi libelle="Commandes confirmées" icone="recu" valeur={String(ventes.length)} sous={dansPeriode.length - ventes.length ? `+ ${dansPeriode.length - ventes.length} annulée(s) après paiement` : ''} />
            <Kpi libelle="Articles vendus" icone="colis" valeur={String(articles)} />
            <Kpi libelle="Panier moyen" icone="sac" valeur={dollars(ventes.length ? encaisse / ventes.length : 0)} />
          </div>
          <div class="outils-liste">
            <label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nom, téléphone, n°, transaction ou article" aria-label="Rechercher dans l’historique" /></label>
            <div class="puces" role="group" aria-label="Filtrer l’historique">
              {ETATS.map(([k, t, f]) => { const n = dansPeriode.filter(f).length; return <button key={k} class="puce" aria-pressed={etat === k ? 'true' : 'false'} onClick={() => setEtat(k)}>{t}{k !== 'toutes' && n ? <span class="n">{n}</span> : null}</button>; })}
            </div>
          </div>
          {mois.length ? <>{affiches.map((m) => (
            <section key={m.cle} class="historique-mois" aria-label={m.titre}>
              <h2 class="historique-mois-tete"><span>{m.titre}</span><small>{pluriel(m.l.length, 'commande')} · <b class="num">{dollars(m.total)}</b></small></h2>
              <div class="liste">{m.visibles.map((o) => <LigneHistorique key={o.id} o={o} />)}</div>
            </section>
          ))}<AfficherPlus page={page} total={liste.length} libelle="commande" /></> : <div class="carte"><Vide icone="recu" titre={confirmees.length ? 'Aucune commande ici' : 'Pas encore de commande confirmée'} texte={confirmees.length ? 'Changez de période, de filtre ou de recherche.' : 'Dès qu’un client a payé, sa commande est rangée ici pour toujours, avec son reçu.'} /></div>}
        </div>
      )}
    </>
  );
}
