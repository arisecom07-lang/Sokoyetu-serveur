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
import { t, tx } from '../../commun/js/langue.js';

/* Ce que le compte apporte, en trois lignes. */
export function Avantages() {
  return (
    <ul class="avantages-compte">
      <li><span class="menu-icone"><Icone n="recu" /></span><span>{tx('{0} sur tous vos appareils', [<b>{t('Vos commandes et reçus')}</b>])}</span></li>
      <li><span class="menu-icone"><Icone n="coeur" /></span><span>{tx('{0}, même en changeant de téléphone', [<b>{t('Panier et favoris gardés')}</b>])}</span></li>
      <li><span class="menu-icone"><Icone n="camion" /></span><span>{tx('{0} : vous commandez en quelques secondes', [<b>{t('Vos coordonnées retenues')}</b>])}</span></li>
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
        <a class="btn btn-primaire btn-l btn-bloc" href={lienConnexion(retour, { ...(pour ? { pour } : {}), ...(tel ? { tel } : {}) })}><Icone n="personne" />{t('Créer mon compte')}</a>
        <a class="btn btn-secondaire btn-bloc" href={lienConnexion(retour, { ...(pour ? { pour } : {}), ...(tel ? { tel } : {}), deja: '1' })}>{t('J’ai déjà un compte : me connecter')}</a>
        {sansCompte ? <button class="btn btn-fantome btn-bloc" onClick={sansCompte}>{t('Continuer sans compte')}</button> : null}
      </div>
      <p class="discret tres-petit centre"><Icone n="cadenas" taille={14} />{' '}{tx('Pas de mot de passe : un code {0} suffit.', [canauxCodes.value[0] === 'whatsapp' ? t('reçu sur WhatsApp') : t('reçu par SMS')])}</p>
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
  useSeo(() => ({ titre: deja ? t('Se connecter') : t('Créer un compte'), noindex: true }), []);

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
    toast(c && c.name ? t('Bienvenue {0}, vous êtes connecté', [String(c.name).split(' ')[0]]) : t('Vous êtes connecté'), { icone: 'personne' });
    naviguer(retour, { remplacer: true });
  }

  async function envoyerCode(e, canal) {
    if (e) e.preventDefault();
    if (f.envoi) return;
    const numero = R.valider.telephone(f.tel);
    if (!numero) { maj({ erreurs: { tel: t('Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.') } }); return; }
    maj({ envoi: true, erreurs: {} });
    try {
      const r = await demanderCode(numero, canal || f.canal);
      maj({ etape: 'code', tel: r.telephone, canal: r.canal || 'sms', envoi: false, code: '', renvoiA: Date.now() + r.renvoi * 1000, codeTest: r.code || (r.deja ? f.codeTest : ''), test: !!r.test });
      if (r.deja) toast(t('Un code vient déjà de vous être envoyé : regardez {0}', [f.canal === 'whatsapp' ? 'WhatsApp' : t('vos SMS')]), { icone: 'mobile' });
      else if (canal) toast(canal === 'sms' ? t('Nouveau code envoyé par SMS') : t('Nouveau code envoyé sur WhatsApp'), { icone: 'mobile' });
      setTimeout(() => champCode.current && champCode.current.focus(), 60);
    } catch (err) {
      maj({ envoi: false, erreurs: err.champ === 'telephone' ? { tel: err.message } : {} });
      if (err.champ !== 'telephone') toast(err.message, { icone: 'alerte', ton: 'danger', duree: 5000 });
    }
  }

  async function valider(saisi) {
    const code = R.codeConnexion(saisi !== undefined ? saisi : f.code);
    if (!code) { maj({ erreurs: { code: t('Saisissez les {0} chiffres du code reçu.', [R.CODE_CHIFFRES]) } }); return; }
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
    if (!n) { maj({ erreurs: { nom: t('Indiquez votre nom (2 à 60 lettres).') } }); return; }
    maj({ envoi: true, erreurs: {} });
    try { await nommerCompte(n); fin(); } catch (err) { maj({ envoi: false }); toast(err.message, { icone: 'alerte', ton: 'danger' }); }
  }

  const attente = Math.max(0, Math.ceil((f.renvoiA - Math.max(maintenant, Date.now())) / 1000));
  const whatsapp = f.canal === 'whatsapp'; const parQuoi = whatsapp ? t('sur WhatsApp') : t('par SMS');
  const smsPossible = whatsapp && canauxCodes.value.includes('sms');
  const titre = f.etape === 'nom' ? t('Bienvenue !') : deja ? t('Se connecter') : pourCommande ? t('Créez votre compte et commandez dès maintenant') : t('Créer mon compte');
  return (
    <>
      <EntetePage titre={deja ? t('Se connecter') : t('Créer un compte')} repli={retour} cacherTitreOrdi />
      <main id="contenu" class="page conteneur page-connexion">
        <div class="carte pile-l">
          {f.etape === 'tel' ? (
            <form class="pile-l" onSubmit={envoyerCode} noValidate>
              <div class="pile">
                <h1 class="titre-serif">{titre}</h1>
                <p class="attenue">{deja ? t('Saisissez le numéro de votre compte : nous vous envoyons un code {0}.', [parQuoi]) : t('Avec votre numéro de téléphone, en 30 secondes. Pas de mot de passe : nous vous envoyons un code {0}.', [parQuoi])}</p>
              </div>
              {deja ? null : <Avantages />}
              <div class="formulaire">
                <Champ libelle={t('Votre téléphone')} erreur={f.erreurs.tel} aide={t('Le même numéro que pour vos commandes : elles rejoindront votre compte.')}>
                  {(a) => <input class="saisie" {...a} value={f.tel} onInput={(e) => maj({ tel: e.currentTarget.value, erreurs: {} })} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="099 123 4567" />}
                </Champ>
              </div>
              <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit"><Icone n={whatsapp ? 'bulle' : 'mobile'} />{tx('Recevoir mon code {0}', [parQuoi])}</button>
              {pourCommande ? <button type="button" class="btn btn-fantome btn-bloc" onClick={() => { continuerSansCompte(); naviguer(retour, { remplacer: true }); }}>{t('Continuer sans compte')}</button>
                : <a class="btn btn-fantome btn-bloc" href={lien('/')}>{t('Continuer sans compte')}</a>}
            </form>
          ) : null}

          {f.etape === 'code' ? (
            <form class="pile-l" onSubmit={(e) => { e.preventDefault(); valider(); }} noValidate>
              <div class="pile">
                <h1 class="titre-serif">{tx('Code reçu {0}', [parQuoi])}</h1>
                <p class="attenue">{whatsapp ? <>{tx('Ouvrez WhatsApp : le code de {0} est arrivé sur le {1}. Touchez « Copier le code », puis collez-le ici.', [cfg.value.name, <b class="num">{telephone(f.tel) || f.tel}</b>])}</> : <>{tx('Saisissez le code envoyé au {0}.', [<b class="num">{telephone(f.tel) || f.tel}</b>])}</>}{' '}{t('Il est valable 10 minutes.')}</p>
              </div>
              {f.test ? <Note ton="info" icone="info">{tx('{0} rien n’est envoyé {1}.', [<b>{t('Mode test :')}</b>, parQuoi])}{' '}{f.codeTest ? <>{tx('Votre code est {0}.', [<b class="code">{f.codeTest}</b>])}</> : t('Utilisez le dernier code affiché.')}</Note> : null}
              <div class="formulaire">
                <Champ libelle={t('Code à 6 chiffres')} erreur={f.erreurs.code}>
                  {(a) => <input ref={champCode} class="saisie saisie-code saisie-otp" {...a} value={f.code} type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="••••••"
                    onInput={(e) => { const v = R.chiffres(e.currentTarget.value).slice(0, R.CODE_CHIFFRES); maj({ code: v, erreurs: {} }); if (v.length === R.CODE_CHIFFRES) valider(v); }} />}
                </Champ>
              </div>
              <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit"><Icone n="coche" />{t('Valider')}</button>
              <div class="pile">
                <button type="button" class="btn btn-secondaire btn-bloc" disabled={attente > 0 || f.envoi} onClick={() => envoyerCode()}><Icone n="actualiser" />{attente > 0 ? t('Nouveau code dans {0} s', [attente]) : t('Renvoyer un code')}</button>
                <button type="button" class="btn btn-fantome btn-bloc" onClick={() => maj({ etape: 'tel', code: '', canal: canauxCodes.value[0], erreurs: {} })}><Icone n="crayon" />{t('Changer de numéro')}</button>
              </div>
              {smsPossible ? <p class="centre petit">{t('Pas de WhatsApp sur ce numéro ?')}{' '}<button type="button" class="lien" disabled={attente > 0 || f.envoi} onClick={() => envoyerCode(null, 'sms')}>{attente > 0 ? t('Recevoir le code par SMS (dans {0} s)', [attente]) : t('Recevoir le code par SMS')}</button></p> : null}
            </form>
          ) : null}

          {f.etape === 'nom' ? (
            <form class="pile-l" onSubmit={enregistrerNom} noValidate>
              <div class="pile">
                <h1 class="titre-serif">{titre}</h1>
                <p class="attenue">{tx('Votre compte {0} est prêt. Comment vous appelez-vous ? Votre nom figurera sur vos commandes.', [cfg.value.name])}</p>
              </div>
              <div class="formulaire">
                <Champ libelle={t('Nom complet')} erreur={f.erreurs.nom}>{(a) => <input class="saisie" {...a} value={f.nom} onInput={(e) => maj({ nom: e.currentTarget.value, erreurs: {} })} autocomplete="name" maxlength="60" placeholder={t('Ex. : Grâce Mapendo')} />}</Champ>
              </div>
              <button class={classes('btn btn-primaire btn-l btn-bloc', f.envoi && 'charge')} type="submit">{pourCommande ? t('Continuer ma commande') : t('Continuer')}</button>
              <button type="button" class="btn btn-fantome btn-bloc" onClick={fin}>{t('Plus tard')}</button>
            </form>
          ) : null}
        </div>
        <p class="discret petit centre espace-haut">{tx('En créant un compte, vous acceptez que la boutique garde votre panier, vos favoris et vos coordonnées. Vous pouvez le supprimer à tout moment dans Mon compte. {0}', [<a class="lien" href={lien('/infos/confidentialite')}>{t('Confidentialité')}</a>])}</p>
      </main>
      <Pied />
    </>
  );
}
