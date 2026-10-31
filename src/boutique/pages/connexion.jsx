// Sokoyetu (boutique) — compte client facultatif : créer un compte ou se connecter avec son téléphone, sans mot de passe.
// Un code à 6 chiffres arrive sur WhatsApp (ou par SMS en secours, rempli tout seul sur Android). On peut toujours continuer sans compte.
import { useEffect, useRef, useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Champ, Note, toast } from '../../commun/js/interface.jsx';
import { telephone, classes } from '../../commun/js/outils.js';
import { lien, route, naviguer } from '../routeur.js';
import { cfg, profil, client, connecte, canauxCodes, demanderCode, validerCode, nommerCompte, continuerSansCompte } from '../etat.js';
import { EntetePage, Pied } from '../composants/cadre.jsx';
import { useSeo } from './commun.jsx';

/* Ce que le compte apporte, en trois lignes. */
export function Avantages() {
  return (
    <ul class="avantages-compte">
      <li><span class="menu-icone"><Icone n="recu" /></span><span><b>Vos commandes et reçus</b> sur tous vos appareils</span></li>
      <li><span class="menu-icone"><Icone n="coeur" /></span><span><b>Panier et favoris gardés</b>, même en changeant de téléphone</span></li>
      <li><span class="menu-icone"><Icone n="camion" /></span><span><b>Vos coordonnées retenues</b> : vous commandez en quelques secondes</span></li>
    </ul>
  );
}

/* Adresse de la page de connexion, avec la page où revenir ensuite. */
export const lienConnexion = (retour, extra = {}) => lien('/compte/connexion?' + new URLSearchParams({ retour, ...extra }));

/* Proposition de compte (commande, compte, reçu) : créer un compte, ou continuer sans. */
export function InvitationCompte({ titre, texte, retour, pour, tel, sansCompte, classe }) {
  return (
    <section class={classes('carte invitation-compte', classe)} aria-labelledby="invitation-titre">
      <div class="pile">
        <h2 id="invitation-titre" class="titre-serif">{titre}</h2>
        {texte ? <p class="attenue">{texte}</p> : null}
      </div>
      <Avantages />
      <div class="pile">
        <a class="btn btn-primaire btn-l btn-bloc" href={lienConnexion(retour, { ...(pour ? { pour } : {}), ...(tel ? { tel } : {}) })}><Icone n="personne" />Créer mon compte</a>
        <a class="btn btn-secondaire btn-bloc" href={lienConnexion(retour, { ...(pour ? { pour } : {}), ...(tel ? { tel } : {}), deja: '1' })}>J’ai déjà un compte : me connecter</a>
        {sansCompte ? <button class="btn btn-fantome btn-bloc" onClick={sansCompte}>Continuer sans compte</button> : null}
      </div>
      <p class="discret tres-petit centre"><Icone n="cadenas" taille={14} /> Pas de mot de passe : un code {canauxCodes.value[0] === 'whatsapp' ? 'reçu sur WhatsApp' : 'reçu par SMS'} suffit.</p>
    </section>
  );
}

/* Page de retour : seulement une adresse de la boutique (jamais un autre site). */
function retourSur(q) {
  const r = String((q && q.get('retour')) || '');
  return /^\/(?!\/)[^\s]*$/.test(r) && !/^\/compte\/connexion/.test(r) ? r : '/compte';
}

