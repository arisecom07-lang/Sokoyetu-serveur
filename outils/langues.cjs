// Sokoyetu — textes de la boutique à traduire, relevés dans le code : t('…'), tx('…'), aTraduire('…'), tn(n, '…', '…')
// et pluriel(n, '…'), plus les textes des règles partagées (statuts, étapes, moyens de paiement…) et les messages du
// serveur que la boutique affiche. Sert au test des langues (tests/langues.test.js) et à la construction.
//   node outils/langues.cjs        → textes sans traduction, par langue
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const LANGUES = ['en', 'sw', 'ln'];
const NOMS = { en: 'anglais', sw: 'swahili', ln: 'lingala' };

function fichiers(dossier) {
  const out = [];
  for (const nom of fs.readdirSync(dossier)) {
    const p = path.join(dossier, nom);
    if (fs.statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.jsx?$/.test(nom)) out.push(p);
  }
  return out;
}
/* Fichiers de la boutique : ceux qui importent langue.js (l'administration reste en français). */
function sources() {
  return [...fichiers(path.join(RACINE, 'src', 'boutique')), ...fichiers(path.join(RACINE, 'src', 'commun', 'js'))]
    .filter((f) => !/[\\/](langue|regles)\.js$/.test(f) && !/[\\/]langues[\\/]/.test(f))
    .filter((f) => /from '[^']*langue\.js'/.test(fs.readFileSync(f, 'utf8')));
}

/* Lit une chaîne JS ('…' ou "…") à la position i : [texte, fin] ou null. */
function chaine(code, i) {
  while (/\s/.test(code[i])) i++;
  const q = code[i];
  if (q !== "'" && q !== '"') return null;
  let s = ''; let j = i + 1;
  for (; j < code.length && code[j] !== q; j++) {
    if (code[j] === '\\') { j++; s += { n: '\n', t: '\t' }[code[j]] || code[j]; } else s += code[j];
  }
  return [s, j + 1];
}
/* Saute une expression jusqu'à la virgule (ou parenthèse fermante) de même niveau : position de cette virgule. */
function finArgument(code, i) {
  let prof = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < code.length && code[i] !== q) { if (code[i] === '\\') i++; i++; } continue; }
    if ('([{'.includes(c)) prof++;
    else if (')]}'.includes(c)) { if (!prof) return i; prof--; }
    else if (c === ',' && !prof) return i;
  }
  return i;
}

