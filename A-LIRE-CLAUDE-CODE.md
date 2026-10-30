# Sokoyetu — notes techniques pour reprendre le code

Projet de Kabamba Aristote (« Messir »), Bukavu (RDC). Il travaille **depuis son téléphone** : toute procédure doit se faire depuis un mobile (console web DigitalOcean, site GitHub). Langue : français, dans l'interface comme dans le code.

## Exigences non négociables

1. **Boutique et administration = deux applications séparées**, même base. Aucun lien ni code d'admin dans la boutique ; l'admin a un bouton « Voir la boutique ».
2. Le nom est **Sokoyetu** (jamais « Duka »). Domaines : `sokoyakwetu.com` et `admin.sokoyakwetu.com`.
3. PWA d'abord, Google Play ensuite (`android.sh` prépare assetlinks).
4. Thème **clair par défaut**, marron mêlé de noir ; sombre seulement en option. Pas de motif wax. Vraies photos ; articles seuls sauf nécessité ; personnes africaines quand il y en a. Bannière d'accueil centrée, « Sokoyetu » en grand, **première image = port avec conteneurs et grues** ; thème import Chine–Afrique, douane, Bukavu/Goma.
5. Paiement Mobile Money **automatique dans l'application** (agrégateur FlexPay : M-Pesa, Airtel Money, Orange Money, Afrimoney), **jamais à la livraison**, **aucun contact WhatsApp dans l'achat**. La commande n'est validée qu'à la confirmation de l'API. Reçu avec numéro de commande unique (retrouvable avec le téléphone). **Frais de service de 2 %** du panier ajoutés avant le paiement, encaissés par la boutique (pas les frais de l'agrégateur).
6. Rayons variés (bijoux, habits, montres, électronique, sacs…). Interface simple, professionnelle, chaleureuse, fluide.
7. Hébergement : Droplet DigitalOcean Ubuntu 24.04, **PocketBase 0.40.5** (version et empreinte figées dans les scripts).

## Organisation

```
src/commun/js/regles.js     règles métier PARTAGÉES (CommonJS, sans dépendance) : serveur, boutique, admin, démo
src/commun/js/              api.js (client PocketBase + temps réel), interface.jsx, icones.jsx, medias.jsx, outils.js, legal.js, theme.js, stockage.js
src/commun/css/             jetons.css (couleurs, typo, espacements ; thème sombre), base.css, composants.css
src/commun/polices/         Fraunces + Plus Jakarta Sans (woff2 variables, licence OFL)
src/boutique/               main.jsx, routeur.js (vraies adresses /p/…, /c/…), etat.js, seo.js, mesure.js, installation.jsx, pages/, composants/, boutique.css, public/
src/admin/                  main.jsx, routeur.js (#/…), etat.js, cadrage.js (photos cadrées), pages/, composants/ (cadre, graphique), admin.css, public/
serveur/pb_hooks/           sokoyetu.pb.js (routes, hôtes, sécurité) + lib/serveur.js, lib/pages.js (SEO, catalogue, sitemap), lib/ia.js,
                            lib/paiement.js (fournisseurs : flexpay, simulation), lib/commandes.js (suivi des paiements, échéances, notifications),
                            lib/audience.js, lib/comptes.js (comptes clients), lib/envoi.js (codes : WhatsApp, SMS),
                            lib/import.js (import par lien fournisseur, copie de photos)
serveur/pb_migrations/      1792800000_sokoyetu_init.js (inchangée, compatibilité v1) + 1793000000_sokoyetu_v2.js + 1793100000_sokoyetu_paiement.js + 1793200000_sokoyetu_audience.js + 1793300000_sokoyetu_comptes.js + 1793400000_sokoyetu_produits.js
serveur/scripts/            installer.sh, mise-a-jour.sh, service.sh, mot-de-passe.sh, ia.sh, paiement.sh, codes.sh, android.sh
demo/                       api-demo.js (serveur simulé dans le navigateur), index.html (page d'accueil de la démo)
medias/photos/              photos d'exemple (ban-*, cat-*, pNN-* ; -s = petite taille), medias/marque/ (SVG des icônes), medias/marque/operateurs/ (logos d’origine des opérateurs ; versions web 144 px en WebP dans src/commun/marque/operateurs/, composant LogoOperateur)
outils/                     construire.mjs, serveur-local.sh, charger-exemple.mjs, captures-manifeste.mjs, images-marque.mjs
tests/                      *.test.js (npm test), serveur.test.mjs, parcours.mjs, accessibilite.mjs, captures.mjs, demo.mjs, flexpay-simule.mjs (faux FlexPay)
```

