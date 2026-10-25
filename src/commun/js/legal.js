// Sokoyetu — pages d'information légale : modèles (modifiables dans l'administration) et mise en forme.
import R from './regles.js';
import { telephone } from './outils.js';

export const PAGES_LEGALES = {
  conditions: 'Conditions générales de vente',
  retours: 'Retours et remboursements',
  confidentialite: 'Politique de confidentialité',
  cookies: 'Cookies et données de l’appareil',
  'mentions-legales': 'Informations légales'
};
/* Anciennes clés (version précédente) → nouvelles adresses */
export const ANCIENNES_CLES = { cgv: 'conditions', returns: 'retours', privacy: 'confidentialite', cookies: 'cookies', mentions: 'mentions-legales' };

function contacts(c) {
  const L = c.legal || {};
  return [c.whatsapp && `WhatsApp ${telephone(c.whatsapp) || c.whatsapp}`, L.email && `e-mail ${L.email}`, L.address].filter(Boolean).join(' · ') || 'les coordonnées indiquées dans « Informations légales »';
}

export function modeleLegal(cle, c) {
  const L = c.legal || {}; const qui = L.company || c.name; const ville = c.city || 'Bukavu';
  const moyens = R.moyensDePaiement(c).map((m) => m.label).join(', ') || 'Mobile Money';
  const contact = contacts(c);
  const T = {
    'mentions-legales': [
      '## Éditeur de la boutique',
      [`${qui}${L.company && L.company !== c.name ? ` (enseigne ${c.name})` : ''}`, L.address && `Adresse : ${L.address}`, c.whatsapp && `Téléphone et WhatsApp : ${telephone(c.whatsapp) || c.whatsapp}`, L.email && `E-mail : ${L.email}`, L.rccm && `RCCM : ${L.rccm}`, L.idnat && `Identification nationale : ${L.idnat}`, L.nif && `Numéro d’impôt : ${L.nif}`].filter(Boolean).join('\n'),
      '## Prix',
      'Les prix sont affichés en dollars américains (USD). Les frais de livraison et les frais de service s’y ajoutent et sont indiqués avant le paiement. L’équivalent en francs congolais est donné à titre indicatif au taux du jour ; seul le montant en dollars fait foi.',
      '## Réclamations',
      `Pour toute question ou réclamation : ${contact}. Nous répondons sous 72 heures ouvrables.`
    ],
    conditions: [
      '## 1. Objet',
      `Ces conditions encadrent l’utilisation de la boutique ${c.name} et les ventes conclues avec ${qui}, établi à ${ville}. Passer commande implique de les accepter.`,
      '## 2. Articles',
      `Les articles « en stock » sont expédiés depuis ${ville}. Les articles « Import Chine » sont commandés auprès de nos fournisseurs après votre commande, puis dédouanés par nos soins ; le délai indicatif de livraison est d’environ ${R.int(c.importDays) || 20} jours, affiché sur chaque fiche. Les photos sont aussi fidèles que possible ; de légères différences de teinte peuvent exister.`,
      '## 3. Prix',
      `Prix en dollars américains (USD), frais de dédouanement compris pour les articles importés. L’équivalent en francs congolais est indicatif. Les frais de livraison dépendent de la zone choisie. Des frais de service${R.num(c.serviceFeePct) ? ` de ${R.num(c.serviceFeePct)} %` : ''} du montant des articles (après réduction) s’ajoutent au paiement. Tous ces montants sont affichés avant de payer. Un code promo s’applique selon les conditions indiquées lors de sa saisie.`,
      '## 4. Commande',
      'La commande se fait en trois étapes : coordonnées et livraison, paiement, puis reçu. Vous pouvez vérifier et corriger chaque élément avant de payer. Chaque commande reçoit un numéro unique, inscrit sur le reçu : il permet de la suivre et de la retrouver depuis n’importe quel téléphone.',
      '## 5. Paiement',
      `Le paiement se fait à la commande, par Mobile Money (${moyens}), directement dans l’application. Il n’y a pas de paiement à la livraison. Une demande de paiement est envoyée au numéro que vous indiquez ; vous la validez sur votre téléphone avec votre code PIN. La commande n’est confirmée qu’une fois le paiement validé par l’opérateur ; vous recevez alors un reçu. Sans paiement dans le délai indiqué${R.int(c.payment && c.payment.holdMinutes) ? ` (${R.int(c.payment.holdMinutes)} minutes)` : ''}, la commande est annulée automatiquement. Personne ne vous demandera jamais votre code PIN.`,
      '## 6. Livraison',
      'Les zones, frais et délais indicatifs sont affichés lors de la commande ; la date de livraison prévue figure sur le reçu. Nous vous appelons pour organiser la remise. Merci de vérifier votre colis à la réception.',
      '## 7. Annulation, retours et remboursements',
      'Les conditions d’annulation, de retour et de remboursement sont détaillées dans la page « Retours et remboursements ».',
      '## 8. Conformité',
      'Nous répondons de la conformité des articles livrés et des délais annoncés. Un article défectueux ou non conforme est échangé ou remboursé.',
      '## 9. Données personnelles',
      'Les données nécessaires à votre commande sont traitées comme décrit dans la « Politique de confidentialité ».',
      '## 10. Droit applicable',
      `Ces conditions sont soumises au droit de la République démocratique du Congo. En cas de désaccord, nous cherchons d’abord une solution amiable ; à défaut, les juridictions compétentes de ${ville} peuvent être saisies.`,
      '## 11. Contact',
      contact
    ],
    confidentialite: [
      '## Qui traite vos données',
      `${qui}${L.address ? `, ${L.address}` : `, ${ville}`}. Contact : ${contact}.`,
      '## Données collectées',
      'Uniquement ce qui est nécessaire pour traiter votre commande : votre nom, votre numéro de téléphone, la zone et l’adresse de livraison, un point de repère et une note facultatifs, le numéro Mobile Money qui paie et la référence de la transaction transmise par l’opérateur. Aucun compte, aucun mot de passe et aucune donnée bancaire ne sont demandés. Nous ne collectons jamais votre code PIN.',
      '## Pourquoi',
      'Préparer, livrer et suivre votre commande, vérifier votre paiement, répondre à vos questions et tenir notre comptabilité. Ces traitements sont nécessaires à l’exécution de votre commande et au respect de nos obligations légales.',
      '## Qui y a accès',
      'Seules les personnes chargées de votre commande (préparation et livraison), et notre prestataire de paiement pour le numéro Mobile Money et le montant. Vos données ne sont jamais vendues ni louées. Si vous nous écrivez sur WhatsApp, vos messages transitent par ce service.',
      '## Durée de conservation',
      'Les données de commande sont conservées le temps du suivi et de la garantie, puis archivées pendant la durée exigée par la réglementation comptable (OHADA). Les informations enregistrées sur votre appareil (panier, favoris, coordonnées pré-remplies) y restent jusqu’à ce que vous les effaciez.',
      '## Vos droits',
      `Vous pouvez demander l’accès à vos données, leur correction ou leur suppression, et vous opposer à leur utilisation : ${contact}. Vous pouvez aussi saisir l’autorité de protection des données prévue par le Code du numérique.`,
      '## Messages commerciaux',
      'Nous ne vous envoyons aucun message publicitaire sans votre accord préalable. Vous pouvez retirer cet accord à tout moment, sans frais.',
      '## Sécurité',
      'Connexion chiffrée (HTTPS), accès administrateur protégé, prix et montants recalculés par notre serveur, et collecte limitée au strict nécessaire.',
      '## Fréquentation de la boutique',
      'Notre serveur compte les visites de façon anonyme : combien de personnes sont en ligne, quels articles sont consultés, ajoutés au panier ou aux favoris. Votre appareil n’y est reconnu que par un code tiré au sort, sans nom, téléphone ni adresse IP, et ces compteurs sont effacés au bout de 90 jours. Ils ne quittent jamais la boutique.',
      '## Mesure d’audience',
      'Un outil de statistiques extérieur n’est activé que si vous l’acceptez. Voir « Cookies et données de l’appareil ».'
    ],
    cookies: [
      '## Ce qui est enregistré sur votre appareil',
      'Pour fonctionner, la boutique garde sur votre appareil votre panier, vos favoris, vos coordonnées pré-remplies, vos recherches récentes, les liens de suivi de vos commandes et votre choix concernant la mesure d’audience. Ces informations, strictement nécessaires, ne servent qu’à vous et ne sont pas utilisées pour de la publicité.',
      '## Fréquentation (anonyme)',
      'Un code tiré au sort, gardé sur votre appareil, permet à notre serveur de compter les visiteurs et les articles consultés, mis au panier ou en favori, sans savoir qui vous êtes. Ces compteurs sont effacés au bout de 90 jours. Si vous refusez la mesure d’audience, ou si votre navigateur demande à ne pas être suivi, rien n’est compté.',
      '## Mesure d’audience (facultative)',
      c.analytics && c.analytics.provider ? 'Si vous l’acceptez, un outil de statistiques mesure de façon agrégée les pages consultées et les étapes de commande, pour améliorer la boutique. Sans votre accord, rien n’est chargé.' : 'Aucun outil de statistiques extérieur n’est utilisé actuellement. Si nous en ajoutons un, il ne sera activé qu’avec votre accord.',
      '## Modifier votre choix',
      'Vous pouvez changer d’avis à tout moment avec les boutons ci-dessous, ou effacer toutes les informations enregistrées sur cet appareil.'
    ],
    retours: [
      '## Annuler une commande',
      'Vous pouvez annuler votre commande tant qu’elle n’est pas expédiée, en nous écrivant avec votre numéro de commande. Le remboursement est effectué sous 72 heures sur le numéro Mobile Money qui a payé.',
      '## Échanges',
      c.returns || 'Échange possible sous 7 jours sur les articles non portés, avec leur étiquette.',
      '## Article défectueux ou non conforme',
      'Signalez-le-nous dès que possible, idéalement dans les 48 heures suivant la réception, avec une photo. Nous l’échangeons ou vous remboursons intégralement, frais de retour à notre charge.',
      '## Comment procéder',
      `1. Contactez-nous (${contact}) en indiquant votre numéro de commande.\n2. Nous vous indiquons comment rapporter ou faire récupérer l’article.\n3. Le remboursement est versé par Mobile Money au numéro qui a payé.`
    ]
  };
  return (T[cle] || []).join('\n\n');
}

export function texteLegal(cle, c) {
  const textes = (c.legal && c.legal.texts) || {};
  const ancienne = Object.keys(ANCIENNES_CLES).find((k) => ANCIENNES_CLES[k] === cle);
  const t = textes[cle] || (ancienne && textes[ancienne]);
  return t && String(t).trim() ? t : modeleLegal(cle, c);
}

/* « ## Titre » → titres ; paragraphes séparés par une ligne vide. */
export function blocsLegaux(texte) {
  return String(texte || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .map((b) => (b.startsWith('## ') ? { titre: b.slice(3) } : { lignes: b.split('\n') }));
}
