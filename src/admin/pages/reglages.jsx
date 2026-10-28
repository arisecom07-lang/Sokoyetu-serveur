// Sokoyetu (administration) — réglages de la boutique : identité, paiements, livraison, général, informations légales.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Champ, LogoOperateur, Note, Bascule, toast, confirmer } from '../../commun/js/interface.jsx';
import { uid, copie, classes, copier } from '../../commun/js/outils.js';
import { PAGES_LEGALES, ANCIENNES_CLES, modeleLegal } from '../../commun/js/legal.js';
import { aller, route, lien } from '../routeur.js';
import { cfg, pret, sauver, gererErreur, chargerExemple, retirerExemples, nbExemples, paiementServeur } from '../etat.js';
import { TetePage, BarreEnregistrer, adresseBoutique } from '../composants/cadre.jsx';
import { Chargement } from './accueil.jsx';
import { useFormulaire } from './catalogue.jsx';

const OUTILS = { ga4: ['Google Analytics 4', /^G-[A-Z0-9]{4,12}$/, 'Identifiant de mesure, ex. G-ABC123XYZ'], plausible: ['Plausible (sans cookie)', /^[a-z0-9.-]+\.[a-z]{2,}$/, 'Votre domaine, ex. sokoyakwetu.com'], goatcounter: ['GoatCounter (sans cookie)', /^[a-z0-9-]{2,40}$/, 'Votre code, ex. sokoyetu'] };
const NOM_FOURNISSEUR = { flexpay: 'FlexPay', nyole: 'nyole', simulation: 'le mode test' };
const TITRES = { boutique: ['Identité de la boutique', 'boutique'], paiements: ['Paiements Mobile Money', 'portefeuille'], livraison: ['Livraison', 'camion'], general: ['Général', 'reglages'], legal: ['Informations légales', 'recu'] };

/* Remet les textes légaux d'origine sous leurs nouvelles clés. */
function textesLegaux(c) {
  const t = { ...((c.legal && c.legal.texts) || {}) };
  for (const [a, n] of Object.entries(ANCIENNES_CLES)) if (t[a] && !t[n]) { t[n] = t[a]; delete t[a]; }
  return t;
}

