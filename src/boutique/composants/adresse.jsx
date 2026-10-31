// Sokoyetu (boutique) — adresse de livraison : enregistrée une seule fois (nom, téléphone, ville, commune, quartier, avenue,
// numéro, point de repère), puis utilisée pour toutes les livraisons tant que le client ne la modifie pas.
// Ville, commune et quartier se choisissent dans des listes (Réglages → Livraison dans l'administration) ;
// un quartier absent de la liste s'écrit à la main (« Autre quartier »).
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Champ, toast, fermerFeuille, ouvrirFeuille } from '../../commun/js/interface.jsx';
import { telephone } from '../../commun/js/outils.js';
import { cfg, profil, enregistrerProfil, client } from '../etat.js';

const AUTRE = '__autre__';
export const villesDe = (c) => c.zones.filter((z) => !R.estRetrait(z));

/* Brouillon du formulaire, tiré de l'adresse enregistrée (ou vide). */
export function brouillonAdresse(pf, c) {
  const zone = R.zoneDe(c, pf.zoneId);
  return {
    nom: pf.name || '', tel: pf.phone || '', ville: zone && !R.estRetrait(zone) ? zone.id : (villesDe(c)[0] || {}).id || '',
    commune: pf.commune || '', quartier: pf.quartier || '', autre: false, avenue: pf.avenue || '', numero: pf.numero || '', repere: pf.landmark || ''
  };
}

/* Erreurs du formulaire ; avecAdresse : faux pour un retrait en boutique (nom et téléphone suffisent). */
export function verifierAdresse(a, c, avecAdresse = true) {
  const e = {};
  if (!R.valider.nom(a.nom)) e.name = 'Indiquez votre nom complet (2 à 60 lettres).';
  if (!R.valider.telephone(a.tel)) e.phone = 'Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.';
  if (!avecAdresse) return e;
  const zone = R.zoneDe(c, a.ville);
  if (!zone || R.estRetrait(zone)) e.ville = 'Choisissez votre ville.';
  if (!R.nettoyer(a.commune, 40)) e.commune = 'Choisissez votre commune.';
  if (!R.nettoyer(a.quartier, 40)) e.quartier = a.autre ? 'Écrivez le nom de votre quartier.' : 'Choisissez votre quartier.';
  if (R.nettoyer(a.avenue, 80).length < 2) e.avenue = 'Indiquez votre avenue ou votre rue.';
  return e;
}

/* L'adresse du formulaire, telle qu'elle est enregistrée (profil de l'appareil et du compte). */
export function profilDepuis(a) {
  const lieu = { zoneId: a.ville, commune: a.commune, quartier: a.quartier, avenue: a.avenue, numero: a.numero, landmark: a.repere };
  return { name: R.valider.nom(a.nom), phone: R.valider.telephone(a.tel), ...R.champsAdresse(lieu), address: R.adresseTexte(lieu) };
}

