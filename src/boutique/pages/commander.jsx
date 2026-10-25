// Sokoyetu (boutique) — commande en 3 étapes : livraison, mode de paiement, paiement Mobile Money et confirmation.
// Le total à payer est confirmé par le serveur avant l'étape de paiement ; l'envoi est sans risque de doublon (jeton unique).
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Choix, CaseACocher, Etapes, Note, Vide, toast, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { requete } from '../../commun/js/api.js';
import { Local } from '../../commun/js/stockage.js';
import { dollars, francs, telephone, copier, secret, pluriel, lienWhatsApp, classes } from '../../commun/js/outils.js';
import { lien, naviguer } from '../routeur.js';
import { cfg, lignesPanier, panier, moyensPaiement, profil, enregistrerProfil, viderPanier, suivreCommande, recevoirCommande } from '../etat.js';
import { EntetePage, BarreAction } from '../composants/cadre.jsx';
import { mesurerEvenement } from '../mesure.js';
import { devisLocal } from './panier.jsx';
import { useSeo } from './commun.jsx';

const NOMS = ['Livraison', 'Paiement', 'Confirmation'];
const CHAMP_ETAPE = { name: 1, phone: 1, zone: 1, address: 1, method: 2, ref: 3, sender: 3, terms: 3 };

function brouillonInitial() {
  const pf = profil.value; const c = cfg.value; const ms = moyensPaiement.value;
  const b = Local.lire('commandeEnCours', null);
  const frais = b && Date.now() - (b.le || 0) < 6 * 3600e3 ? b : null;
  const zone = R.zoneDe(c, (frais && frais.zoneId) || pf.zoneId) || c.zones[0];
  return {
    etape: 1, nom: pf.name || '', tel: pf.phone || '', zoneId: zone ? zone.id : '', adresse: pf.address || '', repere: pf.landmark || '', note: '',
    methode: (ms[0] || {}).k || '', code: '', remise: null, envoyeur: '', ref: '', conditions: false,
    ...(frais || {}), erreurs: {}, devis: null, envoi: false, verification: false,
    jeton: frais && R.valider.jeton(frais.jeton) ? frais.jeton : secret(32)
  };
}