/* Textes du code : Map texte → { pluriel, ou: ['fichier:ligne'] } (pluriel : forme française au-delà de 1). */
function textesDuCode() {
  const m = new Map();
  const noter = (cle, pl, ou) => { const x = m.get(cle) || { ou: [] }; if (pl) x.pluriel = pl; x.ou.push(ou); m.set(cle, x); };
  for (const f of sources()) {
    const code = fs.readFileSync(f, 'utf8');
    const ligne = (p) => path.relative(RACINE, f) + ':' + code.slice(0, p).split('\n').length;
    const re = /(?<![\w.$])(t|tx|aTraduire|tn|pluriel)\(/g;
    let x;
    while ((x = re.exec(code))) {
      const debut = x.index + x[0].length;
      if (x[1] === 'tn' || x[1] === 'pluriel') {
        const v = finArgument(code, debut); if (code[v] !== ',') continue;
        const a = chaine(code, v + 1); if (!a) continue;
        let b = null; let j = a[1]; while (/\s/.test(code[j])) j++;
        if (code[j] === ',') b = chaine(code, j + 1);
        if (x[1] === 'tn') { if (b) noter(a[0], b[0], ligne(x.index)); }
        else noter('{n} ' + a[0], '{n} ' + (b ? b[0] : a[0] + 's'), ligne(x.index));
      } else {
        const a = chaine(code, debut); if (a) noter(a[0], '', ligne(x.index));
      }
    }
  }
  return m;
}

/* Textes des règles partagées que la boutique traduit à l'affichage (t(s.label), t(e.titre), t(m.label)…). */
function textesDesRegles() {
  const R = require(path.join(RACINE, 'src', 'commun', 'js', 'regles.js'));
  const l = new Set();
  // Statut d'une commande pour le client, dans tous les cas
  const paiements = ['pending', 'paid', 'failed', 'expired', 'refunded'];
  const etapes = ['', 'unfulfilled', 'preparing', 'shipped', 'delivered'];
  for (const status of ['open', 'cancelled']) for (const p of paiements) for (const f of etapes) for (const retrait of [false, true]) {
    const o = { status, fulfillment: f, payment: { status: p, method: 'mpesa' }, shipping: { pickup: retrait, zoneId: retrait ? 'retrait' : 'bukavu' } };
    try { l.add(R.statutClient(o).label); } catch (e) { }
    try { (R.etapesSuivi(o) || []).forEach((e) => l.add(e.titre)); } catch (e) { }
  }
  // Moyens de paiement : les noms des opérateurs ne se traduisent pas, la carte bancaire si.
  Object.values(R.OPERATEURS).filter((m) => m.carte).forEach((m) => l.add(m.label));
  Object.values(R.MOTIFS_AVIS || {}).forEach((x) => l.add(x));
  // Réglages d'origine de la boutique (slogan, bandeau, échanges, retrait) : traduits tant que la boutique ne les a pas réécrits.
  [R.CONFIG_DEFAUT.tagline, R.CONFIG_DEFAUT.announcement, R.CONFIG_DEFAUT.returns].forEach((x) => l.add(x));
  R.ZONES_DEFAUT.filter((z) => z.pickup).forEach((z) => l.add(z.name));
  // Noms des pages légales (pied de page et titre de la page ; leur texte reste en français)
  const legal = fs.readFileSync(path.join(RACINE, 'src', 'commun', 'js', 'legal.js'), 'utf8');
  for (const x of ((legal.match(/PAGES_LEGALES = \{([\s\S]*?)\};/) || [])[1] || '').matchAll(/:\s*'([^']+)'/g)) l.add(x[1]);
  l.delete(undefined); l.delete('');
  return l;
}

/*
 * Messages du serveur (toujours en français) que la boutique affiche : traduits par traduireMessage, y compris avec des
 * parties variables ({0}, {1}… : prix, nom d'article, opérateur). Seuls ceux qu'un client peut voir.
 */
const MESSAGES_SERVEUR = [
  // Commande et devis (regles.js)
  'Acceptez les conditions de vente pour payer.', 'Indiquez votre nom (2 à 60 lettres).', 'Numéro de téléphone invalide. Exemple : 099 123 4567.',
  'Choisissez une zone de livraison.', 'Indiquez votre adresse de livraison.', 'Votre panier est vide.', 'Trop d’articles dans une seule commande.',
  'Quantité invalide dans le panier.', 'Le paiement en ligne n’est pas encore ouvert. Revenez bientôt.', 'Ce mode de paiement n’est pas disponible. Choisissez-en un autre.',
  'Numéro {0} invalide : 10 chiffres, commençant par 08 ou 09.', 'Le montant à payer est maintenant de {0}. Vérifiez-le avant de payer.',
  '« {0} » n’est plus en vente.', 'Choisissez une couleur disponible pour « {0} ».', 'Choisissez une taille disponible pour « {0} ».', 'Le prix de « {0} » n’est pas disponible.',
  'Plus que {0} exemplaire de « {1} »{2}.', 'Plus que {0} exemplaires de « {1} »{2}.', '« {0} »{1} est épuisé.',
  'Ce code n’est pas valide.', 'Ce code n’est plus valable.', 'Ce code s’applique dès {0} d’achat.',
  'Connectez-vous à votre compte pour recevoir votre cadeau de bienvenue.', 'Le cadeau de bienvenue est réservé à la première commande d’un nouveau client.',
  'Votre lien de parrainage est fait pour vos proches : il ne s’applique pas à vos commandes.', 'Ce lien de parrainage n’est plus valable.',
  'Le cadeau de bienvenue ne se cumule pas avec un code promo.', 'Le cadeau de bienvenue s’applique dès {0} d’achat.',
  // Paiement
  'Vérification impossible. Rechargez la page et réessayez.', 'Jeton de commande invalide. Rechargez la page et réessayez.',
  'Une demande de paiement est déjà en train de partir : regardez votre téléphone.',
  'La demande de paiement vient d’être envoyée : regardez votre téléphone, puis réessayez dans quelques secondes si rien n’arrive.',
  'Ce mode de paiement n’est pas disponible.', 'Page de test indisponible : le paiement par carte passe par la page sécurisée du fournisseur.',
  'Carte refusée (simulation).', 'Paiement par carte annulé.', 'Solde insuffisant (simulation).',
  'Le service de paiement ne répond pas pour le moment. Réessayez dans une minute.', 'Le service de paiement ne répond pas. Réessayez dans un instant.',
  'Paiement momentanément indisponible (configuration du service de paiement).', 'Le paiement par carte n’a pas pu s’ouvrir.',
  'La demande de paiement a été refusée.', 'Carte refusée ou paiement annulé.', 'Paiement refusé ou annulé sur le téléphone.', 'Le paiement en ligne n’est pas encore ouvert.',
  'Cette commande est annulée.', 'Cette commande est déjà payée.', 'Le délai de paiement est dépassé. Repassez votre commande.',
  'Trop de tentatives de paiement pour cette commande. Repassez votre commande.',
  'Indiquez le numéro de commande (6 caractères) et votre numéro de téléphone.', 'Aucune commande ne correspond à ce numéro et à ce téléphone.', 'Commande introuvable.',
  // Compte client
  'Les comptes ne sont pas encore ouverts. Vous pouvez commander sans compte.', 'Numéro invalide. Exemple : 099 123 4567 ou +243 99 123 4567.',
  'Trop de codes demandés pour ce numéro. Réessayez dans quelques heures, ou commandez sans compte.',
  'La connexion aux comptes est momentanément saturée. Réessayez plus tard, ou commandez sans compte.',
  'Numéro invalide.', 'Le code compte {0} chiffres.', 'Ce code a expiré. Demandez-en un nouveau.', 'Trop d’essais avec ce code. Demandez-en un nouveau.',
  'Code incorrect. Demandez un nouveau code.', 'Connectez-vous à votre compte.',
  // Alertes, avis, discussion, notifications
  'Appareil inconnu : rechargez la page.', 'Article introuvable.', 'Cette option n’existe plus : rechargez la page.',
  'Bonne nouvelle : il est de nouveau disponible. Ajoutez-le au panier.', 'Vous attendez déjà {0} articles : retirez-en quelques-uns (Compte → Notifications).',
  'Les avis sont fermés pour le moment.', 'Vous pourrez donner votre avis une fois la commande reçue.', 'Cet article ne fait pas partie de cette commande.',
  'Cet article n’est plus en vente : impossible de le noter.', 'Avis déjà enregistré depuis un autre écran : rechargez la page.', 'Avis introuvable.',
  'Beaucoup de messages d’un coup : attendez la réponse de la boutique, elle vous répond ici.', 'Discussion introuvable.',
  'Service de notification non reconnu.', 'Abonnement invalide.', 'Abonnement inconnu.', 'Rechargez la page et réessayez.'
];

/* Tous les textes à traduire : Map texte → { pluriel, ou }. */
function textes() {
  const m = textesDuCode();
  for (const x of textesDesRegles()) if (!m.has(x)) m.set(x, { ou: ['regles.js'] });
  for (const x of MESSAGES_SERVEUR) if (!m.has(x)) m.set(x, { ou: ['serveur'] });
  return m;
}

/* Dictionnaire d'une langue (src/boutique/langues/en.js…) : { texte français: traduction | [singulier, pluriel] }. */
const dictionnaire = (k) => require(path.join(RACINE, 'src', 'boutique', 'langues', k + '.js'));

/* Textes sans traduction dans une langue. */
const manquants = (k, liste = textes()) => { const d = dictionnaire(k); return [...liste.keys()].filter((x) => !(x in d)); };

module.exports = { LANGUES, NOMS, sources, textesDuCode, textesDesRegles, MESSAGES_SERVEUR, textes, dictionnaire, manquants };

if (require.main === module) {
  const liste = textes();
  console.log(`${liste.size} textes à traduire.`);
  for (const k of LANGUES) {
    let l; try { l = manquants(k, liste); } catch (e) { l = [...liste.keys()]; }
    console.log(`\n${NOMS[k]} : ${l.length ? l.length + ' sans traduction' : 'complet'}`);
    l.forEach((x) => console.log('  ' + JSON.stringify(x) + (liste.get(x).pluriel ? '  (pluriel : ' + JSON.stringify(liste.get(x).pluriel) + ')' : '')));
  }
}