Pile : **Preact 11 + @preact/signals**, JSX compilé par **esbuild** (cibles chrome80 / safari15 / firefox78 / edge88), fichiers nommés par empreinte (`assets/boutique.<hash>.js`). Aucune dépendance côté serveur : les hooks PocketBase (goja) `require` leurs modules dans chaque gestionnaire. Attention, goja ne gère pas `\p{…}` dans les expressions régulières (renvoie faux sans erreur).

## Commandes

```bash
npm install
npm run build                    # dist/sokoyetu-serveur/ + dist/sokoyetu-serveur.zip
npm run demo                     # dist/demo/ (boutique/, admin/, index.html)
npm test                         # règles métier + icônes
bash outils/serveur-local.sh     # PocketBase local : http://localhost:8090 (boutique), http://admin.localhost:8090 (admin)
                                 # paiement en mode test par défaut (SOKOYETU_PAIEMENT=simulation, SOKOYETU_SIMULATION_DELAI=3 s)
                                 # compte : admin@sokoyetu.test / Sokoyetu-2026 · tableau /_/ : technique@sokoyetu.test / Technique-2026
node outils/charger-exemple.mjs  # catalogue d'exemple + réglages de démonstration
node tests/commandes-exemple.mjs # 6 commandes de test réparties sur 10 jours
BASE=http://127.0.0.1:8091 node --test tests/serveur.test.mjs   # sur une base NEUVE (PORT=8091 SOKOYETU_SIMULATION_DELAI=1 DATA=.local/pb_test bash outils/serveur-local.sh)
node tests/flexpay-simule.mjs    # faux FlexPay sur :8099, puis SOKOYETU_PAIEMENT=flexpay FLEXPAY_URL=http://127.0.0.1:8099/api/rest/v1 FLEXPAY_MARCHAND=SOKOYETU FLEXPAY_JETON=jeton-de-test-flexpay-0123456789 bash outils/serveur-local.sh
node tests/parcours.mjs          # client (téléphone) + gérante (ordinateur), temps réel, stock
node tests/accessibilite.mjs [clair|sombre]
node tests/captures.mjs [boutique|admin] [clair|sombre]   # captures dans le dossier SORTIE
(cd dist/demo && python3 -m http.server 8095) ; node tests/demo.mjs
```

Pour arrêter un serveur local : `ps -eo pid,args | awk '$2 ~ /pocketbase$/ {print $1}' | xargs -r kill` (ne pas utiliser `pkill -f`, qui peut tuer le shell courant).

## Fonctionnement

**Hôtes.** Un seul PocketBase sert les deux applications : `admin.*` → `pb_admin/` (sauf `/photos/`, servies depuis la boutique) ; le reste → `pb_public/`. `www.` → redirection 301. `/admin.html` sur la boutique → redirection vers `admin.`. CSP, HSTS et cache sont posés dans le même middleware.

**Données.** Chaque collection garde un document JSON dans le champ `doc` (`config/store`, `collections`, `products`, `banners`, `discounts`, `orders`, `media`). Le client transforme un enregistrement en `{ ...doc, id }` (`versLigne`).

**Commandes.** Uniquement par `POST /api/sokoyetu/commander` : `regles.preparerCommande` recalcule tout (frais de service compris) et refuse tout écart (stock, prix, remise, total annoncé : champ `total`), le stock est réservé dans la même transaction (`appliquerStock`), le jeton client rend l'envoi idempotent. La commande naît « en attente de paiement », puis la demande part chez le fournisseur. La règle de mise à jour de `orders` est fermée : seules les routes du serveur la modifient (`S.enregistrerCommande` tient aussi à jour les colonnes `status`, `phone`, `number`, `pay_status`, `pay_ref`, `expires`). Le client lit sa commande avec `?t=<jeton>` ; `onRecordEnrich` retire coûts, notes internes, `issues`, `reserved` et le jeton pour tout visiteur. Les étapes admin passent par `POST /api/sokoyetu/commandes/{id}` (`regles.etapeCommande`, stock réservé ou rendu). Avant de payer, la boutique demande `POST /api/sokoyetu/devis`.

