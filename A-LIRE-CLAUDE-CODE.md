# Sokoyetu — notes techniques pour reprendre le code

Projet de Kabamba Aristote (« Messir »), Bukavu (RDC). Il travaille **depuis son téléphone** : toute procédure doit se faire depuis un mobile (console web DigitalOcean, site GitHub). Langue : français, dans l'interface comme dans le code.

## Exigences non négociables

1. **Boutique et administration = deux applications séparées**, même base. Aucun lien ni code d'admin dans la boutique ; l'admin a un bouton « Voir la boutique ».
2. Le nom est **Sokoyetu** (jamais « Duka »). Domaines : `sokoyakwetu.com` et `admin.sokoyakwetu.com`.
3. PWA d'abord, Google Play ensuite (`android.sh` prépare assetlinks).
4. Thème **clair par défaut**, marron mêlé de noir ; sombre seulement en option. Pas de motif wax. Vraies photos ; articles seuls sauf nécessité ; personnes africaines quand il y en a. Bannière d'accueil centrée, « Sokoyetu » en grand, **première image = port avec conteneurs et grues** ; thème import Chine–Afrique, douane, Bukavu/Goma.
5. Paiement Mobile Money (M-Pesa, Airtel Money, Orange Money, Illico Cash) **payé à la commande, jamais à la livraison** ; vérification manuelle du code de transaction par la gérante.
6. Rayons variés (bijoux, habits, montres, électronique, sacs…). Interface simple, professionnelle, chaleureuse, fluide.
7. Hébergement : Droplet DigitalOcean Ubuntu 24.04, **PocketBase 0.40.5** (version et empreinte figées dans les scripts).

## Organisation

```
src/commun/js/regles.js     règles métier PARTAGÉES (CommonJS, sans dépendance) : serveur, boutique, admin, démo
src/commun/js/              api.js (client PocketBase + temps réel), interface.jsx, icones.jsx, medias.jsx, outils.js, legal.js, theme.js, stockage.js
src/commun/css/             jetons.css (couleurs, typo, espacements ; thème sombre), base.css, composants.css
src/commun/polices/         Fraunces + Plus Jakarta Sans (woff2 variables, licence OFL)
src/boutique/               main.jsx, routeur.js (vraies adresses /p/…, /c/…), etat.js, seo.js, mesure.js, installation.jsx, pages/, composants/, boutique.css, public/
src/admin/                  main.jsx, routeur.js (#/…), etat.js, pages/, composants/ (cadre, graphique), admin.css, public/
serveur/pb_hooks/           sokoyetu.pb.js (routes, hôtes, sécurité) + lib/serveur.js, lib/pages.js (SEO, catalogue, sitemap), lib/ia.js
serveur/pb_migrations/      1792800000_sokoyetu_init.js (inchangée, compatibilité v1) + 1793000000_sokoyetu_v2.js
serveur/scripts/            installer.sh, mise-a-jour.sh, service.sh, mot-de-passe.sh, ia.sh, android.sh
demo/                       api-demo.js (serveur simulé dans le navigateur), index.html (page d'accueil de la démo)
medias/photos/              photos d'exemple (ban-*, cat-*, pNN-* ; -s = petite taille), medias/marque/ (SVG des icônes)
outils/                     construire.mjs, serveur-local.sh, charger-exemple.mjs, captures-manifeste.mjs, images-marque.mjs
tests/                      *.test.js (npm test), serveur.test.mjs, parcours.mjs, accessibilite.mjs, captures.mjs, demo.mjs
```

Pile : **Preact 11 + @preact/signals**, JSX compilé par **esbuild** (cibles chrome80 / safari15 / firefox78 / edge88), fichiers nommés par empreinte (`assets/boutique.<hash>.js`). Aucune dépendance côté serveur : les hooks PocketBase (goja) `require` leurs modules dans chaque gestionnaire. Attention, goja ne gère pas `\p{…}` dans les expressions régulières (renvoie faux sans erreur).

## Commandes

```bash
npm install
npm run build                    # dist/sokoyetu-serveur/ + dist/sokoyetu-serveur.zip
npm run demo                     # dist/demo/ (boutique/, admin/, index.html)
npm test                         # règles métier + icônes
bash outils/serveur-local.sh     # PocketBase local : http://localhost:8090 (boutique), http://admin.localhost:8090 (admin)
                                 # compte : admin@sokoyetu.test / Sokoyetu-2026 · tableau /_/ : technique@sokoyetu.test / Technique-2026
node outils/charger-exemple.mjs  # catalogue d'exemple + réglages de démonstration
node tests/commandes-exemple.mjs # 6 commandes de test réparties sur 10 jours
BASE=http://127.0.0.1:8091 node --test tests/serveur.test.mjs   # sur une base NEUVE (PORT=8091 DATA=.local/pb_test bash outils/serveur-local.sh)
node tests/parcours.mjs          # client (téléphone) + gérante (ordinateur), temps réel, stock
node tests/accessibilite.mjs [clair|sombre]
node tests/captures.mjs [boutique|admin] [clair|sombre]   # captures dans le dossier SORTIE
(cd dist/demo && python3 -m http.server 8095) ; node tests/demo.mjs
```

