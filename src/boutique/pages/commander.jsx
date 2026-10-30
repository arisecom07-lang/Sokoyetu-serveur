// Sokoyetu (boutique) — commande en 3 étapes : livraison, paiement Mobile Money dans l'application, reçu.
// Le montant est confirmé par le serveur juste avant la demande de paiement ; l'envoi est sans risque de doublon (jeton unique).
// La commande n'est validée que lorsque l'opérateur confirme le paiement (page « paiement »).
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Photo } from '../../commun/js/medias.jsx';
import { Champ, Choix, CaseACocher, LogoOperateur, Etapes, Note, Vide, toast, ouvrirFeuille, fermerFeuille } from '../../commun/js/interface.jsx';
import { requete } from '../../commun/js/api.js';
import { Local } from '../../commun/js/stockage.js';
import { dollars, francs, telephone, secret, pluriel, classes } from '../../commun/js/outils.js';
import { lien, naviguer } from '../routeur.js';
import { cfg, lignesACommander, aCommander, moyensPaiement, profil, enregistrerProfil, retirerCommandes, suivreCommande, recevoirCommande, comptesOuverts, connecte, sansCompte, continuerSansCompte, client } from '../etat.js';
import { InvitationCompte } from './connexion.jsx';
import { EntetePage, BarreAction } from '../composants/cadre.jsx';
import { mesurerEvenement } from '../mesure.js';
import { jetonAppareil } from '../notifications.js';
import { devisLocal, prixPieces } from './panier.jsx';
import { useSeo } from './commun.jsx';

export const NOMS_ETAPES = ['Livraison', 'Paiement', 'Reçu'];
const CHAMP_ETAPE = { name: 1, phone: 1, zone: 1, address: 1, method: 2, payphone: 2, terms: 2, remise: 2 };

function brouillonInitial() {
  const pf = profil.value; const c = cfg.value; const ms = moyensPaiement.value;
  const b = Local.lire('commandeEnCours', null);
  const frais = b && Date.now() - (b.le || 0) < 6 * 3600e3 ? b : null;
  const zone = R.zoneDe(c, (frais && frais.zoneId) || pf.zoneId) || c.zones[0];
  const f = {
    etape: 1, nom: pf.name || '', tel: pf.phone || '', zoneId: zone ? zone.id : '', adresse: pf.address || '', repere: pf.landmark || '', note: '',
    methode: pf.payMethod || (ms[0] || {}).k || '', telPaiement: pf.payPhone || '', code: '', remise: null, conditions: false,
    ...(frais || {}), erreurs: {}, devis: null, envoi: false,
    jeton: frais && R.valider.jeton(frais.jeton) ? frais.jeton : secret(32)
  };
  // Brouillon commencé avant de se connecter : les champs restés vides prennent les coordonnées du compte.
  [['nom', 'name'], ['tel', 'phone'], ['adresse', 'address'], ['repere', 'landmark'], ['telPaiement', 'payPhone']].forEach(([k, kp]) => { if (!String(f[k] || '').trim() && pf[kp]) f[k] = pf[kp]; });
  return f;
}

/* Montants : sous-total, réduction, livraison, frais de service, total (commande, reçu, suivi). */
export function Montants({ m, zone, libelleTotal = 'Total' }) {
  return (
    <dl class="montants espace-haut">
      <div><dt>Sous-total</dt><dd class="num">{dollars(m.sousTotal)}</dd></div>
      {m.remise ? <div><dt>Code {m.remise.code}</dt><dd class="moins num">−{dollars(m.remise.amount)}</dd></div> : null}
      <div><dt>Livraison{zone ? ` · ${zone}` : ''}</dt><dd class="num">{m.livraison ? dollars(m.livraison) : 'Gratuite'}</dd></div>
      {m.frais ? <div><dt>Frais de service ({R.num(m.fraisPct)} %)</dt><dd class="num">{dollars(m.frais)}</dd></div> : null}
      <div class="total"><dt class="lib">{libelleTotal}</dt><dd class="num">{dollars(m.total)}</dd></div>
    </dl>
  );
}

