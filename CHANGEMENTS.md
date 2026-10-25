# Sokoyetu — version 2.1 (octobre 2026) : paiement automatique

## Ce qui change pour vous

- **Le client paie dans l'application.** Il choisit son opérateur (M-Pesa, Airtel Money, Orange Money, Afrimoney), indique le numéro à débiter et touche **Payer** ; la demande s'affiche sur son téléphone, il la valide avec son code PIN. Plus de numéro à recopier, plus de code de transaction à saisir, plus de WhatsApp dans l'achat.
- **La commande n'est validée qu'à la confirmation de l'opérateur.** Le serveur interroge FlexPay (agrégateur Mobile Money de la RDC) et ne croit jamais une notification sans la revérifier.
- **Reçu de commande** dès le paiement : numéro unique de 6 caractères, articles, frais, total payé, opérateur, référence de la transaction, date de livraison prévue. À partager ou enregistrer en PDF.
- **Retrouver une commande** depuis n'importe quel téléphone avec son numéro et le téléphone du client (Mon compte → Retrouver une commande).
- **Frais de service de 2 %** ajoutés au panier (après réduction, hors livraison) et affichés avant de payer : ils reviennent à la boutique, réglables de 0 à 20 % dans Réglages → Paiements.
- **Paiement refusé ?** Le client réessaie sur la même commande, avec le même numéro ou un autre opérateur (5 tentatives). **Jamais payé ?** La commande s'annule seule après 30 minutes (réglable) et le stock revient en vente.
- **Administration** : l'alerte sonne à la **commande payée** (plus à la commande commencée) ; plus de paiement à vérifier à la main ; nouveaux filtres « Paiement en cours » et « Non abouties » ; le tableau de bord ne compte que les ventes payées, frais de service inclus dans la marge. Un bouton de secours « Marquer comme payée à la main » reste disponible, avec confirmation.
- **Couleurs de repère (thème clair).** Chaque étape a sa teinte sombre et sobre : Livraison en terre cuite, Paiement en bleu ardoise, Reçu en vert forêt. Les consignes numérotées, le suivi de commande, les étapes de l'import, les rayons et les indicateurs du tableau de bord suivent le même principe. Le thème sombre ne change pas.
- **Alignements et polices soignés.** Les prix des cartes produit restent sur la même ligne, même quand le nom tient sur deux lignes ; les montants s'alignent en colonne ; les chiffres du tableau de bord sont à la même hauteur d'une carte à l'autre ; les boutons de choix sont centrés ; le nom du produit prend la police des titres.
- **Nouveau logo, « le Cabas ».** Le sac de la boutique devient un blason vintage, avec le S en réserve et le point or, suivi du nom et du slogan « Commandez et recevez chez vous » (modifiable dans Réglages → Identité). Il apparaît dans l'en-tête, le pied de page, la bannière d'accueil, l'administration, les icônes de l'application et l'image de partage.
- **Timbre sur le reçu.** Chaque reçu payé porte le sceau de la boutique, comme un tampon encreur, aussi dans le PDF enregistré.
- **Brancher le paiement** : une commande sur le serveur, `sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'` (le jeton reste sur le serveur). Un **mode test** sans argent permet d'essayer tout le parcours.

## Détails techniques

