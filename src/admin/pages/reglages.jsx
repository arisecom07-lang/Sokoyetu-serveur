// Sokoyetu (administration) — réglages de la boutique : identité, paiements, livraison, général, informations légales.
import { useState } from 'preact/hooks';
import R from '../../commun/js/regles.js';
import { Icone } from '../../commun/js/icones.jsx';
import { Champ, LogoOperateur, Note, Bascule, toast, confirmer } from '../../commun/js/interface.jsx';
import { uid, copie, classes, copier } from '../../commun/js/outils.js';
import { PAGES_LEGALES, ANCIENNES_CLES, modeleLegal } from '../../commun/js/legal.js';
import { aller, route, lien } from '../routeur.js';
import { cfg, pret, sauver, gererErreur, chargerExemple, retirerExemples, nbExemples, paiementServeur, etatServeur } from '../etat.js';
import { TetePage, BarreEnregistrer, adresseBoutique } from '../composants/cadre.jsx';
import { Chargement } from './accueil.jsx';
import { useFormulaire } from './catalogue.jsx';

const OUTILS = { ga4: ['Google Analytics 4', /^G-[A-Z0-9]{4,12}$/, 'Identifiant de mesure, ex. G-ABC123XYZ'], plausible: ['Plausible (sans cookie)', /^[a-z0-9.-]+\.[a-z]{2,}$/, 'Votre domaine, ex. sokoyakwetu.com'], goatcounter: ['GoatCounter (sans cookie)', /^[a-z0-9-]{2,40}$/, 'Votre code, ex. sokoyetu'] };
const NOM_FOURNISSEUR = { flexpay: 'FlexPay', simulation: 'le mode test' };
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
    // Fidélité : de 0 à 10 % par commande ; parrainage de 0 à 100 $, l'achat minimum au-dessus du cadeau (sinon l'article serait offert).
    d.loyalty = { enabled: !!(d.loyalty && d.loyalty.enabled), pct: R.num(d.loyalty && d.loyalty.pct) };
    if (d.loyalty.enabled && (d.loyalty.pct < 0 || d.loyalty.pct > 10) && stop('Cagnotte : de 0 à 10 % de chaque commande')) return;
    const pa = d.referral || {};
    d.referral = { enabled: d.loyalty.enabled && !!pa.enabled, welcome: R.arrondi(pa.welcome), reward: R.arrondi(pa.reward), min: R.arrondi(pa.min) };
    if (d.referral.enabled) {
      if ([d.referral.welcome, d.referral.reward].some((v) => !(v >= 0 && v <= 100)) && stop('Parrainage : cadeau et gain de 0 à 100 $')) return;
      if (d.referral.welcome > 0 && !(d.referral.min > d.referral.welcome && d.referral.min <= 1000) && stop('L’achat minimum doit dépasser le cadeau du filleul (jusqu’à 1 000 $)')) return;
    }
    d.zones = (d.zones || []).filter((z) => String(z.name || '').trim()).map((z) => ({ id: z.id || uid(), name: R.nettoyer(z.name, 40), fee: Math.max(0, R.num(z.fee)), days: R.int(z.days), pickup: !!z.pickup, perKg: Math.max(0, R.arrondi(z.perKg)) }));
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
          const fournisseur = R.FOURNISSEURS[ps.fournisseur] ? ps.fournisseur : 'flexpay';
          const proposes = R.FOURNISSEURS[fournisseur].operateurs;
          const reel = ps.pret && ps.fournisseur === 'flexpay';
          const notification = adresseBoutique('/api/sokoyetu/notification/flexpay');
          return (
            <>
              <section class="carte">
                <h2 class="carte-titre"><Icone n="portefeuille" />Encaissement</h2>
                {reel ? <Note ton="ok" icone="coche"><b>Paiement automatique actif (FlexPay).</b> Le client valide sur son téléphone ; la commande se confirme toute seule et l’argent arrive sur votre compte marchand FlexPay.</Note>
                  : ps.pret && ps.test ? <Note ton="alerte" icone="info"><b>Mode test.</b> Les commandes sont confirmées sans argent (refusées si le numéro finit par 0000). N’annoncez pas la boutique dans ce mode.</Note>
                    : <Note ton="danger" icone="alerte"><b>Paiement fermé.</b> La boutique affiche « Le paiement en ligne ouvre très bientôt » et ne prend aucune commande.</Note>}
                {!reel ? (
                  <div class="pile espace-haut">
                    <p class="attenue petit">Pour encaisser : ouvrez un compte marchand FlexPay (vous recevez un code marchand et un jeton d’accès), puis tapez sur le serveur (DigitalOcean → votre Droplet → Console) :</p>
                    <code class="commande-serveur">sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'</code>
                    <p class="attenue petit">Essai sans argent : <code>sudo /opt/sokoyetu/paiement.sh test</code>. Le jeton reste sur le serveur : il n’est jamais enregistré ici ni envoyé aux navigateurs.</p>
                  </div>
                ) : null}
                <div class="a-copier-admin espace-haut">
                  <div><small>Adresse de notification à donner à FlexPay</small><span class="code">{notification}</span></div>
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
                      {!z.pickup ? <Champ libelle="Supplément par kilo ($)" facultatif aide="Ajouté selon le poids des articles (champ « Poids » de chaque produit). 0 : frais fixes.">{(a) => <input class="saisie" {...a} inputmode="decimal" value={z.perKg || ''} placeholder="0" onInput={(e) => zone(i, { perKg: e.currentTarget.value })} />}</Champ> : null}
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
              <h2 class="carte-titre"><Icone n="sac" />Paniers laissés</h2>
              <Bascule actif={f.cartReminder.enabled} onClick={() => maj({ cartReminder: { ...f.cartReminder, enabled: !f.cartReminder.enabled } })} libelle="Rappeler son panier au client"
                sous="Notification gratuite (ni SMS ni WhatsApp), aux clients avec compte, une fois par panier et au plus une fois par semaine" />
              {f.cartReminder.enabled ? <Champ libelle="Envoyé après">{(a) => (
                <select class="saisie" {...a} value={String(f.cartReminder.hours)} onChange={(e) => maj({ cartReminder: { ...f.cartReminder, hours: Number(e.currentTarget.value) } })}>
                  {[6, 12, 24, 48].map((h) => <option key={h} value={String(h)}>{h} heures sans commander</option>)}
                </select>
              )}</Champ> : null}
            </section>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="etoile" />Avis des clients</h2>
              <Bascule actif={f.reviews.enabled} onClick={() => maj({ reviews: { ...f.reviews, enabled: !f.reviews.enabled } })} libelle="Avis et notes sur les articles"
                sous="Seuls les clients qui ont reçu l’article peuvent le noter ; leurs avis s’affichent sur la fiche et la note sur chaque carte" />
              {f.reviews.enabled ? (
                <>
                  <Bascule actif={f.reviews.moderation} onClick={() => maj({ reviews: { ...f.reviews, moderation: !f.reviews.moderation } })} libelle="Vérifier chaque avis avant publication"
                    sous={f.reviews.moderation ? 'Un avis n’apparaît qu’une fois publié par la boutique (page Avis)' : 'Publiés tout de suite ; vous pouvez masquer un avis abusif'} />
                  <Bascule actif={f.reviews.reminder} onClick={() => maj({ reviews: { ...f.reviews, reminder: !f.reviews.reminder } })} libelle="Demander son avis au client"
                    sous="Notification gratuite, une fois par commande, 2 jours après la livraison" />
                </>
              ) : null}
            </section>
            <section class="carte formulaire">
              <h2 class="carte-titre"><Icone n="tirelire" />Fidélité et parrainage</h2>
              {!(etatServeur.value.codes && etatServeur.value.codes.pret) ? <Note ton="info" icone="info">La cagnotte s’utilise avec un compte client : elle apparaît dans la boutique dès que les comptes clients sont ouverts (Plus → Mon compte).</Note> : null}
              <Bascule actif={f.loyalty.enabled} onClick={() => maj({ loyalty: { ...f.loyalty, enabled: !f.loyalty.enabled } })} libelle="Cagnotte de fidélité"
                sous="Chaque commande livrée rapporte au client un pourcentage de ses achats, qu’il utilise sur ses commandes suivantes (jusqu’à la moitié des articles)" />
              {f.loyalty.enabled ? (
                <>
                  <Champ libelle="Gagné sur chaque commande (%)" aide="Des articles payés, versé à la livraison. 0 % : la cagnotte ne sert qu’au parrainage.">{(a) => <input class="saisie" {...a} type="number" inputmode="decimal" min="0" max="10" step="0.5" value={f.loyalty.pct} onInput={(e) => maj({ loyalty: { ...f.loyalty, pct: e.currentTarget.value } })} />}</Champ>
                  <Bascule actif={f.referral.enabled} onClick={() => maj({ referral: { ...f.referral, enabled: !f.referral.enabled } })} libelle="Parrainage"
                    sous="Chaque client a son lien et son code : ses proches reçoivent un cadeau sur leur première commande, et lui gagne dans sa cagnotte quand elle est livrée" />
                  {f.referral.enabled ? (
                    <div class="deux-colonnes">
                      <Champ libelle="Cadeau du filleul ($)" aide="Sur la première commande d’un nouveau compte, sans code promo.">{(a) => <input class="saisie" {...a} inputmode="decimal" value={f.referral.welcome} onInput={(e) => maj({ referral: { ...f.referral, welcome: e.currentTarget.value } })} />}</Champ>
                      <Champ libelle="Dès un achat de ($)" aide="Articles, avant le cadeau.">{(a) => <input class="saisie" {...a} inputmode="decimal" value={f.referral.min} onInput={(e) => maj({ referral: { ...f.referral, min: e.currentTarget.value } })} />}</Champ>
                      <Champ libelle="Gain du parrain ($)" aide="Dans sa cagnotte, quand la commande de son filleul est livrée.">{(a) => <input class="saisie" {...a} inputmode="decimal" value={f.referral.reward} onInput={(e) => maj({ referral: { ...f.referral, reward: e.currentTarget.value } })} />}</Champ>
                    </div>
                  ) : null}
                </>
              ) : null}
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