**Paiement.** Fournisseur choisi sur le serveur seulement (`/opt/sokoyetu/sokoyetu.env` posé par `paiement.sh` : `SOKOYETU_PAIEMENT=flexpay|simulation`, `FLEXPAY_MARCHAND`, `FLEXPAY_JETON`, `FLEXPAY_URL` pour l'environnement de test), injecté dans la configuration publique (`payment.provider`, `holdMinutes`, `test`) ; sans fournisseur prêt, `moyensDePaiement` est vide et la boutique ne prend pas de commande. `lib/paiement.js` : `demarrer` / `verifier` renvoient `{ etat: en_attente | paye | echec }` ; FlexPay = `POST /paymentService` puis `GET /check/{orderNumber}` (`transaction.status` 0 payé, 1 refusé), référence envoyée `NUMERO-tentative`. Cycle dans `regles.js` : `paiementEnvoye`, `paiementConfirme` (idempotent ; rouvre une commande expirée avec un point à vérifier), `paiementEchoue`, `paiementExpire` (annulation + stock rendu), `relancePossible` (5 tentatives). Routes : `GET paiement/{id}?t=` (revérifie au plus toutes les 3 s), `POST paiement/{id}/relancer` (30 s après la demande précédente), `POST notification/{fournisseur}` (toujours 200, revérifie toujours chez le fournisseur), `POST retrouver` (numéro + téléphone → id et jeton), tâche `sokoyetu-paiements` chaque minute. Le délai de livraison prévu (`delivery`) est recalculé au paiement.

**Temps réel.** Une seule connexion SSE par onglet (`TempsReel` dans `api.js`). Admin : `col/*`. Boutique : catalogue + `orders/<id>?options={"query":{"t":…}}` pour le suivi.

**Admin.** Enregistrement d'une fiche produit par fusion à trois voies (stock et ventes modifiés par une commande pendant l'édition ne sont pas écrasés). Garde des modifications non enregistrées dans le routeur. Commande **payée** (passage à `payment.status = paid` reçu en direct, hors confirmation manuelle) : toast, carillon (WebAudio), notification système (permission demandée dans Mon compte), compteur dans le titre et badge. Le fournisseur affiché vient de `GET /api/sokoyetu/etat` (`paiement`).

**Audience.** `lib/audience.js` : la boutique (`src/boutique/visites.js`) envoie `POST /api/sokoyetu/visite` `{ v, p, a, panier?, favoris? }` (identifiant d'appareil tiré au sort dans `localStorage` « visiteur », signal toutes les 45 s si la page est visible ; rien si la mesure est refusée, DNT ou GPC). Tables SQL hors collections : `sokoyetu_visiteurs` (jour, visiteur, vu, vues, produit affiché), `sokoyetu_articles` (jour, produit, visiteur, vues, panier, favori), `sokoyetu_etats` (paniers et favoris actuels). En ligne = signal depuis moins de 90 s. Jours à l'heure de Bukavu (UTC+2). Purge à 90 jours. Admin : pages `#/audience` et `#/audience/{id}`, relues toutes les 15 s (`useEnDirect`), commandes par article calculées depuis `orders`.

**Comptes clients.** Facultatifs : sans canal prêt (`envoi.pret()`), `accounts.open` est faux dans la configuration publique et la boutique se comporte comme sans comptes. Collection d'authentification `clients` (mot de passe et OTP de PocketBase désactivés, jeton 90 jours, aucune règle d'écriture : tout passe par les routes). `lib/envoi.js` : `SOKOYETU_WHATSAPP=meta|simulation` (`WHATSAPP_NUMERO`, `WHATSAPP_JETON`, `WHATSAPP_MODELE`, `WHATSAPP_LANGUE`), `SOKOYETU_SMS=twilio|plivo|simulation`, `SOKOYETU_SMS_MAX_JOUR`, posés par `codes.sh` ; `WHATSAPP_URL` / `SOKOYETU_SMS_URL` pour les faux services des tests. `lib/comptes.js` : `demanderCode` (empreinte salée dans `sokoyetu_codes`, 60 s entre deux envois, 5 par 3 h, plafond quotidien), `verifierCode` (5 essais, 10 min ; crée le compte), `enregistrer` (fusion côté serveur), `commandes` (`client = id` ou même téléphone). Routes `compte/code`, `compte/connexion` (`$apis.recordAuthResponse`), `compte` (GET/POST), `compte/supprimer` (commandes détachées). Les fonctions d'un handler JSVM doivent venir d'un `require` (les fonctions du haut du fichier n'y sont pas visibles). Boutique : `Auth.utiliserCle('compte')`, `synchroniserCompte()` dans `etat.js`, `TempsReel.redemarrer()` à la connexion et à la déconnexion ; `fusionCompte` dans `regles.js` (quantité max, favoris réunis, profil du compte prioritaire). Admin : `collections/clients/records` en direct (`clients/*`).

**Assistant IA.** `POST /api/sokoyetu/ia/produit` → `lib/ia.js` appelle l'API Claude en HTTP brut (`model: claude-opus-5-5`, sortie JSON contrainte par schéma). Clé dans `/opt/sokoyetu/sokoyetu.env` (root, 600), chargée par systemd (`EnvironmentFile`), posée par `ia.sh`. Codes d'erreur : `no_key`, `bad_key`, `rate_limited`, `image_rejected`, `upstream_error`, `refused`, `invalid_json`, `network`. `POST /api/sokoyetu/ia/cadre` : cadre seul de l'article (millièmes) ; la fiche renvoie aussi `cadre`. L'admin recadre la photo dans le navigateur (`src/admin/cadrage.js` : 4:5, article centré, niveaux automatiques) et garde l'originale (`orig` / `retouche` sur l'image, bouton ✦). Essai sans clé réelle : `CADRES='[[g,h,d,b]]' node tests/claude-simule.mjs` puis `ANTHROPIC_API_KEY=sk-ant-essai-0123456789 ANTHROPIC_URL=http://127.0.0.1:8097 bash outils/serveur-local.sh`.

