# Sokoyetu

Boutique en ligne d'import Chine → Bukavu et Goma, payée par Mobile Money directement dans l'application (FlexPay), et son administration.

| Adresse | Application |
|---|---|
| https://sokoyakwetu.com | la boutique (dossier `src/boutique`) |
| https://admin.sokoyakwetu.com | l'administration (dossier `src/admin`) |

**`sokoyetu-serveur.zip`** (à la racine) est le paquet prêt à installer sur le serveur DigitalOcean. Son adresse de téléchargement, utilisée par les scripts d'installation et de mise à jour :

```
https://github.com/arisecom07-lang/Sokoyetu-serveur/raw/main/sokoyetu-serveur.zip
```

- Installation et mise à jour, pas à pas depuis un téléphone : [LISEZMOI.md](LISEZMOI.md)
- Ce qui a changé (version 2.3 : site solide face aux coupures et aux erreurs, double paiement, surveillance, sauvegardes vérifiées) : [CHANGEMENTS.md](CHANGEMENTS.md)
- Notes techniques pour reprendre le code : [A-LIRE-CLAUDE-CODE.md](A-LIRE-CLAUDE-CODE.md)

Reconstruire le paquet : `npm install && npm run build` (résultat dans `dist/sokoyetu-serveur.zip`, à copier à la racine).