function Formulaire({ section }) {
  const base = copie(cfg.value); base.legal = { ...base.legal, texts: textesLegaux(base) };
  const { f, maj, modifie, valider } = useFormulaire(base);
  const [occupe, setOccupe] = useState(false);
  const [exemple, setExemple] = useState(false);
  const champ = (k) => (e) => maj({ [k]: e.currentTarget.value });
  const legal = (k) => (e) => maj({ legal: { ...f.legal, [k]: e.currentTarget.value } });
  const pay = (k, cle, v) => maj({ payments: { ...f.payments, [k]: { ...f.payments[k], [cle]: v } } });
  const zone = (i, p) => maj({ zones: f.zones.map((z, j) => (j === i ? { ...z, ...p } : z)) });
  const [titre, icone] = TITRES[section];

  async function enregistrer() {
    const d = copie(f); const stop = (m) => { toast(m, { icone: 'alerte', ton: 'danger', duree: 4000 }); return true; };
    d.name = R.nettoyer(d.name, 28); d.tagline = R.nettoyer(d.tagline, 70); d.announcement = R.nettoyer(d.announcement, 90); d.city = R.nettoyer(d.city, 40) || 'Bukavu'; d.ownerName = R.nettoyer(d.ownerName, 30);
    if (!d.name && stop('Donnez un nom à la boutique')) return;
    d.fxRate = R.num(d.fxRate); if (d.fxRate && (d.fxRate < 100 || d.fxRate > 100000) && stop('Taux de change invalide (1 $ = 100 à 100 000 FC)')) return;
    d.importDays = R.int(d.importDays); if ((d.importDays < 1 || d.importDays > 180) && stop('Délai d’import : entre 1 et 180 jours')) return;
    d.freeShippingOver = R.num(d.freeShippingOver); d.lowStock = R.int(d.lowStock);
    if (String(d.whatsapp || '').trim()) { const w = R.valider.telephone(d.whatsapp); if (!w && stop('Numéro WhatsApp invalide, ex. 0991234567')) return; d.whatsapp = w; } else d.whatsapp = '';
    // Paiement automatique : seulement les opérateurs proposés, les frais de service et le délai pour payer.
    // Le fournisseur et ses clés restent sur le serveur (paiement.sh), jamais dans ces réglages.
    for (const k of Object.keys(R.OPERATEURS)) d.payments[k] = { enabled: !!(d.payments[k] && d.payments[k].enabled) };
    if (section === 'paiements' && !Object.keys(R.OPERATEURS).some((k) => d.payments[k].enabled) && stop('Gardez au moins un opérateur actif')) return;
    d.serviceFeePct = R.num(d.serviceFeePct); if ((d.serviceFeePct < 0 || d.serviceFeePct > 20) && stop('Frais de service : entre 0 et 20 %')) return;
    const delai = R.int(d.payment && d.payment.holdMinutes); if ((delai < 5 || delai > 120) && stop('Délai pour payer : entre 5 et 120 minutes')) return;
    d.payment = { holdMinutes: delai };
    d.zones = (d.zones || []).filter((z) => String(z.name || '').trim()).map((z) => ({ id: z.id || uid(), name: R.nettoyer(z.name, 40), fee: Math.max(0, R.num(z.fee)), days: R.int(z.days), pickup: !!z.pickup }));
    if (!d.zones.length && stop('Gardez au moins une zone de livraison')) return;
    for (const k of ['company', 'address', 'rccm', 'idnat', 'nif']) d.legal[k] = R.nettoyer(d.legal[k], k === 'address' ? 140 : 80);
    const em = R.valider.email(d.legal.email); if (em === null && stop('E-mail de contact invalide')) return; d.legal.email = em;
    d.analytics = d.analytics || {};
    if (d.analytics.provider) { const o = OUTILS[d.analytics.provider]; d.analytics.id = String(d.analytics.id || '').trim(); if ((!o || !o[1].test(d.analytics.id)) && stop(`Identifiant invalide. ${o ? o[2] : ''}`)) return; } else d.analytics.id = '';
    const textes = {};
    for (const k of Object.keys(PAGES_LEGALES)) { const t = String((d.legal.texts || {})[k] || '').trim().slice(0, 20000); if (t && t !== modeleLegal(k, d).trim()) textes[k] = t; }
    d.legal.texts = textes;
    if (section === 'legal' || !d.legal.updatedAt) d.legal.updatedAt = Date.now();
    d.setup = { ...(d.setup || {}), ...(section === 'livraison' ? { livraison: true } : {}) };
    setOccupe(true);
    try { await sauver('config', 'store', d); valider(); toast('Réglages enregistrés'); aller('/plus', { remplacer: true, forcer: true }); }
    catch (e) { gererErreur(e); setOccupe(false); }
  }

  return (
    <>
      <TetePage titre={titre} parent="/plus" />
      <div class="formulaire-etroit pile-l">
        {section === 'boutique' ? (
          <section class="carte formulaire">
            <h2 class="carte-titre"><Icone n={icone} />Identité</h2>
            <Champ libelle="Nom de la boutique" aide="Affiché en grand sur la bannière d’accueil.">{(a) => <input class="saisie" {...a} value={f.name} onInput={champ('name')} maxlength="28" />}</Champ>
            <Champ libelle="Slogan">{(a) => <input class="saisie" {...a} value={f.tagline} onInput={champ('tagline')} maxlength="70" />}</Champ>
            <Champ libelle="Bandeau d’annonce" facultatif aide="Affiché tout en haut de l’accueil. Laissez vide pour le masquer.">{(a) => <input class="saisie" {...a} value={f.announcement} onInput={champ('announcement')} maxlength="90" placeholder="Ex. : Livraison offerte dès $50" />}</Champ>
            <div class="deux-colonnes">
              <Champ libelle="Ville de la boutique">{(a) => <input class="saisie" {...a} value={f.city} onInput={champ('city')} maxlength="40" />}</Champ>
              <Champ libelle="Votre prénom" facultatif aide="Pour l’accueil de l’administration.">{(a) => <input class="saisie" {...a} value={f.ownerName} onInput={champ('ownerName')} maxlength="30" />}</Champ>
            </div>
          </section>
        ) : null}

        {section === 'paiements' ? (() => {
          const ps = paiementServeur.value;
          const fournisseur = R.FOURNISSEURS[ps.fournisseur] ? ps.fournisseur : 'nyole';
          const proposes = R.FOURNISSEURS[fournisseur].operateurs;
          const reel = ps.pret && !ps.test && (ps.fournisseur === 'flexpay' || ps.fournisseur === 'nyole');
          const nomService = NOM_FOURNISSEUR[fournisseur === 'simulation' ? 'nyole' : fournisseur];
          const notification = adresseBoutique('/api/sokoyetu/notification/' + (fournisseur === 'simulation' ? 'nyole' : fournisseur));
          return (
            <>
              <section class="carte">
                <h2 class="carte-titre"><Icone n="portefeuille" />Encaissement</h2>
                {reel ? <Note ton="ok" icone="coche"><b>Paiement automatique actif ({nomService}).</b> {fournisseur === 'nyole' ? 'Le client paie sur la page sécurisée de nyole ; la commande se confirme toute seule et l’argent arrive sur votre solde nyole.' : 'Le client valide sur son téléphone ; la commande se confirme toute seule et l’argent arrive sur votre compte marchand FlexPay.'}</Note>
                  : ps.pret && ps.test && fournisseur === 'nyole' ? <Note ton="alerte" icone="info"><b>nyole en mode essai</b> (clé af_test_…). Les paiements sont simulés sur la page de nyole, aucun argent n’est encaissé. N’annoncez pas la boutique dans ce mode.</Note>
                  : ps.pret && ps.test ? <Note ton="alerte" icone="info"><b>Mode test.</b> Les commandes sont confirmées sans argent (refusées si le numéro finit par 0000). N’annoncez pas la boutique dans ce mode.</Note>
                    : <Note ton="danger" icone="alerte"><b>Paiement fermé.</b> La boutique affiche « Le paiement en ligne ouvre très bientôt » et ne prend aucune commande.</Note>}
                {!reel ? (
                  <div class="pile espace-haut">
                    <p class="attenue petit">Pour encaisser avec nyole : copiez votre clé secrète (app.nyole.com → API et journaux), puis tapez sur le serveur (DigitalOcean → votre Droplet → Console) et collez la clé quand elle est demandée :</p>
                    <code class="commande-serveur">sudo /opt/sokoyetu/paiement.sh nyole</code>
                    <p class="attenue petit">Avec FlexPay (code marchand et jeton d’accès) : <code>sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'</code>.</p>
                    <p class="attenue petit">Essai sans argent : <code>sudo /opt/sokoyetu/paiement.sh test</code>, ou une clé nyole d’essai (af_test_…). La clé reste sur le serveur : elle n’est jamais enregistrée ici ni envoyée aux navigateurs.</p>
                  </div>
                ) : null}
                <div class="a-copier-admin espace-haut">
                  <div><small>{fournisseur === 'flexpay' ? 'Adresse de notification à donner à FlexPay' : 'Adresse du webhook à donner à nyole (API et journaux)'}</small><span class="code">{notification}</span></div>
                  <button class="btn btn-secondaire btn-s" onClick={async () => { if (await copier(notification)) toast('Adresse copiée'); }}><Icone n="copier" />Copier</button>
                </div>
              </section>
              <section class="carte formulaire">
                <h2 class="carte-titre"><Icone n="pourcent" />Frais et délai</h2>
                <div class="deux-colonnes">
                  <Champ libelle="Frais de service (%)" aide="Ajoutés au panier (après réduction, hors livraison) au moment de payer. Ils vous reviennent.">{(a) => <input class="saisie" {...a} type="number" inputmode="decimal" min="0" max="20" step="0.5" value={f.serviceFeePct} onInput={champ('serviceFeePct')} />}</Champ>
                  <Champ libelle="Délai pour payer (minutes)" aide="Articles réservés pendant ce délai ; sans paiement, la commande s’annule toute seule.">{(a) => <input class="saisie" {...a} type="number" inputmode="numeric" min="5" max="120" value={f.payment.holdMinutes} onInput={(e) => maj({ payment: { ...f.payment, holdMinutes: e.currentTarget.value } })} />}</Champ>
                </div>
              </section>
              <p class="intertitre">Opérateurs proposés aux clients</p>
              {Object.entries(R.OPERATEURS).map(([k, o]) => {
                const p = f.payments[k] || {}; const possible = proposes.includes(k);
                return (
                  <section key={k} class="carte">
                    <div class="operateur-tete"><LogoOperateur k={k} m={o} taille={44} /><Bascule actif={possible && !!p.enabled} desactive={!possible} onClick={() => pay(k, 'enabled', !p.enabled)} libelle={o.label} sous={!possible ? `Non proposé par ${NOM_FOURNISSEUR[fournisseur]}` : p.enabled ? 'Proposé aux clients' : 'Désactivé'} /></div>
                  </section>
                );
              })}
            </>
          );
        })() : null}

        {section === 'livraison' ? (
          <>
            <section class="carte">
              <h2 class="carte-titre"><Icone n="camion" />Zones de livraison</h2>
              <div class="pile">
                {f.zones.map((z, i) => (
                  <div key={z.id || i} class="zone-carte">
                    <div class="formulaire">
                      <Champ libelle="Nom de la zone">{(a) => <input class="saisie" {...a} value={z.name} onInput={(e) => zone(i, { name: e.currentTarget.value })} maxlength="40" />}</Champ>
                      <div class="deux-colonnes">
                        <Champ libelle="Frais ($)">{(a) => <input class="saisie" {...a} inputmode="decimal" value={z.fee} onInput={(e) => zone(i, { fee: e.currentTarget.value })} />}</Champ>
                        <Champ libelle="Délai (jours)">{(a) => <input class="saisie" {...a} inputmode="numeric" value={z.days} onInput={(e) => zone(i, { days: e.currentTarget.value.replace(/\D/g, '') })} />}</Champ>
                      </div>
                      <Bascule actif={!!z.pickup} onClick={() => zone(i, { pickup: !z.pickup })} libelle="Retrait en boutique" sous="Le client vient chercher sa commande : pas d’adresse demandée" />
                      <button class="btn btn-fantome btn-s" style={{ justifySelf: 'start' }} onClick={() => maj({ zones: f.zones.filter((_, j) => j !== i) })}><Icone n="poubelle" />Retirer la zone</button>
                    </div>
                  </div>
                ))}
              </div>
              <button class="btn btn-doux btn-s espace-haut" onClick={() => maj({ zones: [...f.zones, { id: uid(), name: '', fee: 0, days: 1, pickup: false }] })}><Icone n="plus" />Ajouter une zone</button>
            </section>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="avion" />Délais et seuils</h2>
              <div class="deux-colonnes">
                <Champ libelle="Délai import Chine (jours)">{(a) => <input class="saisie" {...a} inputmode="numeric" value={f.importDays} onInput={champ('importDays')} />}</Champ>
                <Champ libelle="Livraison offerte dès ($)" aide="0 = jamais.">{(a) => <input class="saisie" {...a} inputmode="decimal" value={f.freeShippingOver} onInput={champ('freeShippingOver')} />}</Champ>
              </div>
              <Champ libelle="Alerte stock faible à partir de" aide="Nombre d’articles restants.">{(a) => <input class="saisie" {...a} inputmode="numeric" value={f.lowStock} onInput={champ('lowStock')} />}</Champ>
            </section>
          </>
        ) : null}

        {section === 'general' ? (
          <>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="bulle" />Contact</h2>
              <Champ libelle="Numéro WhatsApp de la boutique" aide="Les clients peuvent vous écrire depuis la boutique et vous envoyer leur commande.">{(a) => <input class="saisie" {...a} type="tel" inputmode="tel" value={f.whatsapp} onInput={champ('whatsapp')} placeholder="Ex. : 0991234567" />}</Champ>
            </section>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="billet" />Devise</h2>
              <Champ libelle="Taux du jour : 1 $ =" aide="En francs congolais, pour afficher l’équivalent indicatif.">{(a) => <div class="saisie-groupe suffixe"><input class="saisie" {...a} inputmode="numeric" value={f.fxRate} onInput={champ('fxRate')} /><span class="suffixe-texte">FC</span></div>}</Champ>
              <Bascule actif={!!f.showCDF} onClick={() => maj({ showCDF: !f.showCDF })} libelle="Afficher l’équivalent en francs congolais" />
            </section>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="echange" />Échanges</h2>
              <Champ libelle="Politique d’échange" aide="Affichée sur chaque fiche article.">{(a) => <textarea class="saisie" {...a} rows="3" value={f.returns} onInput={champ('returns')} maxlength="600" />}</Champ>
            </section>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="graphique" />Mesure d’audience</h2>
              <p class="champ-aide">Chargée seulement si le visiteur l’accepte.</p>
              <Champ libelle="Outil">{(a) => <select class="saisie" {...a} value={f.analytics.provider || ''} onChange={(e) => maj({ analytics: { ...f.analytics, provider: e.currentTarget.value } })}><option value="">Aucun</option>{Object.entries(OUTILS).map(([k, o]) => <option key={k} value={k}>{o[0]}</option>)}</select>}</Champ>
              {f.analytics.provider ? <Champ libelle="Identifiant" aide={OUTILS[f.analytics.provider][2]}>{(a) => <input class="saisie" {...a} value={f.analytics.id || ''} onInput={(e) => maj({ analytics: { ...f.analytics, id: e.currentTarget.value } })} autocapitalize="off" />}</Champ> : null}
            </section>
            <section class="carte">
              <h2 class="carte-titre"><Icone n="calques" />Catalogue d’exemple</h2>
              <p class="attenue petit">18 articles, 6 rayons et 3 bannières pour voir la boutique en action avant d’ajouter les vôtres.</p>
              <div class="rangee-l espace-haut">
                <button class={classes('btn btn-doux btn-s', exemple && 'charge')} onClick={async () => { setExemple(true); try { await chargerExemple(); toast('Catalogue d’exemple chargé'); } catch (e) { gererErreur(e, 'Catalogue d’exemple introuvable'); } setExemple(false); }}><Icone n="envoyer" />Charger les exemples</button>
                {nbExemples.value ? <button class="btn btn-danger btn-s" onClick={async () => { if (!(await confirmer({ titre: `Retirer les ${nbExemples.value} éléments d’exemple ?`, texte: 'Vos propres produits ne sont pas touchés.', ok: 'Retirer', danger: true }))) return; try { await retirerExemples(); toast('Exemples retirés', { icone: 'poubelle' }); } catch (e) { gererErreur(e); } }}><Icone n="poubelle" />Retirer les exemples ({nbExemples.value})</button> : null}
              </div>
            </section>
          </>
        ) : null}

        {section === 'legal' ? (
          <>
            <Note ton="alerte" icone="alerte">Exigées pour un commerce en ligne en RDC (Code du numérique) et affichées dans « Informations légales ». Les modèles ne remplacent pas un avis juridique : faites-les relire avant l’ouverture.</Note>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="recu" />Le commerçant</h2>
              <Champ libelle="Raison sociale ou nom du commerçant">{(a) => <input class="saisie" {...a} value={f.legal.company} onInput={legal('company')} maxlength="80" />}</Champ>
              <Champ libelle="Adresse physique">{(a) => <input class="saisie" {...a} value={f.legal.address} onInput={legal('address')} maxlength="140" placeholder="Ex. : av. Patrice Lumumba n° 12, Ibanda, Bukavu" />}</Champ>
              <Champ libelle="E-mail de contact" facultatif>{(a) => <input class="saisie" {...a} type="email" inputmode="email" value={f.legal.email} onInput={legal('email')} maxlength="120" />}</Champ>
              <div class="deux-colonnes">
                <Champ libelle="N° RCCM">{(a) => <input class="saisie" {...a} value={f.legal.rccm} onInput={legal('rccm')} maxlength="40" placeholder="CD/BKV/RCCM/…" />}</Champ>
                <Champ libelle="Identification nationale">{(a) => <input class="saisie" {...a} value={f.legal.idnat} onInput={legal('idnat')} maxlength="40" />}</Champ>
              </div>
              <Champ libelle="Numéro d’impôt (NIF)" facultatif>{(a) => <input class="saisie" {...a} value={f.legal.nif} onInput={legal('nif')} maxlength="40" />}</Champ>
            </section>
            {Object.entries(PAGES_LEGALES).map(([k, t]) => {
              const texte = f.legal.texts[k] || modeleLegal(k, f);
              return (
                <section key={k} class="carte">
                  <div class="entre"><h2 class="carte-titre" style={{ margin: 0 }}><Icone n="recu" />{t}</h2><a class="lien petit" href={adresseBoutique('/infos/' + k)} target="_blank" rel="noopener">Voir</a></div>
                  <textarea class="saisie texte-long espace-haut" rows="10" value={texte} onInput={(e) => maj({ legal: { ...f.legal, texts: { ...f.legal.texts, [k]: e.currentTarget.value } } })} aria-label={t} />
                  <div class="entre espace-haut"><span class="champ-aide">Les lignes commençant par « ## » deviennent des titres.</span>{f.legal.texts[k] ? <button class="btn btn-fantome btn-s" onClick={() => maj({ legal: { ...f.legal, texts: { ...f.legal.texts, [k]: '' } } })}><Icone n="actualiser" />Rétablir le modèle</button> : null}</div>
                </section>
              );
            })}
          </>
        ) : null}
      </div>
      <BarreEnregistrer modifie={modifie} occupe={occupe} onEnregistrer={enregistrer} onAnnuler={() => aller('/plus')} />
    </>
  );
}

export function Reglages() {
  const section = route.value.segs[1];
  if (!pret.value) return <Chargement />;
  if (!TITRES[section]) { setTimeout(() => aller('/plus', { remplacer: true, forcer: true }), 0); return null; }
  return <Formulaire key={section} section={section} />;
}

export const lienReglages = (s) => lien('/reglages/' + s);