/* Choix de l'opérateur et du numéro Mobile Money à débiter (commande, nouvelle tentative). */
export function ChoixPaiement({ ms, methode, tel, erreurs, onMethode, onTel, telContact }) {
  const moyen = ms.find((m) => m.k === methode);
  return (
    <>
      <div class="choix-liste" role="radiogroup" aria-label="Opérateur Mobile Money">
        {ms.map((m) => <Choix key={m.k} actif={methode === m.k} onClick={() => onMethode(m.k)} icone={<LogoOperateur m={m} />} titre={m.label} sous={m.sub} />)}
      </div>
      {erreurs.method ? <p class="champ-erreur"><Icone n="alerte" />{erreurs.method}</p> : null}
      <div class="formulaire espace-haut">
        <Champ libelle={`Entrez le numéro de votre compte ${moyen ? moyen.label : 'Mobile Money'}`} erreur={erreurs.payphone}
          aide={`La demande de paiement arrive sur ce téléphone : vous la validez avec votre code PIN.${telContact ? ` Laissé vide, nous utilisons votre numéro ${telephone(telContact)}.` : ''}`}>
          {(a) => <input class="saisie saisie-numero" {...a} value={tel} onInput={(e) => onTel(e.currentTarget.value)} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder={`Ex. ${(moyen && moyen.exemple) || '099 123 4567'}`} />}
        </Champ>
      </div>
    </>
  );
}

export function NoteModeTest() {
  return <Note ton="info" icone="info"><b>Mode test.</b> Aucun argent n’est débité : le paiement est confirmé tout seul après quelques secondes (refusé si le numéro se termine par 0000).</Note>;
}

