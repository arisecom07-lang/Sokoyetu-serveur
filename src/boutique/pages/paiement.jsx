// Sokoyetu (boutique) — paiement en cours : le client valide la demande sur son téléphone, la page suit l'état auprès du serveur.
// Payée → reçu. Refusée → nouvelle tentative (même commande). Délai dépassé → commande annulée, articles remis en vente.
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Etapes, LogoOperateur, Note, Vide, toast } from '../../commun/js/interface.jsx';
import { requete } from '../../commun/js/api.js';
import { dollars, francs, telephone, classes } from '../../commun/js/outils.js';
import { lien, naviguer, route } from '../routeur.js';
import { cfg, moyensPaiement, jetonDe, commandes, recevoirCommande, remettreAuPanier, enregistrerProfil } from '../etat.js';
import { EntetePage } from '../composants/cadre.jsx';
import { mesurerEvenement } from '../mesure.js';
import { NOMS_ETAPES, ChoixPaiement, NoteModeTest } from './commander.jsx';
import { useSeo } from './commun.jsx';

const RELANCE_APRES = (R.RELANCE_APRES_S + 5) * 1000; // le serveur accepte une nouvelle demande R.RELANCE_APRES_S secondes après la précédente

const minutes = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m <= 1 ? 'moins d’une minute' : `${m} min`; };

