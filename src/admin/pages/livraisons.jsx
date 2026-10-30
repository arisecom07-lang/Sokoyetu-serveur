// Sokoyetu (administration) — livraisons : ce que voit le livreur (commandes payées à livrer), « En route » puis « Livrée ».
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Note, Vide, Pastille, toast, confirmer } from '../../commun/js/interface.jsx';
import { dollars, dateHeure, pluriel, telephone, lienAppel, debutJour, classes } from '../../commun/js/outils.js';
import { cfg, commandes, pret, etapeCommande, gererErreur } from '../etat.js';
import { TetePage } from '../composants/cadre.jsx';
import { Chargement } from './accueil.jsx';
import { statutPreparation } from './commandes.jsx';

/* Itinéraire dans l'application de cartes du téléphone : adresse, repère et zone. */
const lienCarte = (o) => {
  const s = o.shipping || {};
  const q = [s.address, s.landmark, s.zoneName, cfg.value.city === s.zoneName ? '' : 'RDC'].filter(Boolean).join(', ');
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
};

function CarteLivraison({ o }) {
  const [occupe, setOccupe] = useState('');
  const s = o.shipping || {}; const sf = statutPreparation(o) || { label: '', ton: 'neutre' };
  const carte = lienCarte(o);
  const agir = async (action) => {
    if (action === 'delivered' && !(await confirmer({ titre: `Commande #${o.number} remise au client ?`, texte: `${o.customer.name} a bien reçu ses articles. Elle est déjà payée : ne rien encaisser.`, ok: 'Oui, livrée' }))) return;
    setOccupe(action);
    try { await etapeCommande(o.id, action); toast(action === 'delivered' ? `Commande #${o.number} livrée` : `Commande #${o.number} en route`); }
    catch (e) { gererErreur(e); }
    setOccupe('');
  };
  return (
    <li class="carte pile">
      <div class="entre"><b class="code">#{o.number}</b><Pastille ton={sf.ton} point>{sf.label}</Pastille></div>
      <dl class="infos">
        <dt>Client</dt><dd><b>{o.customer.name}</b>{o.customer.phone ? <> · <span class="sans-coupure">{telephone(o.customer.phone)}</span></> : null}</dd>
        <dt>Zone</dt><dd>{s.zoneName}</dd>
        {s.address ? <><dt>Adresse</dt><dd>{s.address}</dd></> : null}
        {s.landmark ? <><dt>Repère</dt><dd>{s.landmark}</dd></> : null}
        <dt>Articles</dt><dd>{(o.items || []).map((i) => `${i.title}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(' / ')})` : ''} × ${i.qty}`).join(', ')}</dd>
        {o.fulfillment === 'delivered' && o.deliveredAt ? <><dt>Livrée</dt><dd>{dateHeure(o.deliveredAt)}</dd></> : null}
      </dl>
      {o.note ? <Note icone="bulle"><b>Note du client :</b> {o.note}</Note> : null}
      {o.adminNote ? <Note icone="crayon"><b>Consigne de la boutique :</b> {o.adminNote}</Note> : null}
      <p class="note ton-ok petit"><Icone n="coche" /><span>Déjà payée ({dollars(o.total)}) : ne rien encaisser.</span></p>
      <div class="rangee-l">
        {o.customer.phone ? <a class="btn btn-secondaire btn-s" href={lienAppel(o.customer.phone)}><Icone n="appel" />Appeler</a> : null}
        {carte ? <a class="btn btn-secondaire btn-s" href={carte} target="_blank" rel="noopener"><Icone n="repere" />Itinéraire</a> : null}
        {o.fulfillment !== 'shipped' && o.fulfillment !== 'delivered' ? <button class={classes('btn btn-primaire btn-s', occupe === 'shipped' && 'charge')} disabled={!!occupe} onClick={() => agir('shipped')}><Icone n="camion" />Je pars livrer</button> : null}
        {o.fulfillment === 'shipped' ? <button class={classes('btn btn-primaire btn-s', occupe === 'delivered' && 'charge')} disabled={!!occupe} onClick={() => agir('delivered')}><Icone n="coche" />Livrée</button> : null}
      </div>
    </li>
  );
}

function Section({ titre, liste, vide }) {
  return (
    <section class="pile" aria-label={titre}>
      <h2 class="livraisons-tete"><span>{titre}</span><small>{pluriel(liste.length, 'commande')}</small></h2>
      {liste.length ? <ul class="pile">{liste.map((o) => <CarteLivraison key={o.id} o={o} />)}</ul> : <p class="attenue petit">{vide}</p>}
    </section>
  );
}

export function Livraisons() {
  if (!pret.value) return <Chargement />;
  const toutes = commandes.value.filter(R.pourLivreur);
  const enRoute = toutes.filter((o) => o.fulfillment === 'shipped');
  const aPrendre = toutes.filter((o) => o.fulfillment !== 'shipped' && o.fulfillment !== 'delivered').sort((a, b) => (a.payment.paidAt || 0) - (b.payment.paidAt || 0));
  const livrees = toutes.filter((o) => o.fulfillment === 'delivered' && (o.deliveredAt || 0) >= debutJour(Date.now()));
  const n = enRoute.length + aPrendre.length;
  return (
    <>
      <TetePage titre="Livraisons" sous={n ? `${pluriel(n, 'commande')} à livrer` : 'Rien à livrer pour le moment'} grand />
      {!toutes.length ? (
        <Vide icone="camion" titre="Aucune livraison" texte="Les commandes payées à livrer apparaissent ici dès que la boutique les reçoit." />
      ) : (
        <div class="pile-l formulaire-etroit">
          <Section titre="En route" liste={enRoute} vide="Aucune commande en route." />
          <Section titre="À livrer" liste={aPrendre} vide="Aucune commande en attente." />
          {livrees.length ? <Section titre="Livrées aujourd’hui" liste={livrees} vide="" /> : null}
        </div>
      )}
    </>
  );
}
