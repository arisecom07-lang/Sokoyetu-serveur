# Sokoyetu — mise en ligne et entretien

Sokoyetu, ce sont **deux applications séparées** qui partagent la même base de données, sur un seul serveur :

| Adresse | Pour qui | Contenu |
|---|---|---|
| **https://sokoyakwetu.com** | vos clients | la boutique : rayons, articles, panier, paiement Mobile Money dans l'application, reçu, suivi de commande |
| **https://admin.sokoyakwetu.com** | vous | l'administration : commandes payées en direct, préparation, produits, stock, réglages |

La boutique ne contient aucun lien ni aucun code de l'administration. Depuis l'administration, le bouton **Voir la boutique** ouvre le site comme vos clients le voient.

Toutes les étapes ci-dessous se font **depuis un téléphone** (navigateur + application ou site DigitalOcean).

---

## 1. Le paquet

Le fichier **`sokoyetu-serveur.zip`** contient tout :

| Élément | Rôle |
|---|---|
| `installer.sh` | Installation complète : PocketBase 0.40.5 (empreinte vérifiée), pare-feu, service automatique, HTTPS, compte administrateur |
| `mise-a-jour.sh` | Installe une nouvelle version ; sauvegarde la base avant ; garde produits, commandes, photos et réglages |
| `mot-de-passe.sh` | Nouveau mot de passe administrateur (mot de passe oublié) |
| `ia.sh` | Active ou retire l'assistant IA des fiches produits |
| `android.sh` | Relie une future application Google Play au site |
| `service.sh` | Service automatique (démarrage avec le serveur, redémarrage en cas d'arrêt) |
| `pb_public/` | La boutique |
| `pb_admin/` | L'administration |
| `pb_hooks/` | Les règles du serveur : prix, total et stock recalculés à chaque commande, codes promo, coûts d'achat jamais montrés aux clients |
| `pb_migrations/` | Structure de la base, droits d'accès, limites anti-spam, sauvegarde quotidienne |

Mettez ce fichier dans un dépôt GitHub (par exemple `arisecom07-lang/Sokoyetu-serveur`) : sur github.com, ouvrez le dépôt → **Add file → Upload files** → choisissez le zip → **Commit changes**. Son adresse de téléchargement est alors :

```
https://github.com/arisecom07-lang/Sokoyetu-serveur/raw/main/sokoyetu-serveur.zip
```

Le dépôt doit être **public** pour que le serveur puisse télécharger le paquet.

---

## 2. Première installation (nouveau serveur)

1. Sur DigitalOcean : **Create → Droplets**, image **Ubuntu 24.04**, la plus petite taille suffit pour commencer (1 Go de mémoire).
2. Dans **Advanced Options → Add Initialization scripts (user data)**, collez ce texte en remplaçant l'e-mail et le mot de passe :

```bash
#!/bin/bash
exec > /var/log/sokoyetu-installation.log 2>&1
set -e
export EMAIL="votre-email@exemple.com"
export MOT_DE_PASSE="Lettres-Chiffres-Tirets-2026"   # 10 caractères minimum, sans guillemet ni $
export PAQUET="https://github.com/arisecom07-lang/Sokoyetu-serveur/raw/main/sokoyetu-serveur.zip"
curl -fsSL "$PAQUET" -o /root/sokoyetu.zip
python3 -m zipfile -e /root/sokoyetu.zip /root/sokoyetu
bash /root/sokoyetu/installer.sh
```

3. Créez le Droplet et notez son **adresse IP**.
4. Chez le fournisseur du nom de domaine, créez **trois enregistrements A** vers cette adresse IP :

| Type | Nom | Valeur |
|---|---|---|
| A | `@` | adresse IP du Droplet |
| A | `www` | adresse IP du Droplet |
| A | `admin` | adresse IP du Droplet |

5. Attendez 5 à 30 minutes (le temps que le nom de domaine se propage), puis ouvrez **https://admin.sokoyakwetu.com** et connectez-vous avec l'e-mail et le mot de passe choisis.
6. Branchez le paiement Mobile Money (section 5), puis dans l'administration suivez la carte **Bien démarrer** du tableau de bord : zones de livraison, WhatsApp, informations légales, puis vos propres produits. Changez le mot de passe dans **Plus → Mon compte**.

Le catalogue d'exemple (18 articles) peut être chargé ou retiré dans **Réglages → Général**.

---

## 3. Mettre à jour

1. Remplacez `sokoyetu-serveur.zip` dans le dépôt GitHub par la nouvelle version (même nom, même emplacement).
2. DigitalOcean → votre Droplet → **Access → Launch Droplet Console**, puis tapez :

```bash
sudo /opt/sokoyetu/mise-a-jour.sh
```

La base est sauvegardée avant (dans `/opt/sokoyetu/sauvegardes`, les 3 dernières sont gardées). Produits, commandes, photos et réglages sont conservés.

### Passage de la version 1 à la version 2 (une seule fois)

La version 2 sépare l'administration sur **admin.sokoyakwetu.com**. Pour un serveur déjà installé avec la version 1 :

1. Ajoutez l'enregistrement **A `admin`** chez le fournisseur du nom de domaine (voir le tableau plus haut).
2. Déposez le nouveau zip sur GitHub, puis dans la console du Droplet lancez la mise à jour **deux fois de suite** :

```bash
sudo /opt/sokoyetu/mise-a-jour.sh
sudo /opt/sokoyetu/mise-a-jour.sh
```

La première fois, l'ancien script installe le nouveau ; la deuxième fois, le nouveau script installe l'administration séparée et met à jour le service (certificat HTTPS pour `admin.`).

3. L'ancienne adresse `sokoyakwetu.com/admin.html` renvoie automatiquement vers `admin.sokoyakwetu.com`. Votre compte, vos produits et vos commandes restent les mêmes.

---

## 4. Commandes utiles (console du Droplet)

| Pour… | Tapez |
|---|---|
| Mettre à jour | `sudo /opt/sokoyetu/mise-a-jour.sh` |
| Mettre à jour depuis un fichier déjà sur le serveur | `sudo /opt/sokoyetu/mise-a-jour.sh /root/sokoyetu-serveur.zip` |
| Mot de passe oublié | `sudo /opt/sokoyetu/mot-de-passe.sh vous@exemple.com 'NouveauMotDePasse'` |
| Brancher le paiement nyole (la clé secrète est demandée) | `sudo /opt/sokoyetu/paiement.sh nyole` |
| Essayer nyole avec une clé d'essai `af_test_sec_…` | `sudo /opt/sokoyetu/paiement.sh nyole-essai` |
| Brancher le paiement FlexPay | `sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'` |
| Essayer FlexPay sur son environnement de test | `sudo /opt/sokoyetu/paiement.sh flexpay-essai CODE_MARCHAND 'JETON'` |
| Paiement en mode test (aucun argent) | `sudo /opt/sokoyetu/paiement.sh test` |
| Fermer le paiement | `sudo /opt/sokoyetu/paiement.sh arreter` |
| Voir l'état du paiement | `sudo /opt/sokoyetu/paiement.sh` |
| Envoyer les codes de connexion par WhatsApp | `sudo /opt/sokoyetu/codes.sh whatsapp ID_DU_NUMERO 'JETON'` |
| SMS de secours (Twilio) | `sudo /opt/sokoyetu/codes.sh sms-twilio SID 'JETON' Sokoyetu` |
| Comptes clients en mode test (code affiché à l'écran) | `sudo /opt/sokoyetu/codes.sh test` |
| Fermer les comptes clients | `sudo /opt/sokoyetu/codes.sh arreter` |
| Voir l'état des codes | `sudo /opt/sokoyetu/codes.sh` |
| Activer l'assistant IA | `sudo /opt/sokoyetu/ia.sh 'sk-ant-...'` |
| Retirer l'assistant IA | `sudo /opt/sokoyetu/ia.sh --retirer` |
| Voir si le site tourne | `systemctl status sokoyetu` |
| Voir les dernières erreurs | `journalctl -u sokoyetu -n 50 --no-pager` |
| Journal de l'installation | `cat /var/log/sokoyetu-installation.log` |
| Accès au tableau technique (`/_/`) | `sudo cat /root/sokoyetu-acces.txt` |

---

## 5. Paiement Mobile Money automatique

### Comment ça se passe

1. Le client choisit son opérateur (M-Pesa, Airtel Money, Orange Money, Afrimoney) et le numéro à débiter, puis touche **Payer**.
2. Une demande de paiement s'affiche sur son téléphone ; il la valide avec son **code PIN** (avec nyole, il passe d'abord par la page sécurisée de nyole, puis revient sur la boutique). Il ne quitte pas la boutique et n'écrit à personne : pas de code à recopier, pas de WhatsApp.
3. Dès que l'opérateur confirme, la commande est **validée** et le client reçoit son **reçu** : numéro de commande unique (6 caractères, ex. `K7M2QX`), articles, frais, total payé, référence de la transaction et date de livraison prévue. Il peut le partager ou l'enregistrer en PDF.
4. Avec ce numéro et son téléphone, il **retrouve sa commande** depuis n'importe quel appareil (**Mon compte → Retrouver une commande**).

- **Frais de service** : 2 % du panier (après réduction, hors livraison) sont ajoutés au total avant le paiement. Ils vous reviennent (ce ne sont pas les frais de nyole ou de FlexPay). Le pourcentage se règle dans **Réglages → Paiements Mobile Money** (0 à 20 %).
- **Stock réservé** pendant le paiement (30 minutes par défaut, réglable de 5 à 120). Sans paiement dans ce délai, la commande s'annule toute seule et les articles reviennent en vente. Paiement refusé (solde insuffisant, PIN annulé…) : le client réessaie sur la même commande, avec le même ou un autre numéro.
- **Administration** : la commande apparaît « Paiement en cours » pendant que le client valide, puis l'alerte **Commande payée** sonne (écran, son, notification) dès la confirmation. Vous n'avez rien à vérifier : **Commencer la préparation → Expédier → Livrée**. Les tableaux de bord ne comptent que les commandes payées.
- Le serveur ne croit jamais une notification sur parole : il revérifie chaque paiement auprès du service de paiement (nyole ou FlexPay), et revérifie aussi chaque minute les paiements en cours.

### Brancher nyole (une fois)

Avec nyole, le client choisit son opérateur dans la boutique, puis termine le paiement sur la **page sécurisée de nyole** (M-Pesa, Airtel Money, Orange Money ; Afrimoney n'y est pas proposé) et revient tout seul sur la boutique, où son reçu s'affiche dès la confirmation.

1. Connectez-vous sur **app.nyole.com**, ouvrez **API et journaux**. Vous y voyez une clé publique (`af_live_pub_…`, inutile ici) et une **clé secrète** (`af_live_sec_…`), plus des clés d'essai (`af_test_…`). Attention : nyole indique que l'API est réservée aux comptes ouverts avant le 17 octobre 2026 ; si la page n'affiche aucune clé, demandez l'accès API au support nyole.
2. Dans la même page, indiquez l'adresse du **webhook** : `https://sokoyakwetu.com/api/sokoyetu/notification/nyole` (aussi affichée, avec un bouton Copier, dans **Réglages → Paiements Mobile Money**).
3. Essai sans argent : `sudo /opt/sokoyetu/paiement.sh nyole-essai`, collez la clé `af_test_sec_…` quand elle est demandée (rien ne s'affiche en la collant, c'est normal), puis passez une commande.
4. Pour encaisser pour de vrai : `sudo /opt/sokoyetu/paiement.sh nyole` avec la clé `af_live_sec_…`, puis passez une vraie commande d'un dollar pour vérifier.

Ne collez jamais la clé secrète dans une discussion, un e-mail ou l'administration : elle ne va que dans la console du serveur. L'argent s'accumule sur votre solde nyole ; le reversement vers votre Mobile Money se demande dans nyole (vérification d'identité requise une fois). nyole prend 5 % par paiement réussi.

À vérifier au premier essai : nyole attend le montant dans la plus petite unité de la devise (centimes de dollar : 22,40 $ → 2240). Si le montant affiché sur la page nyole n'est pas le bon, le paiement n'est pas validé par la boutique : signalez-le pour corriger l'adaptateur.

### Brancher FlexPay (une fois)

1. Ouvrez un **compte marchand FlexPay** (flexpay.cd). Vous recevez un **code marchand** et un **jeton d'accès** (token).
2. Donnez à FlexPay l'adresse de notification : `https://sokoyakwetu.com/api/sokoyetu/notification/flexpay` (aussi affichée, avec un bouton Copier, dans **Réglages → Paiements Mobile Money**).
3. Si FlexPay vous donne un accès de test, essayez d'abord : `sudo /opt/sokoyetu/paiement.sh flexpay-essai CODE_MARCHAND 'JETON'`, puis passez une commande de quelques centimes.
4. Pour encaisser pour de vrai : `sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'`.

Le jeton reste sur le serveur (`/opt/sokoyetu/sokoyetu.env`, lisible par l'administrateur du serveur seulement) : il n'est jamais enregistré dans l'administration ni envoyé aux navigateurs. Tant qu'aucun paiement n'est branché, la boutique affiche « Le paiement en ligne ouvre très bientôt » et ne prend pas de commande.

**Mode test** (`sudo /opt/sokoyetu/paiement.sh test`) : aucun argent ; le paiement est confirmé tout seul après quelques secondes, refusé si le numéro se termine par 0000. Un bandeau « Mode test » s'affiche dans la boutique et l'administration. Ne l'ouvrez pas au public dans ce mode.

À confirmer avec FlexPay à l'ouverture du compte : les opérateurs proposés, la devise (USD) et le format exact de leurs réponses. L'adaptateur suit leur documentation publique ; un essai sur leur environnement de test le valide avant d'encaisser.

---

## 6. Comptes clients et code WhatsApp (facultatif)

Le client peut toujours commander **sans compte**. Avant de commander, la boutique lui propose : « Créez votre compte et commencez à commander dès maintenant », avec un bouton **Continuer sans compte** (la question n'est plus reposée sur cet appareil).

- **Pas de mot de passe.** Le client donne son numéro, reçoit un **code à 6 chiffres sur WhatsApp** (bouton « Copier le code ») et le tape. Pas de WhatsApp ? Il touche « Recevoir le code par SMS » si le SMS de secours est branché.
- **Un compte, tous ses téléphones** : panier, favoris, coordonnées de livraison et commandes le suivent. Il se déconnecte (rien ne reste sur un téléphone prêté) ou supprime son compte depuis **Mon compte**.
- **Administration** : **Clients** montre qui a un compte, ce qu'il a **au panier** et **en favori** ; **Audience** ajoute « **Paniers à relancer** » et, sur chaque article, les clients avec compte qui l'ont au panier ou en favori.
- **Limites contre les abus** : un nouveau code toutes les 60 s au plus, 5 codes par numéro en 3 heures, 5 essais par code, code valable 10 minutes, et un **plafond de 200 codes par jour** pour toute la boutique (`codes.sh plafond 300` pour le changer).
- Tant qu'aucun canal n'est branché, la boutique ne propose pas de compte et tout fonctionne comme avant.

### Brancher WhatsApp (une fois)

1. Créez un compte **Meta Business** (business.facebook.com) et, dans **WhatsApp Manager**, ajoutez un **numéro dédié** à la boutique (un numéro qui n'est pas déjà utilisé dans l'application WhatsApp).
2. Créez un **modèle de message** de catégorie **Authentification**, nommé `code_connexion`, langue **Français**, avec le bouton **Copier le code**. Attendez sa validation par Meta.
3. Créez un **utilisateur système** avec un **jeton d'accès permanent** (droit `whatsapp_business_messaging`) et notez le **Phone number ID** du numéro (WhatsApp Manager → API).
4. Dans la console du Droplet : `sudo /opt/sokoyetu/codes.sh whatsapp ID_DU_NUMERO 'JETON'`, puis essayez avec votre propre téléphone : **Mon compte → Créer mon compte**.

Coût : Meta facture chaque code envoyé (tarif « authentification » du pays du client, souvent moins d'un centime de dollar ; vérifiez le tarif pour la RDC dans WhatsApp Manager). Le **SMS de secours** coûte davantage par message (Twilio ou Plivo : `codes.sh sms-twilio` / `codes.sh sms-plivo`). Les jetons restent sur le serveur, dans `/opt/sokoyetu/sokoyetu.env`.

**Mode test** (`sudo /opt/sokoyetu/codes.sh test`) : rien n'est envoyé, le code s'affiche à l'écran. Pour vos essais seulement, jamais pour le public.

---

## 7. Assistant IA des fiches produits (facultatif)

Il rédige le titre, la description et les caractéristiques d'un article à partir d'une photo, repère les couleurs et choisit le rayon. Vous relisez, puis vous mettez le prix.

1. Créez une clé sur **console.anthropic.com → API Keys** (l'usage est facturé par Anthropic, quelques centimes par fiche).
2. Dans la console du Droplet : `sudo /opt/sokoyetu/ia.sh 'sk-ant-...'`
3. Dans l'administration → **Produits**, le bouton **Ajouter avec l'IA** apparaît.

La clé reste sur le serveur, dans un fichier lisible par l'administrateur du serveur seulement ; elle n'est jamais envoyée au navigateur.

---

## 8. Application sur téléphone

- **Boutique** : dans Chrome sur Android, la boutique propose **Installer l'application**. Elle s'ouvre ensuite comme une application, reste rapide avec une connexion faible et affiche une page hors connexion.
- **Administration** : ouvrez https://admin.sokoyakwetu.com dans Chrome → menu ⋮ → **Ajouter à l'écran d'accueil**. Dans **Plus → Mon compte → Alertes de commande payée**, activez le son et les notifications : une commande payée s'annonce même quand l'onglet est en arrière-plan, avec le nombre de commandes à préparer dans le titre (et sur l'icône quand le téléphone le permet).
- **Google Play** (plus tard) : créez l'application avec PWABuilder à partir de https://sokoyakwetu.com, puis reliez-la au site avec `sudo /opt/sokoyetu/android.sh 'EMPREINTE:SHA256'` (empreinte fournie par PWABuilder et la Play Console).

---

## 9. Sauvegardes

- Automatiques **chaque nuit** (7 dernières gardées) dans `/opt/sokoyetu/pb_data/backups`, téléchargeables depuis le tableau technique (`/_/` → Settings → Backups).
- Copie avant chaque mise à jour dans `/opt/sokoyetu/sauvegardes`.
- Recommandé en plus : activer les **sauvegardes DigitalOcean** du Droplet (copie hors du serveur).

---

## 10. Pour un développeur

```bash
npm install
npm run build        # → dist/sokoyetu-serveur.zip (le paquet à déposer sur GitHub)
npm run demo         # → dist/demo/ (démonstration sans serveur, données dans le navigateur)
npm test             # règles métier et icônes
bash outils/serveur-local.sh   # vrai serveur local (paiement en mode test) : http://localhost:8090 et http://admin.localhost:8090
```

Le détail technique (architecture, tests, conventions) est dans `A-LIRE-CLAUDE-CODE.md`.