export function Paiement() {
  const id = route.value.params.id; const t = jetonDe(id);
  const ms = moyensPaiement.value; const c = cfg.value;
  const [etat, setEtat] = useState(() => { const o = commandes.value.get(id); return o ? { order: o, paiement: null } : null; });
  const [probleme, setProbleme] = useState('');   // '' | 'introuvable' | message de connexion
  const [maintenant, setMaintenant] = useState(Date.now());
  const [autre, setAutre] = useState(false);       // formulaire « autre numéro ou opérateur »
  const [relance, setRelance] = useState({ methode: '', tel: '', erreurs: {}, envoi: false });
  const [tour, setTour] = useState(0);              // relance la surveillance après une nouvelle demande
  const verrou = useRef(false);                     // deux appuis rapides : une seule nouvelle demande
  useSeo(() => ({ titre: 'Paiement en cours', noindex: true }), []);

  const o = etat && etat.order; const p = etat && etat.paiement;
  const enCours = !!o && R.enAttentePaiement(o);

  useEffect(() => {
    if (!t) { setProbleme('introuvable'); return undefined; }
    let fini = false; let minuteur = 0;
    const suivre = async () => {
      clearTimeout(minuteur);
      try {
        const r = await requete(`sokoyetu/paiement/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`);
        if (fini) return;
        setEtat(r); recevoirCommande(id, r.order); setProbleme('');
        if (r.paiement.etat === 'paid') {
          mesurerEvenement('purchase', { transaction_id: r.order.number, value: r.order.total, currency: 'USD', shipping: r.order.shippingFee });
          naviguer('/merci/' + id, { remplacer: true });
          return;
        }
        if (!R.enAttentePaiement(r.order)) return; // annulée : plus rien à attendre
        minuteur = setTimeout(suivre, document.hidden ? 10000 : r.paiement.etat === 'failed' ? 8000 : 3000);
      } catch (e) {
        if (fini) return;
        if (e.status === 404) { setProbleme('introuvable'); return; }
        setProbleme(e.message);
        minuteur = setTimeout(suivre, 5000);
      }
    };
    suivre();
    const retourSurLaPage = () => { if (!document.hidden && !fini) suivre(); };
    document.addEventListener('visibilitychange', retourSurLaPage);
    return () => { fini = true; clearTimeout(minuteur); document.removeEventListener('visibilitychange', retourSurLaPage); };
  }, [id, t, tour]);

  useEffect(() => {
    if (!enCours) return undefined;
    const h = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(h);
  }, [enCours]);

  // Formulaire de nouvelle tentative pré-rempli avec le dernier moyen utilisé.
  useEffect(() => { if (o && !relance.methode) setRelance((x) => ({ ...x, methode: o.payment.method, tel: '' })); }, [o && o.payment.method]);

  async function relancer(avecChoix) {
    if (relance.envoi || verrou.current) return;
    verrou.current = true;
    try { await relancerUneFois(avecChoix); } finally { verrou.current = false; }
  }
  async function relancerUneFois(avecChoix) {
    const moyen = ms.find((m) => m.k === (avecChoix ? relance.methode : o.payment.method));
    const tel = avecChoix ? (relance.tel.trim() || o.payment.phone) : o.payment.phone;
    if (avecChoix) {
      const e = {};
      if (!moyen) e.method = 'Choisissez votre opérateur Mobile Money.';
      else if (!R.valider.mobileMoney(tel)) e.payphone = `Numéro ${moyen.label} invalide : 10 chiffres, commençant par 08 ou 09.`;
      if (Object.keys(e).length) { setRelance((x) => ({ ...x, erreurs: e })); return; }
    }
    setRelance((x) => ({ ...x, envoi: true, erreurs: {} }));
    try {
      const r = await requete(`sokoyetu/paiement/${encodeURIComponent(id)}/relancer?t=${encodeURIComponent(t)}`, { method: 'POST', corps: { method: moyen ? moyen.k : '', phone: tel }, delai: 45000 });
      setEtat(r); recevoirCommande(id, r.order); setAutre(false);
      if (avecChoix && moyen) enregistrerProfil({ payMethod: moyen.k, payPhone: R.valider.mobileMoney(tel) });
      setRelance((x) => ({ ...x, envoi: false, tel: '' }));
      toast(r.paiement.etat === 'failed' ? 'La demande n’a pas pu partir' : 'Nouvelle demande envoyée : regardez votre téléphone', { icone: r.paiement.etat === 'failed' ? 'alerte' : 'mobile', ton: r.paiement.etat === 'failed' ? 'danger' : '' });
      setTour((n) => n + 1);
    } catch (e) {
      setRelance((x) => ({ ...x, envoi: false, erreurs: e.champ ? { [e.champ]: e.message } : {} }));
      if (!e.champ) toast(e.message, { icone: 'alerte', ton: 'danger', duree: 5000 });
    }
  }

  if (probleme === 'introuvable') {
    return (
      <>
        <EntetePage titre="Paiement" repli="/compte/commandes" />
        <main id="contenu" class="page conteneur">
          <Vide icone="recu" titre="Commande introuvable sur ce téléphone" texte="Si vous avez déjà payé, retrouvez votre commande avec le numéro de votre reçu et votre téléphone.">
            <a class="btn btn-primaire" href={lien('/compte/retrouver')}><Icone n="recherche" />Retrouver ma commande</a>
          </Vide>
        </main>
      </>
    );
  }
  if (!o) return <><EntetePage titre="Paiement" repli="/compte/commandes" /><main id="contenu" class="page conteneur"><div class="squelette" style={{ height: 360 }} /></main></>;

  const moyen = ms.find((m) => m.k === o.payment.method) || R.OPERATEURS[o.payment.method] || { label: o.payment.label, color: 'var(--ebene)', init: String(o.payment.label || 'M')[0] };
  const echec = o.payment.status === 'failed';
  const annulee = o.status === 'cancelled';
  const reste = Number(o.expiresAt) - maintenant;
  const depuis = maintenant - Number(o.payment.startedAt || 0);
  const peutRelancer = enCours && (!p || p.relance) && (echec || depuis > RELANCE_APRES);
  const test = (p && p.test) || o.payment.test;

  return (
    <>
      <EntetePage titre={'Commande #' + o.number} sous="Paiement Mobile Money" repli="/compte/commandes" />
      <main id="contenu" class="page conteneur page-paiement">
        <div class="commande-tete"><Etapes noms={NOMS_ETAPES} actuelle={2} /></div>
        <div class="pile-l paiement-corps">
          {test && enCours ? <NoteModeTest /> : null}

          {annulee ? (
            <section class="carte paiement-attente fin-paiement entree">
              <span class="paiement-icone danger" aria-hidden="true"><Icone n="horloge" /></span>
              <h1 class="titre-serif">{R.nonAboutie(o) ? 'Délai de paiement dépassé' : 'Commande annulée'}</h1>
              <p class="attenue">{R.nonAboutie(o) ? `Le paiement de la commande #${o.number} n’est pas arrivé à temps : elle est annulée et ses articles sont remis en vente.` : `La commande #${o.number} a été annulée.`}</p>
              <div class="pile espace-haut">
                <button class="btn btn-primaire btn-l btn-bloc" onClick={() => { const n = remettreAuPanier(o); toast(n ? 'Articles remis dans votre panier' : 'Ces articles ne sont plus en vente', { icone: n ? 'sac' : 'alerte' }); if (n) naviguer('/panier'); }}><Icone n="sac" />Remettre les articles dans mon panier</button>
                <a class="btn btn-fantome btn-bloc" href={lien('/')}>Retour à la boutique</a>
              </div>
            </section>
          ) : (
            <section class={classes('carte paiement-attente entree', echec && 'en-echec')} style={{ '--op': moyen.color }} aria-live="polite">
              {echec ? (
                <>
                  <LogoOperateur k={o.payment.method} m={moyen} taille={48} />
                  <h1 class="titre-serif">Paiement non abouti</h1>
                  <p class="attenue">{o.payment.error || 'Le paiement a été refusé ou annulé.'} Rien n’a été débité : vous pouvez réessayer.</p>
                </>
              ) : (
                <>
                  <span class="attente-onde" aria-hidden="true"><Icone n="mobile" /><LogoOperateur k={o.payment.method} m={moyen} taille={30} classe="attente-logo" /></span>
                  <h1 class="titre-serif">Validez le paiement sur votre téléphone</h1>
                  <p class="attenue">Une demande de <b>{dollars(o.total)}</b>{francs(o.total, c) ? ` (${francs(o.total, c)})` : ''} a été envoyée au <b>{telephone(o.payment.phone)}</b> ({o.payment.label}).</p>
                  <ol class="etapes-paiement gauche">
                    <li><span>1</span><p>Un message de {o.payment.label} s’affiche sur ce téléphone.</p></li>
                    <li><span>2</span><p>Vérifiez le montant : <b>{dollars(o.total)}</b>.</p></li>
                    <li><span>3</span><p>Saisissez votre code PIN pour confirmer.</p></li>
                  </ol>
                  <p class="discret petit centre"><span class="point-vivant" aria-hidden="true" />Cette page se met à jour toute seule dès que {o.payment.label} confirme.</p>
                </>
              )}
              {reste > 0 ? <p class="discret petit centre">Vos articles restent réservés encore {minutes(reste)}.</p> : null}
              {probleme ? <Note ton="alerte" icone="info" classe="espace-haut">{probleme} Nouvelle vérification dans un instant…</Note> : null}

              {peutRelancer && !autre ? (
                <div class="pile espace-haut">
                  {!echec ? <p class="petit centre"><b>Rien reçu ?</b> Vérifiez que le téléphone est allumé et a du réseau, puis renvoyez la demande.</p> : null}
                  <button class={classes('btn btn-primaire btn-l btn-bloc', relance.envoi && 'charge')} onClick={() => relancer(false)}><Icone n="actualiser" />{echec ? `Réessayer : ${dollars(o.total)}` : 'Renvoyer la demande'}</button>
                  <button class="btn btn-fantome btn-bloc" onClick={() => setAutre(true)}>Payer avec un autre numéro ou opérateur</button>
                </div>
              ) : null}
              {peutRelancer && autre ? (
                <div class="pile espace-haut gauche">
                  <ChoixPaiement ms={ms} methode={relance.methode} tel={relance.tel} erreurs={relance.erreurs} telContact={o.payment.phone}
                    onMethode={(k) => setRelance((x) => ({ ...x, methode: k, erreurs: {} }))} onTel={(v) => setRelance((x) => ({ ...x, tel: v, erreurs: {} }))} />
                  <button class={classes('btn btn-primaire btn-l btn-bloc', relance.envoi && 'charge')} onClick={() => relancer(true)}><Icone n="cadenas" />Payer {dollars(o.total)}</button>
                  <button class="btn btn-fantome btn-bloc" onClick={() => setAutre(false)}>Annuler</button>
                </div>
              ) : null}
              {enCours && p && !p.relance && echec ? <Note ton="danger" icone="alerte" classe="espace-haut">Trop de tentatives pour cette commande. Repassez votre commande depuis votre panier.</Note> : null}
            </section>
          )}

          <section class="carte">
            <h2 class="carte-titre"><Icone n="recu" />Commande #{o.number}</h2>
            <dl class="infos">
              <dt>Articles</dt><dd>{(o.items || []).map((i) => `${i.title}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ')}</dd>
              <dt>{R.estRetraitCmd(o) ? 'Retrait' : 'Livraison'}</dt><dd>{o.shipping.zoneName}{o.shipping.address ? ` · ${o.shipping.address}` : ''}</dd>
              <dt>À payer</dt><dd><b>{dollars(o.total)}</b>{o.serviceFee ? <small class="discret"> dont {dollars(o.serviceFee)} de frais de service</small> : null}</dd>
            </dl>
          </section>
          <Note ton="info" icone="bouclier">Vous validez vous-même le paiement sur votre téléphone. Personne de la boutique ne vous demandera votre code PIN.</Note>
        </div>
      </main>
    </>
  );
}
