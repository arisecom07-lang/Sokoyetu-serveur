# Sokoyetu 2.3.1 — accueil plus compact et soigné sur téléphone (octobre 2026)

## Ce qui change pour vous

- **Les quatre étapes** (Commande, Paiement, Import, Livraison) sont désormais **quatre petites tuiles en 2 × 2**, avec une petite icône colorée, un mot et un détail court, au lieu de grandes cartes qui défilaient. « Comment ça marche » ouvre l'explication complète.
- **Bandeau du haut sur une seule ligne**, même sur les petits téléphones.
- **Bannière d'accueil resserrée** sur téléphone : les étapes apparaissent dès le premier écran.
- **Titres de section** à la même taille et sans débordement ; sélecteur **Pour vous / Nouveautés / Promos** en trois parts égales, sur toute la largeur.
- Vérifié de 320 à 412 pixels de large, en thème clair et sombre, sans aucun texte coupé ni débordement.

## Détails techniques

- `ETAPES_IMPORT` (cadre.jsx) : titre et détail courts en plus ; classe `.etapes-accueil` (boutique.css, couleurs dans couleurs.css). Les anciennes retouches `.etapes-import` (qui imposaient 4 colonnes jusque dans la fenêtre « Comment ça marche ») sont retirées.
- Bloc « Téléphone » (`max-width: 899.98px`) dans boutique.css : bannière, titres, sélecteur `.puces-egales`.

---

# Sokoyetu 2.3 — un site solide : coupures, erreurs, double paiement, surveillance et sauvegardes (octobre 2026)

## Ce qui change pour vous

- **Plus jamais d'écran blanc ni de chargement sans fin.** Si une page plante, un écran clair propose « Recharger la page » (panier et commandes gardés) et l'erreur vous est signalée automatiquement. Connexion très lente au démarrage : au bout de 15 secondes, un message et « Réessayer ». Catalogue ou administration qui ne se chargent pas : message, bouton « Réessayer », et nouvel essai tout seul quand la connexion revient. Une coupure ne vide jamais une liste : les données déjà affichées restent.
- **Un seul paiement, une seule commande.** Toucher deux fois « Payer » ou « Renvoyer la demande » ne fait rien de plus. Si un client paie deux fois la même commande, l'administration l'annonce aussitôt (« Commande payée deux fois : remboursez le client »), la commande apparaît dans **Points à vérifier** avec le montant à renvoyer, et le bouton **Double paiement remboursé** le note une fois fait.
- **Plus → Santé et journal** (nouveau) : état du serveur, sauvegarde de la nuit et sa vérification, paiement, assistant IA (appels du jour), erreurs des 30 derniers jours (serveur, boutique, administration) avec « Copier le détail ». Un problème grave s'affiche aussi en haut du tableau de bord.
- **Être prévenu si le site tombe** : avec un compte gratuit Healthchecks.io et `sudo /opt/sokoyetu/alerte.sh https://hc-ping.com/VOTRE-ID`, vous recevez un e-mail ou un message Telegram si le serveur s'arrête, si une sauvegarde manque ou ne se restaure pas, si le paiement ne répond plus depuis 15 minutes, ou en cas de série d'erreurs.
- **Sauvegardes vérifiées chaque dimanche** (restaurées à part, base contrôlée). `sauvegarde.sh` : `liste`, `maintenant`, `verifier`, `restaurer` (voir LISEZMOI, section 9).
- **Dépenses de l'assistant IA plafonnées** : 150 appels par jour au plus (`ia.sh plafond 200` pour changer). Fixez aussi une limite mensuelle sur console.anthropic.com. Crédit épuisé ou limite atteinte : message clair au lieu d'une erreur.
- **Plus rapide quand beaucoup de visiteurs arrivent ensemble** (après une publicité, un message WhatsApp groupé) : le catalogue est préparé une fois et servi à tous. Essai : 80 visiteurs en même temps, du catalogue au paiement confirmé, sans une erreur ; 25 clients sur le dernier exemplaire : un seul l'obtient.
- **Longues listes en pages** dans l'administration (commandes, clients, produits, historique, journal : 50 lignes puis « Afficher plus »).
- Messages en français pour tous les refus du serveur (envoi trop lourd, trop de demandes…). Photos de 10 Mo au plus.
- Accessibilité : le slogan du pied de page est lisible en thème sombre ; le lien d'accueil annonce ce qui est écrit.
- Aussi dans cette version : le **design de l'Atelier** (coins plus arrondis, retouches de l'accueil, du choix du compte, de la commande et du reçu), des **animations plus fluides** (pages, fenêtres, messages, panier) et les **photos cadrées par l'assistant** (ci-dessous).