- Nouvelles routes : `paiement/{id}` (état, revérifié auprès du fournisseur), `paiement/{id}/relancer`, `notification/{fournisseur}`, `retrouver` ; tâche chaque minute pour les paiements en cours et les échéances.
- Les commandes ne se modifient plus que par les routes du serveur (règle de mise à jour fermée, même pour l'administration).
- Délai de livraison prévu calculé au moment du paiement (zone + délai d'import le cas échéant).
- Case « J'accepte les conditions » refaite : plus de liens à l'intérieur d'un bouton (accessibilité).
- Tests : 20 tests du serveur (paiement accepté, refusé puis relancé, expiré, notification forgée, numéro retrouvé), parcours complet dans de vrais navigateurs, démo, contrôle d'accessibilité des nouvelles pages en clair et en sombre.

---

# Sokoyetu — version 2.0 (octobre 2026)

Refonte complète, même concept : la boutique d'import Chine → Bukavu / Goma, payée par Mobile Money à la commande, et son administration. Une seule base de code remplace les deux versions qui existaient (l'interface d'essai dans Claude et le paquet serveur, plus ancien).

## Ce qui change pour vous

- **Deux applications vraiment séparées.** La boutique sur `sokoyakwetu.com`, l'administration sur `admin.sokoyakwetu.com`. Plus aucune page d'administration dans le site des clients (l'ancienne `admin.html` renvoie vers le sous-domaine).
- **Ça marche hors de Claude.** L'interface d'essai enregistrait tout dans la mémoire de Claude (`window.claude`) et ne pouvait pas fonctionner sur le vrai site. Tout passe maintenant par le serveur PocketBase.
- **Commandes en direct.** Une commande passée dans la boutique apparaît aussitôt dans l'administration, avec une alerte, un son, le compteur dans le titre et une notification si vous l'activez (Plus → Mon compte).
- **Le client suit sa commande** en direct : paiement confirmé, préparation, en route, livrée. Le lien de suivi est secret et ne montre jamais vos coûts ni vos notes.
- **Nouveau design**, clair par défaut (cacao et ébène sur ivoire), sombre en option ; deux polices hébergées sur le serveur (rapides, sans Google) ; bannière d'accueil centrée avec « Sokoyetu » en grand sur le port à conteneurs, puis la douane et le transit.
- **Tableau de bord** : ventes, commandes, marge estimée, panier moyen, histogramme des ventes par jour (7 ou 30 jours, chiffres aussi en tableau), choses à faire, meilleures ventes, guide « Bien démarrer ».
- **Assistant IA** (facultatif) : une photo de l'article suffit pour rédiger la fiche produit.
- **Démonstration** jouable sans serveur, pour essayer la boutique et l'administration ensemble.
- **Vraies photos Unsplash** dans tout le catalogue d'exemple, choisies une à une sans marque visible : un vrai port à conteneurs avec ses grues en première image de l'accueil, puis le terminal et la route ; les articles présentés seuls ; des personnes africaines pour les rayons mode. Les anciennes photos de mannequins et les images 3D générées sont retirées.
- **Nouveau catalogue d'exemple** sur vos rayons : montres, sacs, bijoux, électronique, mode femme et mode homme (18 articles, dont la batterie externe pour les coupures de courant).

## Défauts corrigés et améliorations

**Paiement et commandes**
- Le paiement à la livraison existait encore dans le code de la boutique (option « cod ») alors qu'il est exclu : retiré partout, y compris des conditions de vente, et refusé par le serveur.
- Le stock n'était déduit que depuis l'administration, au moment où la gérante confirmait, depuis son téléphone : deux commandes simultanées pouvaient vendre le même dernier article. Il est maintenant **réservé par le serveur dès la commande**, en une seule opération, et rendu si la commande est annulée.
- Les étapes de commande (paiement reçu, préparation, expédition, livraison, annulation, remboursement) sont exécutées **par le serveur**, plus par le navigateur de la gérante.
- Si la connexion coupe au moment de valider, le client peut réessayer sans risque : un envoi répété ne crée qu'une seule commande.
- Les commandes passent par une seule entrée du serveur, qui recalcule prix, remise, livraison et total ; elles ne peuvent plus être écrites directement dans la base.
- Si un prix ou le stock change pendant qu'un client paie, la commande est gardée et marquée « point à vérifier » au lieu d'être refusée après paiement.
- Le montant à payer est confirmé par le serveur **avant** que le client n'envoie l'argent.

**Administration**
- Modifier une fiche produit pendant qu'une commande arrive n'écrase plus le stock vendu entre-temps.
- Quitter une fiche avec des modifications non enregistrées demande confirmation.
- Les notifications de commande, qui ne fonctionnaient pas, marchent maintenant (son, notification, compteur).
- Droit à l'effacement : un bouton efface les données personnelles d'un client de toutes ses commandes.

**Boutique**
- Vraies adresses de pages (`/p/123/montre-…`, `/c/montres`) : partage WhatsApp avec image et titre, référencement Google, bouton retour fiable, plan du site automatique.
- Catalogue gardé sur le téléphone et rechargé seulement s'il a changé : ouverture rapide même avec une connexion faible.
- Page hors connexion et bandeau « nouvelle version disponible » de l'application installée.
- Accessibilité : contrastes vérifiés (niveau AA) en clair et en sombre, navigation au clavier, lecteurs d'écran ; aucun défaut relevé par le contrôle automatique (axe-core) sur les pages principales des deux applications.
- Aucun débordement horizontal sur petit écran (vérifié à 360 px).

**Serveur**
- Limites anti-abus par adresse (connexion, commandes, codes promo, devis, assistant IA).
- En-têtes de sécurité (CSP, HSTS), compression, mise en cache des fichiers et des photos.
- Miniatures des photos en plusieurs tailles, photos compressées avant envoi depuis le téléphone.
- Mise à jour possible depuis un fichier déjà sur le serveur ; sauvegardes avant mise à jour réservées à l'administrateur du serveur ; clé de l'assistant IA jamais lisible par le site.

## Vérifications faites

- 15 tests des règles métier et des icônes, 15 tests du serveur sur une base neuve.
- Parcours complet dans de vrais navigateurs sur le vrai serveur : un client commande sur téléphone avec un code promo, la gérante reçoit l'alerte, confirme le paiement, prépare, expédie, livre ; le suivi du client se met à jour à chaque étape ; le stock baisse puis revient à l'annulation.
- Installation, mise à jour, activation de l'IA et changement de mot de passe essayés sur une machine Ubuntu de test (sans DigitalOcean ni nom de domaine réel : le certificat HTTPS n'a pas pu être testé ici).
