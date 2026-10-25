// Sokoyetu (administration) — commandes : liste et suivi d'une commande (les étapes sont exécutées par le serveur).
import { useEffect, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Note, Vide, Pastille, toast, confirmer } from '../../commun/js/interface.jsx';
import { dollars, dateHeure, ilya, pluriel, telephone, lienWhatsApp, lienAppel, copier, classes, normaliser, date } from '../../commun/js/outils.js';
import { lien, route, aller } from '../routeur.js';
import { cfg, commandes, produitsParId, pret, etapeCommande, gererErreur } from '../etat.js';
import { TetePage, adresseBoutique } from '../composants/cadre.jsx';
import { LigneCommandeCourte, Chargement } from './accueil.jsx';

export function statutPaiement(o) {
  if (R.nonAboutie(o)) return { label: 'Non aboutie', ton: 'neutre' };
  if (o.status === 'cancelled') return o.payment && o.payment.status === 'refunded' ? { label: 'Remboursée', ton: 'neutre' } : { label: 'Annulée', ton: 'danger' };
  if (R.estPayee(o)) return { label: 'Payée', ton: 'ok' };
  if (o.payment && o.payment.status === 'failed') return { label: 'Paiement refusé', ton: 'danger' };
  return { label: 'Paiement en cours', ton: 'alerte' };
}
const FOURNISSEURS = { flexpay: 'FlexPay', simulation: 'Mode test (aucun argent)' };
const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export function statutPreparation(o) {
  if (o.status === 'cancelled') return null;
  const r = R.estRetraitCmd(o);
  return ({ unfulfilled: { label: 'À préparer', ton: 'neutre' }, preparing: { label: 'En préparation', ton: 'info' }, shipped: { label: r ? 'Prête au retrait' : 'En route', ton: 'info' }, delivered: { label: r ? 'Retirée' : 'Livrée', ton: 'ok' } })[o.fulfillment || 'unfulfilled'] || null;
}
// Commande payée avec une remarque du serveur (paiement arrivé après l'annulation automatique…), pas encore préparée.
export const avecPoints = (o) => o.status === 'open' && R.estPayee(o) && Array.isArray(o.issues) && o.issues.length > 0 && (!o.fulfillment || o.fulfillment === 'unfulfilled');

const FILTRES = [
  ['toutes', 'Toutes', () => true], ['points', 'Points à vérifier', avecPoints], ['preparer', 'À préparer', R.aPreparer],
  ['expediees', 'En route', R.aExpedier], ['livrees', 'Livrées', (o) => o.status !== 'cancelled' && o.fulfillment === 'delivered'],
  ['paiement', 'Paiement en cours', R.enAttentePaiement], ['nonabouties', 'Non abouties', R.nonAboutie], ['annulees', 'Annulées', (o) => o.status === 'cancelled' && !R.nonAboutie(o)]
];

export function Commandes() {
  const f0 = route.value.query.get('f') || 'toutes';
  const [filtre, setFiltre] = useState(FILTRES.some((x) => x[0] === f0) ? f0 : 'toutes');
  const [q, setQ] = useState('');
  useEffect(() => { const f = route.value.query.get('f'); if (f) setFiltre(f); }, [route.value.cle]);
  const os = commandes.value;
  const fn = (FILTRES.find((x) => x[0] === filtre) || FILTRES[0])[2];
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const liste = os.filter(fn).filter((o) => !mots.length || mots.every((m) => normaliser([o.number, o.customer && o.customer.name, o.phone, o.customer && o.customer.phone, o.payment && o.payment.phone, o.payment && o.payment.reference, o.payment && o.payment.ref].join(' ')).includes(m)));
  const aTraiter = os.filter(R.aTraiter).length;
  return (
    <>
      <TetePage titre="Commandes" sous={`${pluriel(os.length, 'commande')}${aTraiter ? ` · ${aTraiter} à traiter` : ''}`} />
      <div class="outils-liste">
        <label class="recherche-liste"><Icone n="recherche" /><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Nom, téléphone, n° ou transaction" aria-label="Rechercher une commande" /></label>
        <div class="puces" role="group" aria-label="Filtrer les commandes">
          {FILTRES.map(([k, t, f]) => { const n = os.filter(f).length; if (k === 'points' && !n) return null; return <button key={k} class="puce" aria-pressed={filtre === k ? 'true' : 'false'} onClick={() => setFiltre(k)}>{t}{k !== 'toutes' && n ? <span class="n">{n}</span> : null}</button>; })}
        </div>
      </div>
      {!pret.value ? <Chargement /> : liste.length ? <div class="liste">{liste.map((o) => <LigneCommandeCourte key={o.id} o={o} />)}</div>
        : <div class="carte"><Vide icone="recu" titre={os.length ? 'Aucune commande ici' : 'Pas encore de commande'} texte={os.length ? 'Changez de filtre ou de recherche.' : 'Les commandes de la boutique arrivent ici en direct, avec une alerte dès que le client a payé.'}>{os.length ? null : <a class="btn btn-primaire" href={adresseBoutique('/')} target="_blank" rel="noopener">Passer une commande test</a>}</Vide></div>}
    </>
  );
}