## À faire une fois sur le serveur (facultatif mais recommandé)

1. `sudo /opt/sokoyetu/mise-a-jour.sh` (installe aussi la vérification des sauvegardes du dimanche).
2. Brancher l'alerte : `sudo /opt/sokoyetu/alerte.sh https://hc-ping.com/VOTRE-ID`, puis `sudo /opt/sokoyetu/alerte.sh test`.
3. Si l'assistant IA est activé : limite de dépense mensuelle sur console.anthropic.com (Settings → Limits).

## Détails techniques

- Migration `1793500000_sokoyetu_robustesse.js` : index `idx_orders_token` (unique partiel), `idx_orders_created`, `idx_orders_updated`, `idx_products_active` ; table `sokoyetu_compteurs` (compteurs du jour) ; limites des routes erreur, santé, journal, pages `/p/` `/c/` et photos `/api/files/` ; journal 30 jours au niveau avertissement ; alerte e-mail « nouvel appareil » coupée tant qu'aucun SMTP n'est réglé.
- Serveur : `lib/journal.js` (signalement, lecture, santé, veille), `S.trace`, limites de taille par route, disjoncteur FlexPay, `paidId` / `duplicates` / action `doublon`, verrou de relance, tournée des paiements unique, catalogue en mémoire (`catalogueChange`), gzip retiré des médias et des lectures `Range`, plafond IA (`quota`, `daily_limit`, `no_credit`).
- Navigateur : `erreurs.jsx` (`Garde`, `signalerErreur`, `surveillerErreurs`), `requete` (GET retentés, envois jamais), `useParPage` / `AfficherPlus`, page `#/journal`, `demarrer` / `erreurChargement` dans l'admin, verrous synchrones sur « Payer » et « Renvoyer la demande », service workers sans `Range` ni vidéos.
- Scripts : `sauvegarde.sh`, `alerte.sh`, `ia.sh plafond`, minuterie `sokoyetu-sauvegarde` (service.sh). Tests : `tests/charge.mjs`, `tests/sauvegarde.mjs`, nouveaux cas dans `tests/serveur.test.mjs` (double appui, double paiement, relance simultanée, surveillance, limites).

---

# Sokoyetu — photos produits cadrées par l'assistant IA (octobre 2026)

## Ce qui change pour vous