export function Commander() {
  const c = cfg.value; const ms = moyensPaiement.value; const lignes = lignesACommander.value;
  const [f, setF] = useState(brouillonInitial);
  const maj = (p) => setF((x) => ({ ...x, ...p }));
  const champ = (k) => (e) => maj({ [k]: e.currentTarget.value, erreurs: { ...f.erreurs, [k]: '' } });
  const haut = useRef(null);
  // Verrou immédiat (avant même le nouvel affichage) : deux appuis rapides sur « Payer » n'envoient qu'une demande.
  const verrou = useRef(false);
  useSeo(() => ({ titre: 'Commande', noindex: true }), []);

  // Brouillon gardé sur l'appareil (et le jeton : un nouvel essai ne crée jamais de doublon)
  useEffect(() => {
    const { erreurs, devis, envoi, etape, conditions, ...garde } = f;
    Local.ecrire('commandeEnCours', { ...garde, le: Date.now() });
  }, [f.nom, f.tel, f.zoneId, f.adresse, f.repere, f.note, f.methode, f.telPaiement, f.code, f.remise, f.jeton]);
  useEffect(() => { if (!ms.some((m) => m.k === f.methode) && ms[0]) maj({ methode: ms[0].k }); }, [ms.length]);

  if (!lignes.length) {
    return <><EntetePage titre="Commande" repli="/panier" /><main id="contenu" class="page conteneur"><Vide icone="sac" titre="Aucun article à commander" texte="Cochez dans votre panier les articles que vous voulez commander maintenant."><a class="btn btn-primaire" href={lien('/panier')}>Voir mon panier</a></Vide></main></>;
  }

  // Avant la commande, la création d'un compte est proposée ; « Continuer sans compte » reste toujours possible.
  if (comptesOuverts.value && !connecte.value && !sansCompte.value) {
    return (
      <>
        <EntetePage titre="Commande" sous="Avec ou sans compte" repli="/panier" />
        <main id="contenu" class="page conteneur page-choix-compte">
          <InvitationCompte titre="Créez votre compte et commencez à commander dès maintenant" texte="En 30 secondes, avec votre numéro de téléphone." retour="/commander" pour="commande" tel={f.tel}
            sansCompte={() => { continuerSansCompte(); window.scrollTo(0, 0); }} />
          <p class="discret petit centre">Sans compte, vous commandez tout de suite. Vous pourrez créer votre compte plus tard : vos commandes passées avec le même téléphone vous suivront.</p>
        </main>
      </>
    );
  }

  const zone = R.zoneDe(c, f.zoneId); const retrait = R.estRetrait(zone);
  const dv = f.devis || devisLocal({ zoneId: f.zoneId, remise: f.remise });
  const moyen = ms.find((m) => m.k === f.methode);
  const ouvert = ms.length > 0;
  const enTest = !!(c.payment && c.payment.test);
  // Numéro à débiter : celui saisi, sinon le numéro de contact s'il convient au Mobile Money.
  const telDebite = f.telPaiement.trim() || (R.valider.mobileMoney(f.tel) ? f.tel : '');
  const allerA = (n) => { maj({ etape: n, erreurs: {} }); requestAnimationFrame(() => (haut.current || document.body).scrollIntoView({ block: 'start' })); window.scrollTo(0, 0); };
  const montrerErreur = () => setTimeout(() => document.querySelector('.en-erreur, .champ-erreur')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);

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

  function panierChange(messages) {
    const id = ouvrirFeuille({
      titre: 'Votre panier a changé',
      contenu: () => <div class="pile"><p class="attenue">Avant de payer, vérifiez ces points :</p><ul class="liste-points">{messages.map((m, i) => <li key={i}><Icone n="alerte" />{m}</li>)}</ul></div>,
      pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => { fermerFeuille(id); naviguer('/panier'); }}>Modifier mon panier</button>
    });
  }

  /* Le serveur confirme prix, stock, remise, livraison et frais. Renvoie le devis, ou null si le client doit d'abord revoir le montant. */
  async function confirmerMontant() {
    const r = await requete('sokoyetu/devis', { method: 'POST', corps: { items: aCommander.value.map(({ productId, color, size, qty }) => ({ productId, color, size, qty })), zoneId: f.zoneId, discountCode: f.remise ? f.remise.code : '' } });
    const bloquants = (r.problemes || []).filter((p) => p.code !== 'remise');
    if (bloquants.length) { panierChange(bloquants.map((p) => p.message)); return null; }
    const remiseRefusee = (r.problemes || []).find((p) => p.code === 'remise');
    const devis = { lignes: r.lignes, sousTotal: r.sousTotal, remise: r.remise, livraison: r.livraison, frais: r.frais, fraisPct: r.fraisPct, total: r.total, poids: r.poids, problemes: [] };
    if (remiseRefusee) {
      maj({ devis, remise: null, erreurs: { code: remiseRefusee.message } });
      toast('Le code promo ne s’applique plus : vérifiez le nouveau montant', { icone: 'alerte', ton: 'danger', duree: 4500 });
      return null;
    }
    if (Math.abs(r.total - dv.total) > 0.009) {
      maj({ devis });
      toast(`Le montant à payer est maintenant de ${dollars(r.total)}. Vérifiez-le, puis payez.`, { icone: 'alerte', ton: 'danger', duree: 5000 });
      return null;
    }
    maj({ devis });
    return devis;
  }

  async function payer() {
    if (f.envoi || verrou.current) return;
    verrou.current = true;
    try { await payerUneFois(); } finally { verrou.current = false; }
  }
  async function payerUneFois() {
    const e = {};
    if (!moyen) e.method = 'Choisissez votre opérateur Mobile Money.';
    else if (!R.valider.mobileMoney(telDebite)) e.payphone = `Numéro ${moyen.label} invalide : 10 chiffres, commençant par 08 ou 09.`;
    if (!f.conditions) e.terms = 'Cochez cette case pour payer.';
    if (Object.keys(e).length) { maj({ erreurs: e }); montrerErreur(); return; }
    maj({ envoi: true, erreurs: {} });
    let devis;
    try { devis = await confirmerMontant(); } catch (err) { maj({ envoi: false }); connexionCoupee(err); return; }
    if (!devis) { maj({ envoi: false }); return; }
    const corps = {
      token: f.jeton, termsAccepted: true, website: document.getElementById('site-web')?.value || '',
      customer: { name: f.nom, phone: f.tel }, shipping: { zoneId: f.zoneId, address: f.adresse, landmark: f.repere }, note: f.note,
      items: aCommander.value.map(({ productId, color, size, qty }) => ({ productId, color, size, qty })),
      discountCode: f.remise ? f.remise.code : '', payment: { method: f.methode, phone: telDebite }, total: devis.total,
      appareil: jetonAppareil()
    };
    mesurerEvenement('add_payment_info', { value: devis.total, currency: 'USD', payment_type: moyen.label });
    try {
      const r = await requete('sokoyetu/commander', { method: 'POST', corps, delai: 45000 });
      suivreCommande(r.id, f.jeton); recevoirCommande(r.id, r.order);
      enregistrerProfil({ name: R.valider.nom(f.nom), phone: R.valider.telephone(f.tel), zoneId: f.zoneId, address: f.adresse, landmark: f.repere, payMethod: f.methode, payPhone: R.valider.mobileMoney(telDebite) });
      retirerCommandes(corps.items); Local.retirer('commandeEnCours');
      naviguer('/paiement/' + r.id, { remplacer: true });
    } catch (err) {
      maj({ envoi: false });
      if (err.status === 400) {
        if (err.champ === 'panier') { panierChange([err.message]); return; }
        if (err.champ === 'total') { maj({ devis: null }); toast(err.message, { icone: 'alerte', ton: 'danger', duree: 5000 }); return; }
        const etape = CHAMP_ETAPE[err.champ];
        if (etape) { if (etape !== f.etape) allerA(etape); maj({ etape, erreurs: { [err.champ]: err.message } }); montrerErreur(); return; }
        toast(err.message, { icone: 'alerte', ton: 'danger', duree: 5000 }); return;
      }
      connexionCoupee(err);
    }
  }

  function connexionCoupee(err) {
    if (err && err.code === 'limite') { toast(err.message, { icone: 'horloge', ton: 'danger', duree: 5000 }); return; }
    const id = ouvrirFeuille({
      titre: 'Connexion interrompue',
      contenu: () => <div class="pile"><p class="attenue">La demande de paiement n’est peut-être pas partie. Réessayez : votre commande ne sera jamais enregistrée ni payée deux fois.</p></div>,
      pied: () => <button class="btn btn-primaire btn-bloc" onClick={() => { fermerFeuille(id); setTimeout(payer, 300); }}><Icone n="actualiser" />Réessayer</button>
    });
  }

  const suivant = () => {
    if (f.etape === 1) { const e = verifierEtape1(); if (Object.keys(e).length) { maj({ erreurs: e }); setTimeout(() => document.querySelector('.en-erreur input, .en-erreur')?.focus?.(), 30); return; } maj({ devis: null }); allerA(2); }
    else payer();
  };

  const pieces = prixPieces(lignes);
  const recap = (
    <div class="carte">
      <h2 class="carte-titre"><Icone n="recu" />Récapitulatif<span class="fin">{pluriel(lignes.reduce((a, l) => a + l.qty, 0), 'article')}</span></h2>
      <ul class="recap-articles">
        {lignes.map((l) => l.p ? (
          <li key={l.cle}><span class="ra-photo"><Photo m={R.imagePrincipale(l.p)} alt="" tailles="56px" />{l.qty > 1 ? <i>{l.qty}</i> : null}</span><span class="ra-texte"><b>{l.p.title}</b><small>{[l.color, l.size].filter(Boolean).join(' · ')}</small></span><span class="num">{dollars(pieces.get(l.cle).prix * l.qty)}</span></li>
        ) : null)}
      </ul>
      <Montants m={dv} zone={zone && zone.name} libelleTotal={f.etape === 2 ? 'À payer' : 'Total'} />
      {francs(dv.total, c) ? <p class="discret petit droite">{francs(dv.total, c)}</p> : null}
    </div>
  );

  return (
    <>
      <EntetePage titre="Commande" sous={`Étape ${f.etape} sur 3 · ${NOMS_ETAPES[f.etape - 1]}`} repli="/panier" cacherTitreOrdi onRetour={f.etape > 1 ? () => allerA(f.etape - 1) : undefined} />
      <main id="contenu" class="page conteneur page-commande" data-etape={f.etape} ref={haut}>
        <div class="commande-tete"><h1 class="titre-serif seulement-ordi">Finaliser ma commande</h1><Etapes noms={NOMS_ETAPES} actuelle={f.etape} /></div>
        <div class="commande-grille">
          <div class="pile-l" key={f.etape}>
            {f.etape === 1 ? (
              <>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="personne" />Vos coordonnées</h2>
                  {client.value ? <p class="discret petit rangee espace-bas"><Icone n="coche" taille={15} />Connecté : la commande s’ajoute à votre compte ({telephone(client.value.phone) || client.value.phone}).</p> : null}
                  <div class="formulaire">
                    <Champ libelle="Nom complet" erreur={f.erreurs.name}>{(a) => <input class="saisie" {...a} value={f.nom} onInput={champ('nom')} autocomplete="name" maxlength="60" placeholder="Ex. : Grâce Mapendo" />}</Champ>
                    <Champ libelle="Téléphone" erreur={f.erreurs.phone} aide="Le livreur vous appelle à ce numéro.">{(a) => <input class="saisie" {...a} value={f.tel} onInput={champ('tel')} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="099 123 4567" />}</Champ>
                    <div class="pot-de-miel" aria-hidden="true"><label>Ne pas remplir<input id="site-web" tabIndex={-1} autocomplete="off" /></label></div>
                  </div>
                </section>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="camion" />Livraison</h2>
                  <div class="choix-liste" role="radiogroup" aria-label="Zone de livraison">
                    {c.zones.map((z) => <Choix key={z.id} actif={f.zoneId === z.id} onClick={() => maj({ zoneId: z.id, devis: null, erreurs: { ...f.erreurs, zone: '' } })} icone={z.pickup ? 'boutique' : 'camion'} titre={z.name}
                      sous={`${(() => { const v = R.arrondi(R.num(z.fee) + (z.pickup ? 0 : R.num(z.perKg) * R.num(dv.poids))); return v ? dollars(v) : 'Gratuit'; })()}${z.pickup ? ' · à retirer en boutique' : z.days > 1 ? ` · sous ${z.days} jours` : ' · sous 24 h'}`} />)}
                  </div>
                  {f.erreurs.zone ? <p class="champ-erreur"><Icone n="alerte" />{f.erreurs.zone}</p> : null}
                  {retrait ? <Note ton="info" icone="boutique" classe="espace-haut">Vous récupérez votre commande à la boutique de {c.city}. Nous vous appelons dès qu’elle est prête.</Note> : (
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
                {enTest && ouvert ? <NoteModeTest /> : null}
                <section class="carte carte-paiement entree-avant" style={moyen ? { '--op': moyen.color } : undefined}>
                  <h2 class="carte-titre"><Icone n="portefeuille" />Payer par Mobile Money</h2>
                  {ouvert ? (
                    <>
                      <p class="attenue petit intro-paiement">Choisissez votre opérateur : la demande de paiement s’affiche sur votre téléphone et vous la validez avec votre code PIN. La commande est confirmée dès que l’opérateur valide le paiement.</p>
                      <ChoixPaiement ms={ms} methode={f.methode} tel={f.telPaiement} erreurs={f.erreurs} telContact={R.valider.mobileMoney(f.tel) ? f.tel : ''}
                        onMethode={(k) => maj({ methode: k, erreurs: { ...f.erreurs, method: '' } })} onTel={(v) => maj({ telPaiement: v, erreurs: { ...f.erreurs, payphone: '' } })} />
                    </>
                  ) : <Note ton="alerte" icone="horloge">Le paiement en ligne ouvre très bientôt. Gardez votre panier : il vous attend sur ce téléphone.</Note>}
                </section>
                <section class="carte entree-avant">
                  <h2 class="carte-titre"><Icone n="etiquette" />Code promo</h2>
                  <form class="ajout-code" onSubmit={(e) => { e.preventDefault(); appliquerCode(); }}>
                    <Champ erreur={f.erreurs.code} classe="plein">{(a) => <input class="saisie" {...a} aria-label="Code promo" value={f.code} onInput={(e) => maj({ code: e.currentTarget.value.toUpperCase(), erreurs: { ...f.erreurs, code: '' } })} placeholder="Ex. : BIENVENUE10" autocapitalize="characters" maxlength="20" />}</Champ>
                    <button class="btn btn-secondaire" type="submit">Appliquer</button>
                  </form>
                  {f.remise ? <p class="ligne-stock ok espace-haut"><Icone n="coche" />Code {f.remise.code} appliqué{dv.remise ? ` : −${dollars(dv.remise.amount)}` : ''}<button class="lien petit" style={{ marginLeft: 'auto' }} onClick={() => maj({ remise: null, code: '', devis: null })}>Retirer</button></p> : null}
                </section>
                <section class="carte entree-avant">
                  <div class="entre"><h2 class="carte-titre" style={{ margin: 0 }}><Icone n="repere" />{retrait ? 'Retrait' : 'Livraison'}</h2><button class="btn btn-fantome btn-s" onClick={() => allerA(1)}><Icone n="crayon" />Modifier</button></div>
                  <dl class="infos espace-haut"><dt>Nom</dt><dd>{f.nom}</dd><dt>Téléphone</dt><dd>{telephone(R.valider.telephone(f.tel)) || f.tel}</dd><dt>Zone</dt><dd>{zone && zone.name}</dd>{!retrait && f.adresse ? <><dt>Adresse</dt><dd>{f.adresse}</dd></> : null}</dl>
                </section>
                <div class="seulement-mobile">{recap}</div>
                {dv.frais ? <p class="discret petit rangee"><Icone n="info" taille={15} />Les frais de service ({R.num(dv.fraisPct)} % du panier) sont ajoutés au paiement : ils couvrent le paiement sécurisé et le suivi de votre commande.</p> : null}
                <section class={classes('carte', f.erreurs.terms && 'en-erreur')}>
                  <CaseACocher coche={f.conditions} onClick={() => maj({ conditions: !f.conditions, erreurs: { ...f.erreurs, terms: '' } })}>
                    J’accepte les <a class="lien" href={lien('/infos/conditions')} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>conditions de vente</a> et la <a class="lien" href={lien('/infos/retours')} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>politique de retours</a>.
                  </CaseACocher>
                  {f.erreurs.terms ? <p class="champ-erreur espace-haut"><Icone n="alerte" />{f.erreurs.terms}</p> : null}
                </section>
                <Note ton="info" icone="bouclier">Paiement sécurisé : vous seul validez le montant sur votre téléphone. Personne ne vous demandera jamais votre code PIN.</Note>
              </>
            ) : null}
          </div>
          <aside class="commande-resume seulement-ordi">
            {recap}
            <button class={classes('btn btn-primaire btn-l btn-bloc espace-haut', f.envoi && 'charge')} onClick={suivant} disabled={f.etape === 2 && !ouvert}>{f.etape === 2 ? <><Icone n="cadenas" />Payer {dollars(dv.total)}</> : 'Continuer'}</button>
            {f.etape > 1 ? <button class="btn btn-fantome btn-bloc" onClick={() => allerA(f.etape - 1)}>Étape précédente</button> : null}
          </aside>
        </div>
      </main>
      <BarreAction>
        <div class="barre-total"><small>{f.etape === 2 ? 'À payer' : 'Total'}</small><span class="prix">{dollars(dv.total)}</span></div>
        <button class={classes('btn btn-primaire btn-l', f.envoi && 'charge')} style={{ flex: 1 }} onClick={suivant} disabled={f.etape === 2 && !ouvert}>{f.etape === 2 ? <><Icone n="cadenas" />Payer</> : 'Continuer'}</button>
      </BarreAction>
    </>
  );
}