export function Connexion() {
  const q = route.value.query; const retour = retourSur(q);
  const pourCommande = q.get('pour') === 'commande'; const deja = q.get('deja') === '1';
  const [f, setF] = useState({ canal: canauxCodes.value[0], etape: 'tel', tel: q.get('tel') || profil.value.phone || '', code: '', nom: profil.value.name || '', erreurs: {}, envoi: false, renvoiA: 0, codeTest: '', test: false });
  const [maintenant, setMaintenant] = useState(Date.now());
  const maj = (p) => setF((x) => ({ ...x, ...p }));
  const champCode = useRef(null);
  useSeo(() => ({ titre: deja ? 'Se connecter' : 'Créer un compte', noindex: true }), []);

  // Déjà connecté (lien ouvert deux fois) : on repart tout de suite.
  useEffect(() => { if (connecte.value && f.etape === 'tel') naviguer(retour, { remplacer: true }); }, []);
  // Compte à rebours avant de pouvoir redemander un code.
  useEffect(() => { if (f.etape !== 'code') return undefined; const t = setInterval(() => setMaintenant(Date.now()), 1000); return () => clearInterval(t); }, [f.etape]);
  // Android : le code reçu par SMS se remplit tout seul (WebOTP), sans quitter la page.
  useEffect(() => {
    if (f.etape !== 'code' || f.canal !== 'sms' || typeof window === 'undefined' || !('OTPCredential' in window)) return undefined;
    const ctl = new AbortController();
    navigator.credentials.get({ otp: { transport: ['sms'] }, signal: ctl.signal }).then((o) => { if (o && o.code) { maj({ code: o.code }); valider(o.code); } }).catch(() => { });
    return () => ctl.abort();
  }, [f.etape, f.canal, f.renvoiA]);

  function fin() {
    const c = client.value;
    toast(c && c.name ? `Bienvenue ${String(c.name).split(' ')[0]}, vous êtes connecté` : 'Vous êtes connecté', { icone: 'personne' });
    naviguer(retour, { remplacer: true });
  }

  async function envoyerCode(e, canal) {
    if (e) e.preventDefault();
    if (f.envoi) return;
    const t = R.valider.telephone(f.tel);
    if (!t) { maj({ erreurs: { tel: 'Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.' } }); return; }
    maj({ envoi: true, erreurs: {} });
    try {
      const r = await demanderCode(t, canal || f.canal);
      maj({ etape: 'code', tel: r.telephone, canal: r.canal || 'sms', envoi: false, code: '', renvoiA: Date.now() + r.renvoi * 1000, codeTest: r.code || (r.deja ? f.codeTest : ''), test: !!r.test });
      if (r.deja) toast(`Un code vient déjà de vous être envoyé : regardez ${f.canal === 'whatsapp' ? 'WhatsApp' : 'vos SMS'}`, { icone: 'mobile' });
      else if (canal) toast(canal === 'sms' ? 'Nouveau code envoyé par SMS' : 'Nouveau code envoyé sur WhatsApp', { icone: 'mobile' });
      setTimeout(() => champCode.current && champCode.current.focus(), 60);
    } catch (err) {
      maj({ envoi: false, erreurs: err.champ === 'telephone' ? { tel: err.message } : {} });
      if (err.champ !== 'telephone') toast(err.message, { icone: 'alerte', ton: 'danger', duree: 5000 });
    }
  }

  async function valider(saisi) {
    const code = R.codeConnexion(saisi !== undefined ? saisi : f.code);
    if (!code) { maj({ erreurs: { code: `Saisissez les ${R.CODE_CHIFFRES} chiffres du code reçu.` } }); return; }
    if (f.envoi) return;
    maj({ envoi: true, erreurs: {} });
    try {
      const c = await validerCode(f.tel, code, f.nom);
      if (!c.name) { maj({ etape: 'nom', envoi: false }); return; }
      fin();
    } catch (err) {
      maj({ envoi: false, code: '', erreurs: { code: err.message }, ...(err.expire ? { renvoiA: 0 } : {}) });
    }
  }

  async function enregistrerNom(e) {
    e.preventDefault();
    if (f.envoi) return;
    const n = R.valider.nom(f.nom);
    if (!n) { maj({ erreurs: { nom: 'Indiquez votre nom (2 à 60 lettres).' } }); return; }
    maj({ envoi: true, erreurs: {} });
    try { await nommerCompte(n); fin(); } catch (err) { maj({ envoi: false }); toast(err.message, { icone: 'alerte', ton: 'danger' }); }
  }

  const attente = Math.max(0, Math.ceil((f.renvoiA - Math.max(maintenant, Date.now())) / 1000));
  const whatsapp = f.canal === 'whatsapp'; const parQuoi = whatsapp ? 'sur WhatsApp' : 'par SMS';
  const smsPossible = whatsapp && canauxCodes.value.includes('sms');
  const titre = f.etape === 'nom' ? 'Bienvenue !' : deja ? 'Se connecter' : pourCommande ? 'Créez votre compte et commandez dès maintenant' : 'Créer mon compte';
  return (
    <>
      <EntetePage titre={deja ? 'Se connecter' : 'Créer un compte'} repli={retour} cacherTitreOrdi />
      <main id="contenu" class="page conteneur page-connexion">
        <div class="carte pile-l">
          {f.etape === 'tel' ? (
            <form class="pile-l" onSubmit={envoyerCode} noValidate>
              <div class="pile">
                <h1 class="titre-serif">{titre}</h1>
                <p class="attenue">{deja ? `Saisissez le numéro de votre compte : nous vous envoyons un code ${parQuoi}.` : `Avec votre numéro de téléphone, en 30 secondes. Pas de mot de passe : nous vous envoyons un code ${parQuoi}.`}</p>
              </div>
              {deja ? null : <Avantages />}
              <div class="formulaire">
                <Champ libelle="Votre téléphone" erreur={f.erreurs.tel} aide="Le même numéro que pour vos commandes : elles rejoindront votre compte.">
                  {(a) => <input class="saisie" {...a} value={f.tel} onInput={(e) => maj({ tel: e.currentTarget.value, erreurs: {} })} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="099 123 4567" />}
                </Champ>
              </div>
              <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit"><Icone n={whatsapp ? 'bulle' : 'mobile'} />Recevoir mon code {parQuoi}</button>
              {pourCommande ? <button type="button" class="btn btn-fantome btn-bloc" onClick={() => { continuerSansCompte(); naviguer(retour, { remplacer: true }); }}>Continuer sans compte</button>
                : <a class="btn btn-fantome btn-bloc" href={lien('/')}>Continuer sans compte</a>}
            </form>
          ) : null}

          {f.etape === 'code' ? (
            <form class="pile-l" onSubmit={(e) => { e.preventDefault(); valider(); }} noValidate>
              <div class="pile">
                <h1 class="titre-serif">Code reçu {parQuoi}</h1>
                <p class="attenue">{whatsapp ? <>Ouvrez WhatsApp : le code de {cfg.value.name} est arrivé sur le <b class="num">{telephone(f.tel) || f.tel}</b>. Touchez « Copier le code », puis collez-le ici.</> : <>Saisissez le code envoyé au <b class="num">{telephone(f.tel) || f.tel}</b>.</>} Il est valable 10 minutes.</p>
              </div>
              {f.test ? <Note ton="info" icone="info"><b>Mode test :</b> rien n’est envoyé {parQuoi}. {f.codeTest ? <>Votre code est <b class="code">{f.codeTest}</b>.</> : 'Utilisez le dernier code affiché.'}</Note> : null}
              <div class="formulaire">
                <Champ libelle="Code à 6 chiffres" erreur={f.erreurs.code}>
                  {(a) => <input ref={champCode} class="saisie saisie-code saisie-otp" {...a} value={f.code} type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="••••••"
                    onInput={(e) => { const v = R.chiffres(e.currentTarget.value).slice(0, R.CODE_CHIFFRES); maj({ code: v, erreurs: {} }); if (v.length === R.CODE_CHIFFRES) valider(v); }} />}
                </Champ>
              </div>
              <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit"><Icone n="coche" />Valider</button>
              <div class="pile">
                <button type="button" class="btn btn-secondaire btn-bloc" disabled={attente > 0 || f.envoi} onClick={() => envoyerCode()}><Icone n="actualiser" />{attente > 0 ? `Nouveau code dans ${attente} s` : 'Renvoyer un code'}</button>
                <button type="button" class="btn btn-fantome btn-bloc" onClick={() => maj({ etape: 'tel', code: '', canal: canauxCodes.value[0], erreurs: {} })}><Icone n="crayon" />Changer de numéro</button>
              </div>
              {smsPossible ? <p class="centre petit">Pas de WhatsApp sur ce numéro ? <button type="button" class="lien" disabled={attente > 0 || f.envoi} onClick={() => envoyerCode(null, 'sms')}>{attente > 0 ? `Recevoir le code par SMS (dans ${attente} s)` : 'Recevoir le code par SMS'}</button></p> : null}
            </form>
          ) : null}

          {f.etape === 'nom' ? (
            <form class="pile-l" onSubmit={enregistrerNom} noValidate>
              <div class="pile">
                <h1 class="titre-serif">{titre}</h1>
                <p class="attenue">Votre compte {cfg.value.name} est prêt. Comment vous appelez-vous ? Votre nom figurera sur vos commandes.</p>
              </div>
              <div class="formulaire">
                <Champ libelle="Nom complet" erreur={f.erreurs.nom}>{(a) => <input class="saisie" {...a} value={f.nom} onInput={(e) => maj({ nom: e.currentTarget.value, erreurs: {} })} autocomplete="name" maxlength="60" placeholder="Ex. : Grâce Mapendo" />}</Champ>
              </div>
              <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit">{pourCommande ? 'Continuer ma commande' : 'Continuer'}</button>
              <button type="button" class="btn btn-fantome btn-bloc" onClick={fin}>Plus tard</button>
            </form>
          ) : null}
        </div>
        <p class="discret petit centre espace-haut">En créant un compte, vous acceptez que la boutique garde votre panier, vos favoris et vos coordonnées. Vous pouvez le supprimer à tout moment dans Mon compte. <a class="lien" href={lien('/infos/confidentialite')}>Confidentialité</a></p>
      </main>
      <Pied />
    </>
  );
}