- **Chaque photo ajoutée à une fiche est retouchée automatiquement** quand l'assistant IA est activé : l'assistant (Claude, le même que pour les fiches) repère l'article sur la photo, puis l'administration la recadre au format de la boutique (4:5), l'article **centré et en grand**, et corrige la lumière (fond plus clair, contraste, couleurs un peu plus vives). Une photo prise de loin, de travers ou trop sombre ressort comme les photos de la démo.
- Avec **« Choisir une photo »** de l'assistant, un seul appel fait tout : la fiche est rédigée et la photo cadrée.
- **La photo d'origine est toujours gardée** : le bouton ✦ sur chaque photo passe de la version retouchée à l'originale et inversement.
- Les photos déjà en ligne peuvent être cadrées une par une avec le même bouton ✦ (« Cadrer avec l'assistant »).
- Le cadrage se coupe dans la carte Photos (« Cadrage automatique par l'assistant »), le choix est retenu sur l'appareil.
- Aucun nouveau service ni nouvelle clé : la retouche se fait dans le navigateur. Limite : le fond d'origine est conservé (l'assistant ne dessine pas de nouveau fond).

## Détails techniques

- `lib/ia.js` : le schéma de la fiche demande aussi `cadre` `{ gauche, haut, droite, bas }` en millièmes (`nettoyerCadre` : ordre, bornes, refus sous 3 %) ; nouvelle fonction `cadre` et route `POST /api/sokoyetu/ia/cadre` (administration, limite `/api/sokoyetu/ia/` existante). Appel à l'API factorisé (`appeler`) ; `ANTHROPIC_URL` pour un faux service en essai (`tests/claude-simule.mjs`).
- `src/admin/cadrage.js` : `calculerCadrage` (marge 9 %, zoom limité, le cadre glisse dans la photo avant d'ajouter du fond), `tableLumiere` (niveaux auto, gain ≤ ×1,55, gamma doux), `cadrerPhoto` (canvas, fond = médiane du pourtour avec fondu, WebP 1600 px au plus).
- Image de la fiche : `{ type, id, f, w, h, orig }` quand elle est retouchée, `{ …, retouche }` quand l'originale est choisie. Tests : `tests/cadrage.test.js`.

---

# Sokoyetu — ajout des produits comme sur Shein et Temu (octobre 2026)

## Ce qui change pour vous

- **Importer depuis un lien** (fiche « Nouveau produit ») : collez le lien d'un article sur 1688, Alibaba, AliExpress, Taobao, Tmall, Temu, Shein, Made-in-China ou DHgate. Les photos sont copiées sur votre serveur, le prix d'usine est noté (jamais visible des clients) et, si l'assistant IA est activé, la fiche est rédigée en français. Ces sites demandent parfois une connexion : la page ne peut alors pas être lue, et le message propose la photo + l'assistant.
- **Importer en masse** (Produits → Importer) : un tableau Excel (.xlsx) ou CSV, ou des cellules copiées depuis Google Sheets (modèle à télécharger), jusqu'à 300 produits ; ou jusqu'à 30 liens fournisseurs d'un coup, avec le prix de vente proposé (prix d'usine ÷ taux du yuan × coefficient), en brouillon par défaut.
- **Prix par variante** : une colonne Prix à côté du stock (ex. XL plus cher). Vide = prix de l'article. La boutique affiche « dès $… ».
- **Prix de gros** : jusqu'à 4 paliers (« dès 3 pièces −5 % »), toutes couleurs et tailles confondues, affichés sur la fiche.
- **Vente flash** : réduction en %, début et fin ; compte à rebours sur la fiche et la carte, retour au prix normal tout seul.
- **Guide des tailles** en centimètres (Poitrine, Longueur, Pointure…), ouvert depuis « Guide des tailles » sur la fiche.
- **Vidéo** : une courte vidéo MP4 (30 Mo, 1 min 30 au plus) placée juste après la photo principale.
- **Poids et dimensions** : affichés dans les caractéristiques ; chaque zone de livraison peut ajouter un **supplément par kilo** (Réglages → Livraison).

## Détails techniques

- `regles.js` : `prixVariante`, `venteFlash`, `paliersGros`, `prixUnitaire`, `prixAffiche`, `poidsDe` ; `devis` calcule le prix de chaque ligne (palier sur toutes les pièces de l'article), `basePrice`/`flash`/`wholesale` sur la ligne, `poids` et `zone.perKg`. Le serveur reste seul juge du prix.
- Champs produit : `variantPrices`, `wholesale`, `flash`, `sizeGuide`, `weight`, `dims`, `video`, `supplier` (retiré pour les visiteurs par `produitPublic`).
- `pb_hooks/lib/import.js` + routes `POST /api/sokoyetu/import/lien` et `/import/photo` (administration seulement ; adresses du réseau local refusées). `ia.js` accepte une photo par adresse et le texte de la page.
- Migration `1793400000_sokoyetu_produits.js` : vidéos MP4/WebM/MOV dans `media` (30 Mo), limites anti-abus des routes d'import. CSP de l'admin : `media-src 'self' blob:`.
- Admin : `pages/produits-plus.jsx`, `pages/importer.jsx` (lecture .xlsx dans le navigateur via `DecompressionStream`). Tests : `tests/import.test.js`, nouveaux cas dans `tests/regles.test.js`.

---

# Sokoyetu — panier : choisir les articles à commander (octobre 2026)

## Ce qui change pour vous

- **Une case à cocher à gauche de chaque article du panier.** Le client coche ce qu'il commande maintenant : le sous-total, les frais de service, le total et la commande ne portent que sur les articles cochés. Les articles décochés **restent dans le panier** (grisés, « Reste dans le panier pour plus tard »).
- **Tout sélectionner** en haut de la liste, et quand le panier mélange les deux provenances, deux boutons : **En stock à Bukavu** (24–48 h) et **Import Chine** — pour payer tout de suite ce qui est sur place et commander l'import plus tard, ou l'inverse.
- Le bouton indique combien d'articles partent : « Commander 3 articles », « Commander (3) » sur téléphone. Rien de coché : le bouton est désactivé avec un rappel.
- Après le paiement, seuls les articles commandés quittent le panier ; ceux qui restent sont cochés de nouveau pour la prochaine commande. Un article ajouté au panier est toujours coché d'office.

## Détails techniques

- `etat.js` : signal `decoches` (lignes décochées, gardées sur l'appareil dans `panierDecoches`, pas dans le compte), `aCommander`, `lignesACommander`, `nbACommander`, `cocherLigne`, `cocherSeulement`, `retirerCommandes` (remplace `viderPanier` après une commande). Le compte client continue de synchroniser le panier entier.
- `devisLocal`, le devis serveur et l'envoi de la commande ne prennent que les lignes cochées ; les problèmes du devis sont rattachés à la ligne par sa clé.
- Couleurs (thème clair) dans `couleurs.css` : cases en vert forêt (`--c3`) ; boutons de provenance aux couleurs de l'accueil (Bukavu vert forêt, import bleu ardoise `--c2`).

---

# Sokoyetu — « En stock à Bukavu » et « Importés de Chine » séparés sur l'accueil (octobre 2026)

## Ce qui change pour vous

- Sur l'accueil, les deux rangées ont chacune **leur bande de couleur** : vert forêt pour « En stock à Bukavu », bleu ardoise pour « Importés de Chine pour vous » (teintes sobres ; en thème sombre, les mêmes repères en version éteinte).
- **Les titres sont des boutons** : « En stock à Bukavu › » ouvre la liste de tous les articles en stock (`/en-stock`), « Importés de Chine pour vous › » celle de tous les articles à commander depuis la Chine (`/import-chine`). Chaque liste se trie (pour vous, nouveautés, prix, promotions) et se filtre par rayon.

## Détails techniques

- Page `Provenance` dans `pages/catalogue.jsx` (routes `en-stock` et `import-chine`), ajoutées au plan du site. Couleurs dans `couleurs.css` (`.rangee-source`, `.page-provenance`, `data-source="local|import"`).

---

# Sokoyetu — comptes clients facultatifs (octobre 2026)

## Ce qui change pour vous

- **Commander sans compte reste possible.** Avant de commander, la boutique propose : « Créez votre compte et commencez à commander dès maintenant », ou **Continuer sans compte**. La proposition revient aussi après un achat (page de remerciement) et dans Mon compte.
- **Connexion sans mot de passe** : le client donne son numéro de téléphone et reçoit un **code à 6 chiffres sur WhatsApp** ; s'il n'a pas WhatsApp, il peut le recevoir **par SMS** (si le SMS de secours est branché).
- **Un compte sur tous ses téléphones** : panier, favoris, coordonnées de livraison et historique des commandes se retrouvent partout. Les commandes déjà passées avec ce numéro y apparaissent aussi. Déconnexion (rien ne reste sur un téléphone prêté) et suppression du compte depuis Mon compte.
- **Administration** : dans **Clients**, les clients avec compte (même sans commande) avec ce qu'ils ont **au panier** et **en favori** ; dans **Audience**, une carte « **Paniers à relancer** » et, sur chaque article, les clients avec compte qui l'ont au panier ou en favori.
- **Brancher l'envoi des codes** : `sudo /opt/sokoyetu/codes.sh whatsapp ID_DU_NUMERO 'JETON'` (voir LISEZMOI, section 6). Sans canal branché, la boutique ne propose pas de compte. Mode test : `codes.sh test` (code affiché à l'écran).
- Politique de confidentialité mise à jour (compte client facultatif).

## Détails techniques

- Migration `1793300000_sokoyetu_comptes.js` : collection d'authentification `clients` (téléphone unique, nom, `doc` = panier, favoris, profil ; aucune règle d'écriture publique), champ `orders.client`, tables `sokoyetu_codes` (empreinte salée du code, essais, envois) et `sokoyetu_envois_jours` (plafond quotidien). Limites par IP sur les routes.
- `pb_hooks/lib/envoi.js` (WhatsApp Cloud API de Meta, modèle « authentification » ; SMS Twilio ou Plivo ; simulation) et `lib/comptes.js` (codes : 60 s entre deux envois, 5 par 3 h, 5 essais, 10 min ; création du compte à la première connexion ; fusion panier et favoris de l'appareil).
- Routes : `POST compte/code`, `POST compte/connexion` (réponse d'authentification PocketBase, jeton 90 jours), `GET`/`POST compte`, `POST compte/supprimer`. Une commande passée connecté est rattachée au compte.
- Boutique : page `/compte/connexion`, synchronisation du compte (envoi groupé après 1 s, rechargement au retour sur l'onglet). Règles partagées dans `regles.js` (`docCompte`, `fusionCompte`). Démo : comptes simulés, code affiché à l'écran.
- Tests : test serveur des comptes (22 au total), `tests/comptes.mjs` (trois téléphones et l'administration), faux services WhatsApp, Twilio et Plivo (`tests/codes-simule.mjs`).

---

# Sokoyetu — audience en direct (octobre 2026)

## Ce qui change pour vous

- **Nouvelle page « Audience »** dans l'administration (barre latérale, ou Plus → Audience sur téléphone). Elle se met à jour seule toutes les 15 secondes : **personnes en ligne maintenant**, **visiteurs** et **nouveaux visiteurs** sur la période (aujourd'hui, 7 ou 30 jours), **articles vus**, visiteurs par jour, et les **clients** (personnes qui ont déjà commandé).
- **Chaque article en détail** : combien le regardent en ce moment, vues et visiteurs différents, dans combien de **paniers** et de **favoris** il se trouve maintenant, ajouts sur la période, commandes payées et pièces vendues, et la liste des **clients qui l'ont commandé** (nom, téléphone, commande).
- **Tableau de bord** : une carte « En direct » indique combien de personnes sont sur la boutique et mène à l'audience.
- **Vie privée** : la boutique n'a pas de comptes clients. Un visiteur est un appareil reconnu par un code tiré au sort, sans nom, téléphone ni adresse IP ; paniers et favoris sont donc comptés, pas nominatifs. Les noms n'apparaissent qu'avec les commandes. Compteurs effacés après 90 jours, rien n'est envoyé à un service extérieur ; le visiteur peut refuser (Infos → Cookies), et les navigateurs qui demandent à ne pas être suivis ne sont pas comptés. Pages de confidentialité mises à jour.

## Détails techniques

- `pb_hooks/lib/audience.js`, migration `1793200000_sokoyetu_audience.js` : trois tables SQLite de compteurs (`sokoyetu_visiteurs`, `sokoyetu_articles`, `sokoyetu_etats`), écritures en une requête (`INSERT … ON CONFLICT`), purge chaque nuit (tâche `sokoyetu-audience`).
- Routes : `POST /api/sokoyetu/visite` (publique, robots ignorés, limite 600/min par IP), `GET /api/sokoyetu/audience?jours=&graphe=` et `GET /api/sokoyetu/audience/{id}` (administration).
- Boutique : `src/boutique/visites.js` (signal toutes les 45 s tant que la page est visible, article ouvert, ajout au panier ou en favori ; contenu du panier et des favoris envoyé seulement quand il change). Démo : mêmes routes simulées, avec deux semaines de visites inventées.
- Test serveur ajouté (21 au total).

---

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
- **Historique des commandes.** Dans l'administration, Commandes → **Historique** range toutes les commandes payées mois par mois (total encaissé par mois, frais de service, articles vendus, panier moyen), avec recherche, filtres (en cours, livrées, annulées), choix de la période et **export Excel** pour la comptabilité. Côté client, « Mes commandes » sépare les commandes **en cours** de l'**historique** (avec le total dépensé), et une commande livrée peut être **commandée à nouveau** en un geste.
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