export function Commander() {
  const c = cfg.value; const ms = moyensPaiement.value; const lignes = lignesPanier.value;
  const [f, setF] = useState(brouillonInitial);
  const maj = (p) => setF((x) => ({ ...x, ...p }));
  const champ = (k) => (e) => maj({ [k]: e.currentTarget.value, erreurs: { ...f.erreurs, [k]: '' } });
  const haut = useRef(null);
  useSeo(() => ({ titre: 'Commande', noindex: true }), []);

  // Brouillon gardé sur l'appareil (et le jeton : un nouvel essai ne crée jamais de doublon)
  useEffect(() => {
    const { erreurs, devis, envoi, verification, etape, ...garde } = f;
    Local.ecrire('commandeEnCours', { ...garde, le: Date.now() });
  }, [f.nom, f.tel, f.zoneId, f.adresse, f.repere, f.note, f.methode, f.code, f.remise, f.envoyeur, f.ref, f.jeton]);
  useEffect(() => { if (!R.moyensDePaiement(c).some((m) => m.k === f.methode) && ms[0]) maj({ methode: ms[0].k }); }, [ms.length]);
  // L'étape 3 suppose un montant confirmé par le serveur : sinon, retour à l'étape 2.
  useEffect(() => { if (f.etape === 3 && (!f.devis || !ms.some((m) => m.k === f.methode))) maj({ etape: 2 }); }, [f.etape, f.devis, f.methode, ms.length]);

  if (!lignes.length) {
    return <><EntetePage titre="Commande" repli="/panier" /><main id="contenu" class="page conteneur"><Vide icone="sac" titre="Votre panier est vide" texte="Ajoutez des articles avant de commander."><a class="btn btn-primaire" href={lien('/')}>Retour à la boutique</a></Vide></main></>;
  }

  const zone = R.zoneDe(c, f.zoneId); const retrait = R.estRetrait(zone);
  const dv = f.devis || devisLocal({ zoneId: f.zoneId, remise: f.remise });
  const moyen = ms.find((m) => m.k === f.methode);
  const allerA = (n) => { maj({ etape: n, erreurs: {} }); requestAnimationFrame(() => (haut.current || document.body).scrollIntoView({ block: 'start' })); window.scrollTo(0, 0); };

  function verifierEtape1() {
    const e = {};
    if (!R.valider.nom(f.nom)) e.name = 'Indiquez votre nom complet (2 à 60 lettres).';
    if (!R.valider.telephone(f.tel)) e.phone = 'Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.';
    if (!zone) e.zone = 'Choisissez une zone de livraison.';
    if (zone && !retrait && R.nettoyer(f.adresse, 120).length < 4) e.address = 'Indiquez votre adresse : quartier, avenue, numéro.';
    return e;
  }

  async function appliquerCode() {
    const code = R.valider.codePromo(f.code);
    if (!f.code.trim()) { maj({ remise: null, erreurs: { ...f.erreurs, code: '' } }); return; }
    if (!code) { maj({ remise: null, erreurs: { ...f.erreurs, code: 'Ce code n’est pas valide.' } }); return; }
    try {
      const r = await requete(`sokoyetu/discount?code=${encodeURIComponent(code)}&subtotal=${dv.sousTotal}`);
      if (r && r.ok) { maj({ remise: { code: r.code, type: r.type, value: r.value, minSubtotal: r.minSubtotal }, devis: null, erreurs: { ...f.erreurs, code: '' } }); toast(`Code ${r.code} appliqué`, { icone: 'etiquette' }); }
      else maj({ remise: null, erreurs: { ...f.erreurs, code: (r && r.reason) || 'Ce code n’est pas valide.' } });
    } catch (e) { maj({ erreurs: { ...f.erreurs, code: e.message } }); }
  }

  /* Étape 2 → 3 : le serveur confirme prix, stock, remise et livraison avant que le client ne paie. */
  async function confirmerMontant() {
    if (!moyen) { maj({ erreurs: { method: 'Choisissez un mode de paiement.' } }); return; }
    maj({ verification: true });
    try {
      const r = await requete('sokoyetu/devis', { method: 'POST', corps: { items: panier.value.map(({ productId, color, size, qty }) => ({ productId, color, size, qty })), zoneId: f.zoneId, discountCode: f.remise ? f.remise.code : '' } });
      const bloquants = (r.problemes || []).filter((p) => p.code !== 'remise');
      if (bloquants.length) {
        maj({ verification: false });
        const id = ouvrirFeuille({
          titre: 'Votre panier a changé',
          contenu: () => <div class="pile"><p class="attenue">Avant de payer, vérifiez ces points :</p><ul class="liste-points">{bloquants.map((p, i) => <li key={i}><Icone n="alerte" />{p.message}</li>)}</ul></div>,
          pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => { fermerFeuille(id); naviguer('/panier'); }}>Modifier mon panier</button>
        });
        return;
      }
      const remiseRefusee = (r.problemes || []).find((p) => p.code === 'remise');
      maj({ verification: false, devis: { lignes: r.lignes, sousTotal: r.sousTotal, remise: r.remise, livraison: r.livraison, total: r.total, problemes: [] }, remise: remiseRefusee ? null : f.remise, erreurs: remiseRefusee ? { code: remiseRefusee.message } : {} });
      if (remiseRefusee) toast('Le code promo ne s’applique plus', { icone: 'alerte', ton: 'danger' });
      mesurerEvenement('add_payment_info', { value: r.total, currency: 'USD', payment_type: moyen.label });
      allerA(3);
    } catch (e) {
      maj({ verification: false });
      toast(e.message || 'Vérification impossible. Réessayez.', { icone: 'alerte', ton: 'danger' });
    }
  }

  async function envoyer() {
    const e = {};
    if (!R.valider.reference(f.ref)) e.ref = 'Code invalide : 4 à 30 lettres ou chiffres, tel qu’il figure dans le SMS.';
    if (f.envoyeur.trim() && !R.valider.telephone(f.envoyeur)) e.sender = 'Numéro invalide.';
    if (!f.conditions) e.terms = 'Cochez cette case pour confirmer la commande.';
    if (Object.keys(e).length) { maj({ erreurs: e }); setTimeout(() => document.querySelector('.en-erreur, .champ-erreur')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); return; }
    if (f.envoi || !f.devis) return;
    maj({ envoi: true, erreurs: {} });
    const corps = {
      token: f.jeton, termsAccepted: true, website: document.getElementById('site-web')?.value || '',
      customer: { name: f.nom, phone: f.tel }, shipping: { zoneId: f.zoneId, address: f.adresse, landmark: f.repere }, note: f.note,
      items: panier.value.map(({ productId, color, size, qty }) => ({ productId, color, size, qty })),
      discountCode: f.remise ? f.remise.code : '', payment: { method: f.methode, ref: f.ref, sender: f.envoyeur }, total: f.devis.total
    };
    try {
      const r = await requete('sokoyetu/commander', { method: 'POST', corps, delai: 40000 });
      suivreCommande(r.id, f.jeton); recevoirCommande(r.id, r.order);
      enregistrerProfil({ name: R.valider.nom(f.nom), phone: R.valider.telephone(f.tel), zoneId: f.zoneId, address: f.adresse, landmark: f.repere });
      mesurerEvenement('purchase', { transaction_id: r.order.number, value: r.order.total, currency: 'USD', shipping: r.order.shippingFee });
      viderPanier(); Local.retirer('commandeEnCours');
      naviguer('/merci/' + r.id, { remplacer: true });
    } catch (err) {
      maj({ envoi: false });
      if (err.status === 400) {
        const etape = CHAMP_ETAPE[err.champ];
        if (etape) { maj({ etape, erreurs: { [err.champ]: err.message } }); return; }
        toast(err.message, { icone: 'alerte', ton: 'danger', duree: 5000 }); return;
      }
      if (err.code === 'limite') { toast(err.message, { icone: 'horloge', ton: 'danger', duree: 5000 }); return; }
      const wa = lienWhatsApp(c.whatsapp, `Bonjour ${c.name}, je n’arrive pas à confirmer ma commande en ligne. Paiement ${moyen ? moyen.label : ''} de ${dollars(f.devis.total)}, code ${R.valider.reference(f.ref)}. ${f.nom}, ${f.tel}.`);
      const id = ouvrirFeuille({
        titre: 'Connexion interrompue',
        contenu: () => <div class="pile"><p class="attenue">Votre commande n’a peut-être pas encore été reçue. Réessayez : elle ne sera jamais enregistrée deux fois.</p>{wa ? <p class="attenue">Si le problème continue, envoyez-nous votre code de paiement sur WhatsApp.</p> : null}</div>,
        pied: () => <><button class="btn btn-primaire btn-bloc" onClick={() => { fermerFeuille(id); setTimeout(envoyer, 300); }}><Icone n="actualiser" />Réessayer</button>{wa ? <a class="btn btn-secondaire btn-bloc" href={wa} target="_blank" rel="noopener"><Icone n="bulle" />Écrire sur WhatsApp</a> : null}</>
      });
    }
  }

  const suivant = () => {
    if (f.etape === 1) { const e = verifierEtape1(); if (Object.keys(e).length) { maj({ erreurs: e }); setTimeout(() => document.querySelector('.en-erreur input, .en-erreur')?.focus?.(), 30); return; } maj({ devis: null }); allerA(2); }
    else if (f.etape === 2) confirmerMontant();
    else envoyer();
  };

  const recap = (
    <div class="carte">
      <h2 class="carte-titre"><Icone n="recu" />Récapitulatif<span class="fin">{pluriel(lignes.reduce((a, l) => a + l.qty, 0), 'article')}</span></h2>
      <ul class="recap-articles">
        {lignes.map((l) => l.p ? (
          <li key={l.cle}><span class="ra-photo"><Photo m={R.imagePrincipale(l.p)} alt="" tailles="56px" />{l.qty > 1 ? <i>{l.qty}</i> : null}</span><span class="ra-texte"><b>{l.p.title}</b><small>{[l.color, l.size].filter(Boolean).join(' · ')}</small></span><span class="num">{dollars(R.num(l.p.price) * l.qty)}</span></li>
        ) : null)}
      </ul>
      <dl class="montants espace-haut">
        <div><dt>Sous-total</dt><dd class="num">{dollars(dv.sousTotal)}</dd></div>
        {dv.remise ? <div><dt>Code {dv.remise.code}</dt><dd class="moins num">−{dollars(dv.remise.amount)}</dd></div> : null}
        <div><dt>Livraison{zone ? ` · ${zone.name}` : ''}</dt><dd class="num">{dv.livraison ? dollars(dv.livraison) : 'Gratuite'}</dd></div>
        <div class="total"><dt class="lib">Total</dt><dd class="num">{dollars(dv.total)}</dd></div>
      </dl>
      {francs(dv.total, c) ? <p class="discret petit droite">{francs(dv.total, c)}</p> : null}
    </div>
  );

  return (
    <>
      <EntetePage titre="Commande" sous={`Étape ${f.etape} sur 3 · ${NOMS[f.etape - 1]}`} repli="/panier" cacherTitreOrdi onRetour={f.etape > 1 ? () => allerA(f.etape - 1) : undefined} />
      <main id="contenu" class="page conteneur page-commande" ref={haut}>
        <div class="commande-tete"><h1 class="titre-serif seulement-ordi">Finaliser ma commande</h1><Etapes noms={NOMS} actuelle={f.etape} /></div>
        <div class="commande-grille">
          <div class="pile-l" key={f.etape}>
            {f.etape === 1 ? (
              <>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="personne" />Vos coordonnées</h2>
                  <div class="formulaire">
                    <Champ libelle="Nom complet" erreur={f.erreurs.name}>{(a) => <input class="saisie" {...a} value={f.nom} onInput={champ('nom')} autocomplete="name" maxlength="60" placeholder="Ex. : Grâce Mapendo" />}</Champ>
                    <Champ libelle="Téléphone" erreur={f.erreurs.phone} aide="Nous vous appelons ou vous écrivons sur WhatsApp à ce numéro.">{(a) => <input class="saisie" {...a} value={f.tel} onInput={champ('tel')} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="099 123 4567" />}</Champ>
                    <div class="pot-de-miel" aria-hidden="true"><label>Ne pas remplir<input id="site-web" tabIndex={-1} autocomplete="off" /></label></div>
                  </div>
                </section>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="camion" />Livraison</h2>
                  <div class="choix-liste" role="radiogroup" aria-label="Zone de livraison">
                    {c.zones.map((z) => <Choix key={z.id} actif={f.zoneId === z.id} onClick={() => maj({ zoneId: z.id, devis: null, erreurs: { ...f.erreurs, zone: '' } })} icone={z.pickup ? 'boutique' : 'camion'} titre={z.name}
                      sous={`${R.num(z.fee) ? dollars(z.fee) : 'Gratuit'}${z.pickup ? ' · à retirer en boutique' : z.days > 1 ? ` · sous ${z.days} jours` : ' · sous 24 h'}`} />)}
                  </div>
                  {f.erreurs.zone ? <p class="champ-erreur"><Icone n="alerte" />{f.erreurs.zone}</p> : null}
                  {retrait ? <Note ton="info" icone="boutique" classe="espace-haut">Vous récupérez votre commande à la boutique de {c.city}. Nous vous prévenons dès qu’elle est prête.</Note> : (
                    <div class="formulaire espace-haut">
                      <Champ libelle="Adresse" erreur={f.erreurs.address} aide="Quartier, avenue, numéro.">{(a) => <input class="saisie" {...a} value={f.adresse} onInput={champ('adresse')} autocomplete="street-address" maxlength="120" placeholder="Ex. : Nyawera, av. Lumumba n° 12" />}</Champ>
                      <Champ libelle="Point de repère" facultatif>{(a) => <input class="saisie" {...a} value={f.repere} onInput={champ('repere')} maxlength="80" placeholder="Ex. : en face de la pharmacie" />}</Champ>
                    </div>
                  )}
                  <div class="espace-haut"><Champ libelle="Note pour la boutique" facultatif>{(a) => <textarea class="saisie" {...a} rows="2" value={f.note} onInput={champ('note')} maxlength="300" placeholder="Horaires, précisions…" />}</Champ></div>
                </section>
                <p class="discret petit rangee"><Icone n="cadenas" taille={15} />Ces informations servent uniquement à livrer votre commande. <a class="lien" href={lien('/infos/confidentialite')}>Confidentialité</a></p>
              </>
            ) : null}

            {f.etape === 2 ? (
              <>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="portefeuille" />Mode de paiement</h2>
                  <p class="attenue petit" style={{ marginTop: -6, marginBottom: 12 }}>Vous payez par Mobile Money au moment de la commande. Pas de paiement à la livraison.</p>
                  {ms.length ? (
                    <div class="choix-liste" role="radiogroup" aria-label="Mode de paiement">
                      {ms.map((m) => <Choix key={m.k} actif={f.methode === m.k} onClick={() => maj({ methode: m.k, erreurs: {} })} couleur={m.color} icone={m.init} titre={m.label} sous={m.sub} />)}
                    </div>
                  ) : <Note ton="alerte" icone="alerte">Le paiement n’est pas encore configuré. Contactez la boutique pour commander.</Note>}
                  {f.erreurs.method ? <p class="champ-erreur"><Icone n="alerte" />{f.erreurs.method}</p> : null}
                </section>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="etiquette" />Code promo</h2>
                  <form class="ajout-code" onSubmit={(e) => { e.preventDefault(); appliquerCode(); }}>
                    <Champ erreur={f.erreurs.code} classe="plein">{(a) => <input class="saisie" {...a} aria-label="Code promo" value={f.code} onInput={(e) => maj({ code: e.currentTarget.value.toUpperCase(), erreurs: { ...f.erreurs, code: '' } })} placeholder="Ex. : BIENVENUE10" autocapitalize="characters" maxlength="20" />}</Champ>
                    <button class="btn btn-secondaire" type="submit">Appliquer</button>
                  </form>
                  {f.remise ? <p class="ligne-stock ok espace-haut"><Icone n="coche" />Code {f.remise.code} appliqué{dv.remise ? ` : −${dollars(dv.remise.amount)}` : ''}<button class="lien petit" style={{ marginLeft: 'auto' }} onClick={() => maj({ remise: null, code: '', devis: null })}>Retirer</button></p> : null}
                </section>
                <div class="seulement-mobile">{recap}</div>
              </>
            ) : null}

            {f.etape === 3 && moyen && f.devis ? (
              <>
                <section class="carte carte-paiement entree-avant" style={{ '--op': moyen.color }}>
                  <h2 class="carte-titre"><span class="op-pastille" aria-hidden="true">{moyen.init}</span>Payer avec {moyen.label}</h2>
                  <ol class="etapes-paiement">
                    <li><span>1</span><p>Ouvrez {moyen.label}{moyen.ussd ? <> (composez <b>{moyen.ussd}</b>)</> : null} et choisissez l’envoi d’argent.</p></li>
                    <li><span>2</span><p>Envoyez <b>exactement {dollars(f.devis.total)}</b>{francs(f.devis.total, c) ? ` (${francs(f.devis.total, c)})` : ''} à ce numéro :</p></li>
                  </ol>
                  <div class="a-copier">
                    <div><small>Numéro {moyen.label}{moyen.accountName ? ` · au nom de ${moyen.accountName}` : ''}</small><b>{telephone(moyen.number) || moyen.number}</b></div>
                    <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(R.chiffres(moyen.number))) toast('Numéro copié'); }}><Icone n="copier" />Copier</button>
                  </div>
                  <div class="a-copier">
                    <div><small>Montant exact</small><b>{dollars(f.devis.total)}</b></div>
                    <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(f.devis.total.toFixed(2))) toast('Montant copié'); }}><Icone n="copier" />Copier</button>
                  </div>
                  <ol class="etapes-paiement" start="3"><li><span>3</span><p>Saisissez ci-dessous le code de la transaction reçu par SMS.</p></li></ol>
                  <div class="formulaire">
                    <Champ libelle="Code de la transaction" erreur={f.erreurs.ref} aide="La boutique vérifie ce code avant de préparer votre commande.">{(a) => <input class="saisie saisie-code" {...a} value={f.ref} onInput={champ('ref')} autocomplete="off" autocapitalize="characters" spellcheck={false} maxlength="30" placeholder="Code reçu par SMS" />}</Champ>
                    <Champ libelle="Numéro qui a envoyé l’argent" facultatif erreur={f.erreurs.sender} aide="Laissez vide si c’est votre numéro de contact.">{(a) => <input class="saisie" {...a} value={f.envoyeur} onInput={champ('envoyeur')} type="tel" inputmode="tel" maxlength="20" placeholder={telephone(f.tel) || '099 123 4567'} />}</Champ>
                  </div>
                  <Note ton="info" icone="bouclier" classe="espace-haut">Nous ne vous demanderons jamais votre code PIN Mobile Money.</Note>
                </section>
                <section class="carte entree-avant">
                  <div class="entre"><h2 class="carte-titre" style={{ margin: 0 }}><Icone n="repere" />Livraison</h2><button class="btn btn-fantome btn-s" onClick={() => allerA(1)}><Icone n="crayon" />Modifier</button></div>
                  <dl class="infos espace-haut"><dt>Nom</dt><dd>{f.nom}</dd><dt>Téléphone</dt><dd>{telephone(R.valider.telephone(f.tel)) || f.tel}</dd><dt>Zone</dt><dd>{zone && zone.name}</dd>{!retrait && f.adresse ? <><dt>Adresse</dt><dd>{f.adresse}</dd></> : null}</dl>
                </section>
                <div class="seulement-mobile">{recap}</div>
                <section class={classes('carte', f.erreurs.terms && 'en-erreur')}>
                  <CaseACocher coche={f.conditions} onClick={() => maj({ conditions: !f.conditions, erreurs: { ...f.erreurs, terms: '' } })}>
                    J’accepte les <a class="lien" href={lien('/infos/conditions')} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>conditions de vente</a> et la <a class="lien" href={lien('/infos/retours')} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>politique de retours</a>.
                  </CaseACocher>
                  {f.erreurs.terms ? <p class="champ-erreur espace-haut"><Icone n="alerte" />{f.erreurs.terms}</p> : null}
                </section>
              </>
            ) : null}
          </div>
          <aside class="commande-resume seulement-ordi">
            {recap}
            <button class={classes('btn btn-primaire btn-l btn-bloc espace-haut', (f.envoi || f.verification) && 'charge')} onClick={suivant} disabled={f.etape === 2 && !ms.length}>{f.etape === 3 ? 'Confirmer ma commande' : f.etape === 2 ? 'Vérifier et payer' : 'Continuer'}</button>
            {f.etape > 1 ? <button class="btn btn-fantome btn-bloc" onClick={() => allerA(f.etape - 1)}>Étape précédente</button> : null}
          </aside>
        </div>
      </main>
      <BarreAction>
        <div class="barre-total"><small>{f.etape === 3 ? 'À payer' : 'Total'}</small><span class="prix">{dollars(dv.total)}</span></div>
        <button class={classes('btn btn-primaire btn-l', (f.envoi || f.verification) && 'charge')} style={{ flex: 1 }} onClick={suivant} disabled={f.etape === 2 && !ms.length}>{f.etape === 3 ? 'Confirmer' : f.etape === 2 ? 'Vérifier et payer' : 'Continuer'}</button>
      </BarreAction>
    </>
  );
}