function messageClient(o) {
  const n = String((o.customer && o.customer.name) || '').split(/\s+/)[0]; const c = cfg.value;
  if (o.status === 'cancelled') return `Bonjour ${n}, votre commande #${o.number} chez ${c.name} a été annulée${o.payment && o.payment.status === 'refunded' ? ' et remboursée' : ''}. N’hésitez pas à nous écrire pour toute question.`;
  if (o.fulfillment === 'delivered') return `Bonjour ${n}, merci pour votre achat chez ${c.name} ! Votre commande #${o.number} est bien remise. À très vite.`;
  if (o.fulfillment === 'shipped') return R.estRetraitCmd(o) ? `Bonjour ${n}, votre commande #${o.number} est prête : vous pouvez venir la retirer à la boutique.` : `Bonjour ${n}, votre commande #${o.number} est en route (${o.shipping && o.shipping.zoneName}). Le livreur vous appellera.`;
  if (o.fulfillment === 'preparing') return `Bonjour ${n}, nous préparons votre commande #${o.number}. Nous vous prévenons dès son départ.`;
  return `Bonjour ${n}, merci pour votre commande #${o.number} chez ${c.name} : votre paiement de ${dollars(o.total)} est bien reçu. Nous vous prévenons dès son départ.`;
}
function messageLivreur(o) {
  const s = o.shipping || {};
  return `Livraison ${cfg.value.name} · commande #${o.number}\n${(o.items || []).map((i) => `• ${i.title}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(' / ')})` : ''} × ${i.qty}`).join('\n')}\nClient : ${o.customer.name} · ${telephone(o.customer.phone)}\nZone : ${s.zoneName}${s.address ? `\nAdresse : ${s.address}` : ''}${s.landmark ? `\nRepère : ${s.landmark}` : ''}${o.note ? `\nNote : ${o.note}` : ''}\nDéjà payé : ne rien encaisser.`;
}

export function Commande() {
  const id = route.value.segs[1]; const o = commandes.value.find((x) => x.id === id);
  const [occupe, setOccupe] = useState('');
  const [note, setNote] = useState(null);
  if (!pret.value) return <Chargement />;
  if (!o) return <><TetePage titre="Commande" parent="/commandes" /><div class="carte"><Vide icone="recu" titre="Commande introuvable" texte="Elle a peut-être été effacée." /></div></>;
  const sp = statutPaiement(o), sf = statutPreparation(o); const retrait = R.estRetraitCmd(o);
  const m = R.margeCommande(o); const points = R.incoherences(o);
  const nb = commandes.value.filter((x) => x.phone && x.phone === o.phone).length;
  // Pas de message au client tant que la commande n'est pas payée : le paiement se fait seul, dans la boutique.
  const wa = R.estPayee(o) || o.payment.status === 'refunded' ? lienWhatsApp(o.customer && o.customer.phone, messageClient(o)) : '';
  const agir = async (action, extra) => {
    if (action === 'cancel' && !(await confirmer({ titre: `Annuler la commande #${o.number} ?`, texte: R.estPayee(o) ? 'Les articles retournent en stock. Le client a payé : remboursez-le sur son numéro Mobile Money, puis notez-le ici.' : 'Les articles retournent en stock. Si le client valide le paiement malgré tout, la commande se rouvrira avec un point à vérifier.', ok: 'Annuler la commande', annuler: 'Garder', danger: true }))) return;
    if (action === 'paid' && !(await confirmer({ titre: 'Marquer comme payée à la main ?', texte: `Seulement si vous avez reçu ${dollars(o.total)} en dehors de l’application : vérifiez d’abord dans votre compte ${o.payment.label}. D’habitude, la commande se confirme toute seule dès que l’opérateur valide le paiement.`, ok: 'Oui, j’ai reçu l’argent', annuler: 'Retour' }))) return;
    setOccupe(action);
    try {
      await etapeCommande(o.id, action, extra);
      toast({ paid: 'Paiement confirmé', preparing: 'Préparation commencée', shipped: retrait ? 'Prête au retrait' : 'Marquée comme expédiée', delivered: retrait ? 'Marquée comme retirée' : 'Marquée comme livrée', cancel: 'Commande annulée', reopen: 'Commande rouverte', refund: 'Remboursement noté', note: 'Note enregistrée' }[action]);
      if (action === 'note') setNote(null);
    } catch (e) { gererErreur(e); }
    setOccupe('');
  };
  const bouton = (action, icone, children, secondaire) => <button class={classes('btn', secondaire ? 'btn-secondaire' : 'btn-primaire', occupe === action && 'charge')} disabled={!!occupe} onClick={() => agir(action)}><Icone n={icone} />{children}</button>;

  let suite;
  if (R.nonAboutie(o)) suite = <Note ton="info" icone="horloge">Le client n’a pas payé dans le délai : commande annulée automatiquement{o.cancelledAt ? ` le ${dateHeure(o.cancelledAt)}` : ''}, articles remis en stock. Rien à faire.</Note>;
  else if (o.status === 'cancelled') suite = (
    <><Note ton="danger" icone="alerte">Commande annulée{o.cancelledAt ? ` le ${dateHeure(o.cancelledAt)}` : ''}{o.stockApplied === false && (o.reserved || []).length ? ', articles remis en stock' : ''}.{R.estPayee(o) ? ' Le paiement avait été reçu : remboursez le client puis notez-le.' : ''}</Note>
      <div class="rangee-l espace-haut">{R.estPayee(o) ? bouton('refund', 'echange', 'Remboursement effectué', false) : null}{bouton('reopen', "actualiser", 'Rouvrir la commande', true)}</div></>
  );
  else if (R.enAttentePaiement(o)) suite = (
    <>{o.payment.status === 'failed'
      ? <Note ton="danger" icone="alerte">Dernière tentative refusée : {String(o.payment.error || 'paiement annulé').replace(/\.+$/, '')}. Le client peut réessayer depuis la boutique{o.expiresAt ? ` jusqu’à ${heure(o.expiresAt)}` : ''}.</Note>
      : <Note ton="alerte" icone="mobile">Le client valide le paiement <b>{o.payment.label}</b> de <b>{dollars(o.total)}</b> sur son téléphone. La commande se confirme toute seule dès que l’opérateur valide{o.expiresAt ? <>, sinon elle s’annule à <b>{heure(o.expiresAt)}</b></> : null}.</Note>}
      <div class="rangee-l espace-haut">{bouton('paid', 'coche', 'Marquer comme payée à la main', true)}</div></>
  );
  else if (!o.fulfillment || o.fulfillment === 'unfulfilled') suite = <><p class="attenue">Payée. Préparez les articles ci-dessous.</p><div class="rangee-l espace-haut">{bouton('preparing', "colis", 'Commencer la préparation', false)}{bouton('shipped', retrait ? 'boutique' : 'camion', retrait ? 'Prête au retrait' : 'Expédier directement', true)}</div></>;
  else if (o.fulfillment === 'preparing') suite = <><p class="attenue">{retrait ? 'Quand le colis est prêt, prévenez le client.' : 'Quand le colis part, marquez-le comme expédié.'}</p><div class="rangee-l espace-haut">{bouton('shipped', retrait ? 'boutique' : 'camion', retrait ? 'Prête au retrait' : 'Marquer comme expédiée', false)}</div></>;
  else if (o.fulfillment === 'shipped') suite = <><p class="attenue">{retrait ? 'En attente du passage du client.' : 'En route vers le client.'}</p><div class="rangee-l espace-haut">{bouton('delivered', "coche", retrait ? 'Retirée par le client' : 'Marquer comme livrée', false)}</div></>;
  else suite = <Note ton="ok" icone="coche">Commande terminée{o.deliveredAt ? ` le ${dateHeure(o.deliveredAt)}` : ''}.</Note>;

  const noteActuelle = note === null ? (o.adminNote || '') : note;
  return (
    <>
      <TetePage titre={`Commande #${o.number}`} sous={`${dateHeure(o.createdAt)} · ${o.customer && o.customer.name}`} parent="/commandes"
        actions={<div class="rangee"><Pastille ton={sp.ton} point>{sp.label}</Pastille>{sf && R.estPayee(o) ? <Pastille ton={sf.ton}>{sf.label}</Pastille> : null}</div>} />
      <div class="detail-grille">
        <div class="pile-l">
          {points.length && o.status !== 'cancelled' ? <Note ton="danger" icone="alerte"><b>Points à vérifier</b><ul class="points">{points.map((p, i) => <li key={i}>{p}</li>)}</ul></Note> : null}
          <section class="carte">
            <h2 class="carte-titre"><Icone n="drapeau" />Prochaine étape</h2>
            {suite}
            <div class="rangee-l espace-haut separe">
              {wa ? <a class="btn btn-doux btn-s" href={wa} target="_blank" rel="noopener"><Icone n="bulle" />Prévenir le client sur WhatsApp</a> : null}
              {o.status !== 'cancelled' && o.fulfillment !== 'delivered' ? <button class="btn btn-fantome btn-s" disabled={!!occupe} onClick={() => agir('cancel')}><Icone n="fermer" />Annuler la commande</button> : null}
            </div>
          </section>
          <section class="carte">
            <h2 class="carte-titre"><Icone n="colis" />Articles<span class="fin">{pluriel((o.items || []).reduce((a, i) => a + R.int(i.qty), 0), 'article')}</span></h2>
            <ul class="articles-cmd">
              {(o.items || []).map((i, k) => {
                const p = produitsParId.value.get(i.productId);
                return (
                  <li key={k}>
                    <span class="ac-photo"><Photo m={i.image || R.imagePrincipale(p || {})} alt="" tailles="64px" /></span>
                    <span class="ac-texte">{p ? <a class="gras" href={lien('/produits/' + p.id)}>{i.title}</a> : <b>{i.title}</b>}<small>{[i.color, i.size].filter(Boolean).join(' · ') || 'Article unique'} · {i.qty} × {dollars(i.price)}</small>
                      <span class="rangee-l">{i.source === 'import' ? <Pastille ton="info" icone="avion">Import Chine</Pastille> : null}{i.issue ? <Pastille ton="danger" icone="alerte">{i.issue === 'stock' ? 'Stock insuffisant' : i.issue === 'option' ? 'Option invalide' : 'Plus en vente'}</Pastille> : null}</span></span>
                    <span class="ac-prix num">{dollars(i.qty * i.price)}</span>
                  </li>
                );
              })}
            </ul>
            <dl class="montants espace-haut">
              <div><dt>Sous-total</dt><dd class="num">{dollars(o.subtotal)}</dd></div>
              {o.discount ? <div><dt>Code {o.discount.code}</dt><dd class="moins num">−{dollars(o.discount.amount)}</dd></div> : null}
              <div><dt>Livraison · {o.shipping && o.shipping.zoneName}</dt><dd class="num">{o.shippingFee ? dollars(o.shippingFee) : 'Gratuite'}</dd></div>
              {o.serviceFee ? <div><dt>Frais de service ({R.num(o.serviceFeePct)} %)</dt><dd class="num">{dollars(o.serviceFee)}</dd></div> : null}
              <div class="total"><dt class="lib">{R.estPayee(o) ? 'Total payé' : 'Total'}</dt><dd class="num">{dollars(o.total)}</dd></div>
              {m.couts ? <div><dt>Marge estimée (frais de service compris, hors livraison){m.connue ? '' : ' · coûts incomplets'}</dt><dd class="num" style={{ color: m.marge >= 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 750 }}>{dollars(m.marge)}</dd></div> : null}
            </dl>
          </section>
          <section class="carte">
            <h2 class="carte-titre"><Icone n="horloge" />Historique</h2>
            <div class="historique">{[...(o.timeline || [])].reverse().map((e, i) => <div key={i}><span>{e.text}<small>{dateHeure(e.at)}</small></span></div>)}</div>
          </section>
        </div>
        <div class="pile-l">
          <section class="carte">
            <h2 class="carte-titre"><Icone n="portefeuille" />Paiement</h2>
            <dl class="infos">
              <dt>Mode</dt><dd>{o.payment.label}{o.payment.phone ? ` · ${telephone(o.payment.phone)}` : ''}</dd>
              {o.payment.provider ? <><dt>Service</dt><dd>{FOURNISSEURS[o.payment.provider] || o.payment.provider}</dd></> : null}
              {o.payment.reference ? <><dt>Transaction</dt><dd><span class="code">{o.payment.reference}</span> <button class="btn-icone mini" aria-label="Copier la référence" onClick={async () => { if (await copier(o.payment.reference)) toast('Référence copiée'); }}><Icone n="copier" /></button></dd></> : null}
              {o.payment.ref ? <><dt>Code client</dt><dd><span class="code">{o.payment.ref}</span></dd></> : null}
              <dt>Montant</dt><dd>{dollars(o.total)}{o.serviceFee ? <small class="discret"> dont {dollars(o.serviceFee)} de frais</small> : null}</dd>
              {R.int(o.payment.attempts) > 1 ? <><dt>Tentatives</dt><dd>{o.payment.attempts}</dd></> : null}
              <dt>Statut</dt><dd>{o.payment.status === 'paid' ? `Payé${o.payment.paidAt ? ' le ' + dateHeure(o.payment.paidAt) : ''}${o.payment.manual ? ' (confirmé à la main)' : ''}` : o.payment.status === 'refunded' ? 'Remboursé' : o.payment.status === 'expired' ? 'Jamais reçu' : o.payment.status === 'failed' ? 'Refusé' : 'En attente du client'}</dd>
            </dl>
          </section>
          <section class="carte">
            <h2 class="carte-titre"><Icone n="personne" />Client</h2>
            <dl class="infos"><dt>Nom</dt><dd>{o.customer.name}</dd><dt>Téléphone</dt><dd>{telephone(o.customer.phone) || '—'}</dd><dt>Commandes</dt><dd>{nb}</dd></dl>
            {o.customer.phone ? (
              <div class="rangee-l espace-haut">
                <a class="btn btn-secondaire btn-s" href={lienAppel(o.customer.phone)}><Icone n="appel" />Appeler</a>
                <a class="btn btn-secondaire btn-s" href={lienWhatsApp(o.customer.phone, '')} target="_blank" rel="noopener"><Icone n="bulle" />WhatsApp</a>
                <a class="btn btn-fantome btn-s" href={lien('/clients/' + o.phone)}>Fiche client</a>
              </div>
            ) : null}
          </section>
          <section class="carte">
            <h2 class="carte-titre"><Icone n="repere" />{retrait ? 'Retrait en boutique' : 'Livraison'}</h2>
            <dl class="infos"><dt>Zone</dt><dd>{o.shipping.zoneName}</dd>{o.shipping.address ? <><dt>Adresse</dt><dd>{o.shipping.address}</dd></> : null}{o.shipping.landmark ? <><dt>Repère</dt><dd>{o.shipping.landmark}</dd></> : null}</dl>
            {o.note ? <Note icone="bulle" classe="espace-haut"><b>Note du client :</b> {o.note}</Note> : null}
            {!retrait && o.status !== 'cancelled' && R.estPayee(o) ? <a class="btn btn-doux btn-s espace-haut" href={`https://wa.me/?text=${encodeURIComponent(messageLivreur(o))}`} target="_blank" rel="noopener"><Icone n="camion" />Envoyer au livreur</a> : null}
          </section>
          <section class="carte">
            <h2 class="carte-titre"><Icone n="crayon" />Note interne</h2>
            <textarea class="saisie" rows="3" value={noteActuelle} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Visible seulement dans l’administration" aria-label="Note interne" maxlength="1000" />
            {note !== null && note !== (o.adminNote || '') ? <button class={classes('btn btn-secondaire btn-s espace-haut', occupe === 'note' && 'charge')} onClick={() => agir('note', note)}>Enregistrer la note</button> : null}
          </section>
        </div>
      </div>
    </>
  );
}

export const ouvrirCommande = (id) => aller('/commandes/' + id);
