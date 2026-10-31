// Sokoyetu (boutique) — paiement en cours : le client valide la demande sur son téléphone (ou paie par carte sur la page
// sécurisée du fournisseur, qui le renvoie ici), la page suit l'état auprès du serveur.
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
import { NOMS_ETAPES, ChoixPaiement, NoteModeTest, allerVersCarte } from './commander.jsx';
import { useSeo } from './commun.jsx';
import { t, tx, traduireMessage } from '../../commun/js/langue.js';

const RELANCE_APRES = (R.RELANCE_APRES_S + 5) * 1000; // le serveur accepte une nouvelle demande R.RELANCE_APRES_S secondes après la précédente

const minutes = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m <= 1 ? t('moins d’une minute') : t('{0} min', [m]); };

export function Paiement() {
  const id = route.value.params.id; const jeton = jetonDe(id);
  // Retour de la page de paiement par carte : ok (payé, à vérifier), annule ou refuse.
  const retourCarte = route.value.query.get('carte') || '';
  const ms = moyensPaiement.value; const c = cfg.value;
  const [etat, setEtat] = useState(() => { const o = commandes.value.get(id); return o ? { order: o, paiement: null } : null; });
  const [probleme, setProbleme] = useState('');   // '' | 'introuvable' | message de connexion
  const [maintenant, setMaintenant] = useState(Date.now());
  const [autre, setAutre] = useState(false);       // formulaire « autre numéro ou opérateur »
  const [relance, setRelance] = useState({ methode: '', tel: '', erreurs: {}, envoi: false });
  const [tour, setTour] = useState(0);              // relance la surveillance après une nouvelle demande
  const verrou = useRef(false);                     // deux appuis rapides : une seule nouvelle demande
  useSeo(() => ({ titre: t('Paiement en cours'), noindex: true }), []);

  const o = etat && etat.order; const p = etat && etat.paiement;
  const enCours = !!o && R.enAttentePaiement(o);

  useEffect(() => {
    if (!jeton) { setProbleme('introuvable'); return undefined; }
    let fini = false; let minuteur = 0;
    const suivre = async () => {
      clearTimeout(minuteur);
      try {
        const r = await requete(`sokoyetu/paiement/${encodeURIComponent(id)}?t=${encodeURIComponent(jeton)}`);
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
  }, [id, jeton, tour]);

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
    const tel = moyen && moyen.carte ? '' : avecChoix ? (relance.tel.trim() || o.payment.phone) : o.payment.phone;
    if (avecChoix) {
      const e = {};
      if (!moyen) e.method = t('Choisissez votre moyen de paiement.');
      else if (!moyen.carte && !R.valider.mobileMoney(tel)) e.payphone = t('Numéro {0} invalide : 10 chiffres, commençant par 08 ou 09.', [moyen.label]);
      if (Object.keys(e).length) { setRelance((x) => ({ ...x, erreurs: e })); return; }
    }
    setRelance((x) => ({ ...x, envoi: true, erreurs: {} }));
    try {
      const r = await requete(`sokoyetu/paiement/${encodeURIComponent(id)}/relancer?t=${encodeURIComponent(jeton)}`, { method: 'POST', corps: { method: moyen ? moyen.k : '', phone: tel }, delai: 45000 });
      setEtat(r); recevoirCommande(id, r.order); setAutre(false);
      if (avecChoix && moyen) enregistrerProfil({ payMethod: moyen.k, ...(moyen.carte ? {} : { payPhone: R.valider.mobileMoney(tel) }) });
      setRelance((x) => ({ ...x, envoi: false, tel: '' }));
      // Carte : direction la page sécurisée.
      if (r.paiement.url) { allerVersCarte(id, r.paiement.url); return; }
      toast(r.paiement.etat === 'failed' ? t('La demande n’a pas pu partir') : t('Nouvelle demande envoyée : regardez votre téléphone'), { icone: r.paiement.etat === 'failed' ? 'alerte' : 'mobile', ton: r.paiement.etat === 'failed' ? 'danger' : '' });
      setTour((n) => n + 1);
    } catch (e) {
      setRelance((x) => ({ ...x, envoi: false, erreurs: e.champ ? { [e.champ]: e.message } : {} }));
      if (!e.champ) toast(e.message, { icone: 'alerte', ton: 'danger', duree: 5000 });
    }
  }

  if (probleme === 'introuvable') {
    return (
      <>
        <EntetePage titre={t('Paiement')} repli="/compte/commandes" />
        <main id="contenu" class="page conteneur">
          <Vide icone="recu" titre={t('Commande introuvable sur ce téléphone')} texte={t('Si vous avez déjà payé, retrouvez votre commande avec le numéro de votre reçu et votre téléphone.')}>
            <a class="btn btn-primaire" href={lien('/compte/retrouver')}><Icone n="recherche" />{t('Retrouver ma commande')}</a>
          </Vide>
        </main>
      </>
    );
  }
  if (!o) return <><EntetePage titre={t('Paiement')} repli="/compte/commandes" /><main id="contenu" class="page conteneur"><div class="squelette" style={{ height: 360 }} /></main></>;

  const moyen = ms.find((m) => m.k === o.payment.method) || R.OPERATEURS[o.payment.method] || { label: o.payment.label, color: 'var(--ebene)', init: String(o.payment.label || 'M')[0] };
  const echec = o.payment.status === 'failed';
  const annulee = o.status === 'cancelled';
  const reste = Number(o.expiresAt) - maintenant;
  const depuis = maintenant - Number(o.payment.startedAt || 0);
  const carte = R.estCarte(o.payment.method);
  // Carte : le client peut repartir tout de suite (rien n'arrive sur son téléphone).
  const peutRelancer = enCours && (!p || p.relance) && (echec || carte || depuis > RELANCE_APRES);
  const test = (p && p.test) || o.payment.test;
  const pageCarte = p && p.url;

  return (
    <>
      <EntetePage titre={t('Commande #{0}', [o.number])} sous={carte ? t('Paiement par carte') : t('Paiement Mobile Money')} repli="/compte/commandes" />
      <main id="contenu" class="page conteneur page-paiement">
        <div class="commande-tete"><Etapes noms={NOMS_ETAPES} actuelle={2} /></div>
        <div class="pile-l paiement-corps">
          {test && enCours ? <NoteModeTest carte={carte} /> : null}

          {annulee ? (
            <section class="carte paiement-attente fin-paiement entree">
              <span class="paiement-icone danger" aria-hidden="true"><Icone n="horloge" /></span>
              <h1 class="titre-serif">{R.nonAboutie(o) ? t('Délai de paiement dépassé') : t('Commande annulée')}</h1>
              <p class="attenue">{R.nonAboutie(o) ? t('Le paiement de la commande #{0} n’est pas arrivé à temps : elle est annulée et ses articles sont remis en vente.', [o.number]) : t('La commande #{0} a été annulée.', [o.number])}</p>
              <div class="pile espace-haut">
                <button class="btn btn-primaire btn-l btn-bloc" onClick={() => { const n = remettreAuPanier(o); toast(n ? t('Articles remis dans votre panier') : t('Ces articles ne sont plus en vente'), { icone: n ? 'sac' : 'alerte' }); if (n) naviguer('/panier'); }}><Icone n="sac" />{t('Remettre les articles dans mon panier')}</button>
                <a class="btn btn-fantome btn-bloc" href={lien('/')}>{t('Retour à la boutique')}</a>
              </div>
            </section>
          ) : (
            <section class={classes('carte paiement-attente entree', echec && 'en-echec')} style={{ '--op': moyen.color }} aria-live="polite">
              {echec ? (
                <>
                  <LogoOperateur k={o.payment.method} m={moyen} taille={48} />
                  <h1 class="titre-serif">{t('Paiement non abouti')}</h1>
                  <p class="attenue">{tx('{0} Rien n’a été débité : vous pouvez réessayer.', [traduireMessage(o.payment.error) || t('Le paiement a été refusé ou annulé.')])}</p>
                </>
              ) : carte ? (
                retourCarte === 'ok' ? (
                  <>
                    <span class="attente-onde attente-carte" aria-hidden="true"><Icone n="carte" /></span>
                    <h1 class="titre-serif">{t('Vérification du paiement…')}</h1>
                    <p class="attenue">{tx('Votre paiement de {0} par carte est en cours de confirmation auprès de notre partenaire de paiement.', [<b>{dollars(o.total)}</b>])}</p>
                    <p class="discret petit centre">{tx('{0}Cette page se met à jour toute seule dès que le paiement est confirmé.', [<span class="point-vivant" aria-hidden="true" />])}</p>
                  </>
                ) : retourCarte === 'annule' || retourCarte === 'refuse' ? (
                  <>
                    <LogoOperateur k="carte" m={moyen} taille={48} />
                    <h1 class="titre-serif">{retourCarte === 'refuse' ? t('Carte refusée') : t('Paiement par carte annulé')}</h1>
                    <p class="attenue">{tx('{0} Rien n’a été débité : réessayez, ou payez par Mobile Money.', [retourCarte === 'refuse' ? t('Votre banque n’a pas accepté le paiement.') : t('Vous avez quitté la page de paiement.')])}</p>
                  </>
                ) : (
                  <>
                    <span class="attente-onde attente-carte" aria-hidden="true"><Icone n="carte" /></span>
                    <h1 class="titre-serif">{t('Terminez le paiement par carte')}</h1>
                    <p class="attenue">{tx('Vous payez {0}{1} par carte Visa ou Mastercard, sur la page sécurisée de notre partenaire de paiement.', [<b>{dollars(o.total)}</b>, francs(o.total, c) ? ` (${francs(o.total, c)})` : ''])}</p>
                    {pageCarte ? <button class="btn btn-primaire btn-l btn-bloc" onClick={() => allerVersCarte(id, pageCarte)}><Icone n="cadenas" />{t('Continuer vers le paiement sécurisé')}</button> : null}
                    <p class="discret petit centre">{tx('{0}Cette page se met à jour toute seule dès que le paiement est confirmé.', [<span class="point-vivant" aria-hidden="true" />])}</p>
                  </>
                )
              ) : (
                <>
                  <span class="attente-onde" aria-hidden="true"><Icone n="mobile" /><LogoOperateur k={o.payment.method} m={moyen} taille={30} classe="attente-logo" /></span>
                  <h1 class="titre-serif">{t('Validez le paiement sur votre téléphone')}</h1>
                  <p class="attenue">{tx('Une demande de {0}{1} a été envoyée au {2} ({3}).', [<b>{dollars(o.total)}</b>, francs(o.total, c) ? ` (${francs(o.total, c)})` : '', <b>{telephone(o.payment.phone)}</b>, o.payment.label])}</p>
                  <ol class="etapes-paiement gauche">
                    <li><span>1</span><p>{tx('Un message de {0} s’affiche sur ce téléphone.', [o.payment.label])}</p></li>
                    <li><span>2</span><p>{tx('Vérifiez le montant : {0}.', [<b>{dollars(o.total)}</b>])}</p></li>
                    <li><span>3</span><p>{t('Saisissez votre code PIN pour confirmer.')}</p></li>
                  </ol>
                  <p class="discret petit centre">{tx('{0}Cette page se met à jour toute seule dès que {1} confirme.', [<span class="point-vivant" aria-hidden="true" />, o.payment.label])}</p>
                </>
              )}
              {reste > 0 ? <p class="discret petit centre">{tx('Vos articles restent réservés encore {0}.', [minutes(reste)])}</p> : null}
              {probleme ? <Note ton="alerte" icone="info" classe="espace-haut">{tx('{0} Nouvelle vérification dans un instant…', [probleme])}</Note> : null}

              {peutRelancer && !autre && carte && !echec && retourCarte !== 'annule' && retourCarte !== 'refuse' ? (
                <div class="pile espace-haut"><button class="btn btn-fantome btn-bloc" onClick={() => setAutre(true)}>{t('Payer autrement')}</button></div>
              ) : peutRelancer && !autre ? (
                <div class="pile espace-haut">
                  {!echec && !carte ? <p class="petit centre">{tx('{0} Vérifiez que le téléphone est allumé et a du réseau, puis renvoyez la demande.', [<b>{t('Rien reçu ?')}</b>])}</p> : null}
                  <button class={classes('btn btn-primaire btn-l btn-bloc', relance.envoi && 'charge')} onClick={() => relancer(false)}><Icone n={carte ? 'cadenas' : 'actualiser'} />{carte ? t('Réessayer par carte : {0}', [dollars(o.total)]) : echec ? t('Réessayer : {0}', [dollars(o.total)]) : t('Renvoyer la demande')}</button>
                  <button class="btn btn-fantome btn-bloc" onClick={() => setAutre(true)}>{carte ? t('Payer autrement') : t('Payer avec un autre numéro ou opérateur')}</button>
                </div>
              ) : null}
              {peutRelancer && autre ? (
                <div class="pile espace-haut gauche">
                  <ChoixPaiement ms={ms} methode={relance.methode} tel={relance.tel} erreurs={relance.erreurs} telContact={o.payment.phone}
                    onMethode={(k) => setRelance((x) => ({ ...x, methode: k, erreurs: {} }))} onTel={(v) => setRelance((x) => ({ ...x, tel: v, erreurs: {} }))} />
                  <button class={classes('btn btn-primaire btn-l btn-bloc', relance.envoi && 'charge')} onClick={() => relancer(true)}><Icone n="cadenas" />{tx('Payer {0}', [dollars(o.total)])}</button>
                  <button class="btn btn-fantome btn-bloc" onClick={() => setAutre(false)}>{t('Annuler')}</button>
                </div>
              ) : null}
              {enCours && p && !p.relance && echec ? <Note ton="danger" icone="alerte" classe="espace-haut">{t('Trop de tentatives pour cette commande. Repassez votre commande depuis votre panier.')}</Note> : null}
            </section>
          )}

          <section class="carte">
            <h2 class="carte-titre"><Icone n="recu" />{tx('Commande #{0}', [o.number])}</h2>
            <dl class="infos">
              <dt>{t('Articles')}</dt><dd>{(o.items || []).map((i) => `${i.title}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ')}</dd>
              <dt>{R.estRetraitCmd(o) ? t('Retrait') : t('Livraison')}</dt><dd>{t(o.shipping.zoneName)}{o.shipping.address ? ` · ${o.shipping.address}` : ''}</dd>
              <dt>{t('À payer')}</dt><dd><b>{dollars(o.total)}</b>{o.serviceFee ? <small class="discret">{' '}{tx('dont {0} de frais de service', [dollars(o.serviceFee)])}</small> : null}</dd>
            </dl>
          </section>
          <Note ton="info" icone="bouclier">{carte ? t('Votre carte est saisie sur la page sécurisée de notre partenaire de paiement : la boutique ne voit jamais son numéro.') : t('Vous validez vous-même le paiement sur votre téléphone. Personne de la boutique ne vous demandera votre code PIN.')}</Note>
        </div>
      </main>
    </>
  );
}

/* Mode test : page de paiement par carte simulée. En vrai, le client saisit sa carte sur la page sécurisée du fournisseur. */
export function CarteTest() {
  const id = route.value.params.id; const jeton = jetonDe(id); const o = commandes.value.get(id);
  const [envoi, setEnvoi] = useState('');
  useSeo(() => ({ titre: t('Paiement par carte (test)'), noindex: true }), []);
  async function choisir(issue) {
    if (envoi) return;
    setEnvoi(issue);
    try {
      const r = await requete(`sokoyetu/paiement/${encodeURIComponent(id)}/carte-test?t=${encodeURIComponent(jeton)}`, { method: 'POST', corps: { issue } });
      recevoirCommande(id, r.order);
      naviguer(`/paiement/${id}?carte=${issue === 'ok' ? 'ok' : issue === 'refus' ? 'refuse' : 'annule'}`, { remplacer: true });
    } catch (e) { setEnvoi(''); toast(e.message, { icone: 'alerte', ton: 'danger', duree: 5000 }); }
  }
  return (
    <>
      <EntetePage titre={t('Paiement par carte')} sous={t('Page de test')} repli={'/paiement/' + id} />
      <main id="contenu" class="page conteneur page-carte-test">
        {!jeton ? (
          <Vide icone="recu" titre={t('Commande introuvable sur ce téléphone')} texte={t('Cette page de test s’ouvre depuis la commande, sur le téléphone qui l’a passée.')} />
        ) : (
          <div class="pile-l paiement-corps">
            <Note ton="alerte" icone="info">{tx('{0} En vrai, le client saisit sa carte sur la page sécurisée du partenaire de paiement (FlexPay), hors de la boutique. Ici, choisissez l’issue du paiement : aucun argent ne circule.', [<b>{t('Mode test.')}</b>])}</Note>
            <section class="carte carte-test">
              <div class="carte-test-visuel" aria-hidden="true">
                <span class="carte-test-puce" />
                <span class="carte-test-numero num">4242 4242 4242 4242</span>
                <span class="carte-test-bas"><span>{t('Carte de test')}</span><span class="num">12/30</span></span>
              </div>
              <dl class="infos"><dt>{t('Commande')}</dt><dd>#{o ? o.number : '…'}</dd><dt>{t('Montant')}</dt><dd><b class="num">{o ? dollars(o.total) : '…'}</b></dd></dl>
              <div class="pile espace-haut">
                <button class={classes('btn btn-primaire btn-l btn-bloc', envoi === 'ok' && 'charge')} onClick={() => choisir('ok')}><Icone n="cadenas" />{tx('Payer {0}', [o ? dollars(o.total) : ''])}</button>
                <button class={classes('btn btn-secondaire btn-bloc', envoi === 'refus' && 'charge')} onClick={() => choisir('refus')}>{t('Simuler une carte refusée')}</button>
                <button class={classes('btn btn-fantome btn-bloc', envoi === 'annule' && 'charge')} onClick={() => choisir('annule')}>{t('Annuler et revenir à la boutique')}</button>
              </div>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