Pour arrêter un serveur local : `ps -eo pid,args | awk '$2 ~ /pocketbase$/ {print $1}' | xargs -r kill` (ne pas utiliser `pkill -f`, qui peut tuer le shell courant).

## Fonctionnement

**Hôtes.** Un seul PocketBase sert les deux applications : `admin.*` → `pb_admin/` (sauf `/photos/`, servies depuis la boutique) ; le reste → `pb_public/`. `www.` → redirection 301. `/admin.html` sur la boutique → redirection vers `admin.`. CSP, HSTS et cache sont posés dans le même middleware.

**Données.** Chaque collection garde un document JSON dans le champ `doc` (`config/store`, `collections`, `products`, `banners`, `discounts`, `orders`, `media`). Le client transforme un enregistrement en `{ ...doc, id }` (`versLigne`).

**Commandes.** Uniquement par `POST /api/sokoyetu/commander` : `regles.preparerCommande` recalcule tout, le stock est réservé dans la même transaction (`appliquerStock`), le jeton client rend l'envoi idempotent. Un changement de prix ou de stock pendant le paiement ne bloque pas : la commande porte des `issues` (« points à vérifier »). Le client lit sa commande avec `?t=<jeton>` ; `onRecordEnrich` retire coûts, notes internes, `issues`, `reserved` et le jeton pour tout visiteur. Les étapes admin passent par `POST /api/sokoyetu/commandes/{id}` (`regles.etapeCommande`, stock réservé ou rendu). Avant de payer, la boutique demande `POST /api/sokoyetu/devis`.

**Temps réel.** Une seule connexion SSE par onglet (`TempsReel` dans `api.js`). Admin : `col/*`. Boutique : catalogue + `orders/<id>?options={"query":{"t":…}}` pour le suivi.

**Admin.** Enregistrement d'une fiche produit par fusion à trois voies (stock et ventes modifiés par une commande pendant l'édition ne sont pas écrasés). Garde des modifications non enregistrées dans le routeur. Nouvelle commande : toast, carillon (WebAudio), notification système (permission demandée dans Mon compte), compteur dans le titre et badge.

**Assistant IA.** `POST /api/sokoyetu/ia/produit` → `lib/ia.js` appelle l'API Claude en HTTP brut (`model: claude-opus-5-5`, sortie JSON contrainte par schéma). Clé dans `/opt/sokoyetu/sokoyetu.env` (root, 600), chargée par systemd (`EnvironmentFile`), posée par `ia.sh`. Codes d'erreur : `no_key`, `bad_key`, `rate_limited`, `image_rejected`, `upstream_error`, `refused`, `invalid_json`, `network`.

**Démo.** `npm run demo` remplace `src/commun/js/api.js` par `demo/api-demo.js` (même interface) : base dans `localStorage`, mêmes règles (`regles.js`), temps réel entre onglets par `BroadcastChannel`, compte prérempli. La boutique y utilise des adresses `#/…`. `__DEMO__`, `__VERSION__` et `__APP__` sont définis à la construction.

## Design

Jetons dans `src/commun/css/jetons.css` : ivoire `--fond #FBF8F4`, cacao `--marque #6B4430`, ébène `--ebene #2A1D16`, or `--or #C8902E` ; sombre sous `:root[data-theme="dark"]`. Titres en Fraunces, texte en Plus Jakarta Sans. Contrastes ≥ 4,5:1 vérifiés dans les deux thèmes (`tests/accessibilite.mjs` doit rester à zéro violation). Histogramme : une seule série, colonnes ≤ 24 px arrondies en haut, `--graph-barre #A8622B` (sombre `#C07A3C`), infobulle au survol et au clavier, chiffres en tableau.

## Pistes pour la suite

- Paiement Mobile Money automatique (API des opérateurs) : aujourd'hui vérification manuelle.
- Les photos d'exemple viennent d'Unsplash (licence Unsplash) : `outils/photos.json` liste chaque emplacement, chaque emplacement porte la clé de la photo retenue sur images.unsplash.com (« choix », vérifiée à l'œil : pas de marque visible), `python3 outils/photos_unsplash.py installer` télécharge les photos choisies, les recadre (produit 4:5, rayon 1:1, bannière 16:9) et écrit `medias/photos/LICENCE.txt`. Il faut l'accès réseau à `unsplash.com` et `images.unsplash.com`.
- Publication Google Play (PWABuilder + `android.sh`).
- Notifications push serveur (Web Push) pour prévenir la gérante quand l'application est fermée.