/* Le formulaire : nom, téléphone, puis ville → commune → quartier en listes, avenue, numéro, repère. */
export function FormulaireAdresse({ a, maj, erreurs = {}, avecAdresse = true }) {
  const c = cfg.value;
  const zone = R.zoneDe(c, a.ville);
  const communes = R.communesDe(zone);
  const commune = communes.find((x) => x.name === a.commune);
  const quartiers = commune ? commune.quartiers : [];
  // Quartier en liste quand la commune en a une ; « Autre quartier » pour en écrire un autre.
  const enListe = quartiers.length > 0;
  const autre = enListe && (a.autre || (!!a.quartier && quartiers.indexOf(a.quartier) < 0));
  const texte = (k) => (e) => maj({ [k]: e.currentTarget.value });
  return (
    <div class="formulaire formulaire-adresse">
      <Champ libelle="Nom complet" erreur={erreurs.name}>{(x) => <input class="saisie" {...x} value={a.nom} onInput={texte('nom')} autocomplete="name" maxlength="60" placeholder="Ex. : Grâce Mapendo" />}</Champ>
      <Champ libelle="Téléphone" erreur={erreurs.phone} aide="Le livreur vous appelle à ce numéro.">{(x) => <input class="saisie" {...x} value={a.tel} onInput={texte('tel')} type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="099 123 4567" />}</Champ>
      {avecAdresse ? (
        <>
          <div class="deux-colonnes">
            <Champ libelle="Ville" erreur={erreurs.ville}>{(x) => (
              <select class="saisie" {...x} value={a.ville} onChange={(e) => maj({ ville: e.currentTarget.value, commune: '', quartier: '', autre: false })}>
                {villesDe(c).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            )}</Champ>
            <Champ libelle="Commune" erreur={erreurs.commune}>{(x) => (communes.length ? (
              <select class="saisie" {...x} value={a.commune} onChange={(e) => maj({ commune: e.currentTarget.value, quartier: '', autre: false })}>
                <option value="">Choisissez…</option>
                {communes.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
              </select>
            ) : <input class="saisie" {...x} value={a.commune} onInput={texte('commune')} maxlength="40" placeholder="Votre commune" />)}</Champ>
          </div>
          <Champ libelle="Quartier" erreur={autre ? '' : erreurs.quartier}>{(x) => (enListe ? (
            <select class="saisie" {...x} value={autre ? AUTRE : a.quartier} onChange={(e) => { const v = e.currentTarget.value; maj(v === AUTRE ? { autre: true, quartier: '' } : { autre: false, quartier: v }); }}>
              <option value="">Choisissez…</option>
              {quartiers.map((q) => <option key={q} value={q}>{q}</option>)}
              <option value={AUTRE}>Autre quartier…</option>
            </select>
          ) : <input class="saisie" {...x} value={a.quartier} onInput={texte('quartier')} disabled={communes.length > 0 && !a.commune} maxlength="40" placeholder={communes.length > 0 && !a.commune ? 'Choisissez d’abord la commune' : 'Votre quartier'} />)}</Champ>
          {autre ? <Champ libelle="Nom du quartier" erreur={erreurs.quartier}>{(x) => <input class="saisie" {...x} value={a.quartier} onInput={texte('quartier')} maxlength="40" placeholder="Ex. : Nyawera" />}</Champ> : null}
          <div class="ligne-avenue">
            <Champ libelle="Avenue ou rue" erreur={erreurs.avenue}>{(x) => <input class="saisie" {...x} value={a.avenue} onInput={texte('avenue')} autocomplete="address-line1" maxlength="80" placeholder="Ex. : av. Patrice Lumumba" />}</Champ>
            <Champ libelle="Numéro">{(x) => <input class="saisie" {...x} value={a.numero} onInput={texte('numero')} maxlength="12" placeholder="Ex. : 12" />}</Champ>
          </div>
          <Champ libelle="Point de repère" facultatif>{(x) => <input class="saisie" {...x} value={a.repere} onInput={texte('repere')} maxlength="80" placeholder="Ex. : en face de la pharmacie" />}</Champ>
        </>
      ) : null}
    </div>
  );
}

/* L'adresse enregistrée, en quelques lignes (sans adresse : nom et téléphone, pour un retrait en boutique). */
export function ResumeAdresse({ pf, sansAdresse }) {
  const c = cfg.value; const zone = R.zoneDe(c, pf.zoneId);
  return (
    <div class="adresse-texte">
      <b>{pf.name}</b> <span class="discret sans-coupure">· {telephone(pf.phone) || pf.phone}</span>
      {sansAdresse ? null : <p>{R.adresseTexte(pf).replace(/\b([QC])\. /g, '$1.\u00a0')}{zone ? <>, <b>{zone.name}</b></> : null}</p>}
      {!sansAdresse && pf.landmark ? <p class="discret petit">Repère : {pf.landmark}</p> : null}
    </div>
  );
}

/* Mon compte : voir et modifier l'adresse enregistrée, dans une fenêtre. */
function FeuilleAdresse({ onFin }) {
  const c = cfg.value;
  const [a, setA] = useState(() => brouillonAdresse(profil.value, c));
  const [erreurs, setErreurs] = useState({});
  const maj = (p) => { setA((x) => ({ ...x, ...p })); setErreurs({}); };
  const enregistrer = () => {
    const e = verifierAdresse(a, c);
    if (Object.keys(e).length) { setErreurs(e); return; }
    enregistrerProfil(profilDepuis(a)); onFin(); toast('Adresse enregistrée : elle servira pour toutes vos livraisons');
  };
  return (
    <div class="pile">
      <p class="attenue petit">Enregistrée une seule fois, elle sert pour toutes vos livraisons{client.value ? ', sur tous les appareils de votre compte' : ''}. Elle reste la même tant que vous ne la modifiez pas.</p>
      <FormulaireAdresse a={a} maj={maj} erreurs={erreurs} />
      <button type="button" class="btn btn-primaire btn-bloc" onClick={enregistrer}><Icone n="coche" />Enregistrer mon adresse</button>
    </div>
  );
}
export function ouvrirAdresse() {
  const id = ouvrirFeuille({ titre: 'Mon adresse de livraison', contenu: () => <FeuilleAdresse onFin={() => fermerFeuille(id)} /> });
}