**Fiche produit enrichie.** Prix payé = `regles.prixUnitaire` : prix de la variante (`variantPrices[cle]`, sinon `price`), moins la vente flash (`flash = { pct, startsAt, endsAt }`), moins le palier de gros (`wholesale = [{ min, pct }]`, compté sur toutes les pièces de l'article dans la commande). Affichage : `prixAffiche` (prix, barré, « dès »). `weight` (kg) × `zone.perKg` s'ajoute à la livraison. `sizeGuide = { cols, rows: { taille: [...] }, note }`, `video` (média `pb`, MP4 ≤ 30 Mo), `supplier = { url, price, currency }` (jamais public). Import : `POST /api/sokoyetu/import/lien` (sites fournisseurs connus seulement, `ia: true` → fiche par l'assistant avec la photo par adresse et le texte de la page) et `POST /api/sokoyetu/import/photo` (`$filesystem.fileFromURL`, réseau local refusé). Page admin `#/produits/importer` (CSV, .xlsx, cellules collées, liste de liens). Lecture réelle de 1688/Alibaba jamais testée depuis l'environnement de développement (sites bloqués) : extraction testée sur des pages types (`tests/import.test.js`).

**Démo.** `npm run demo` remplace `src/commun/js/api.js` par `demo/api-demo.js` (même interface) : base dans `localStorage`, mêmes règles (`regles.js`), paiement en mode test (confirmé après 5 s, refusé si le numéro finit par 0000, échéances vérifiées toutes les 4 s), temps réel entre onglets par `BroadcastChannel`, compte prérempli. La boutique y utilise des adresses `#/…`. `__DEMO__`, `__VERSION__` et `__APP__` sont définis à la construction.

## Design

Jetons dans `src/commun/css/jetons.css` : ivoire `--fond #FBF8F4`, cacao `--marque #6B4430`, ébène `--ebene #2A1D16`, or `--or #C8902E` ; sombre sous `:root[data-theme="dark"]`. Titres en Fraunces, texte en Plus Jakarta Sans. Contrastes ≥ 4,5:1 vérifiés dans les deux thèmes (`tests/accessibilite.mjs` doit rester à zéro violation). Histogramme : une seule série, colonnes ≤ 24 px arrondies en haut, `--graph-barre #A8622B` (sombre `#C07A3C`), infobulle au survol et au clavier, chiffres en tableau.

## Pistes pour la suite

- Valider l'adaptateur FlexPay sur leur environnement de test à l'ouverture du compte marchand (format des réponses, devise USD, opérateurs). D'autres agrégateurs (PawaPay, CinetPay, MaxiCash) s'ajoutent comme un fournisseur de plus dans `lib/paiement.js` et `regles.FOURNISSEURS`.
- Les photos d'exemple viennent d'Unsplash (licence Unsplash) : `outils/photos.json` liste chaque emplacement, chaque emplacement porte la clé de la photo retenue sur images.unsplash.com (« choix », vérifiée à l'œil : pas de marque visible), `python3 outils/photos_unsplash.py installer` télécharge les photos choisies, les recadre (produit 4:5, rayon 1:1, bannière 16:9) et écrit `medias/photos/LICENCE.txt`. Il faut l'accès réseau à `unsplash.com` et `images.unsplash.com`.
- Publication Google Play (PWABuilder + `android.sh`).
- Notifications push serveur (Web Push) pour prévenir la gérante quand l'application est fermée.
