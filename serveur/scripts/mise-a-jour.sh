#!/bin/bash
# Sokoyetu — mise à jour de la boutique et de l'administration (produits, commandes, photos et réglages sont conservés)
#   sudo /opt/sokoyetu/mise-a-jour.sh                 (reprend l'adresse du paquet utilisée à l'installation)
#   sudo /opt/sokoyetu/mise-a-jour.sh https://.../sokoyetu-serveur.zip
#   sudo /opt/sokoyetu/mise-a-jour.sh /root/sokoyetu-serveur.zip     (fichier déjà copié sur le serveur)
set -euo pipefail
DIR=/opt/sokoyetu
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
PAQUET="${1:-$(cat "$DIR/.paquet" 2>/dev/null || true)}"
[ -n "$PAQUET" ] || { echo "Indiquez l'adresse du fichier sokoyetu-serveur.zip."; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
if [ -f "$PAQUET" ]; then
  echo "==> Paquet local : $PAQUET"; cp "$PAQUET" "$T/s.zip"
else
  echo "==> Téléchargement du paquet"
  curl -fsSL -H 'Cache-Control: no-cache' -o "$T/s.zip" "$PAQUET?t=$(date +%s)"
fi
python3 -m zipfile -e "$T/s.zip" "$T/s"
for d in pb_public pb_admin pb_hooks pb_migrations; do [ -d "$T/s/$d" ] || { echo "Paquet invalide : dossier $d absent."; exit 1; }; done

systemctl stop sokoyetu
echo "==> Sauvegarde de la base avant mise à jour"
mkdir -p "$DIR/sauvegardes"; chmod 700 "$DIR/sauvegardes"
(umask 077; tar -czf "$DIR/sauvegardes/avant-maj-$(date +%Y%m%d-%H%M).tar.gz" --exclude=pb_data/backups --exclude=pb_data/.autocert_cache -C "$DIR" pb_data)
ls -1t "$DIR"/sauvegardes/avant-maj-*.tar.gz | tail -n +4 | xargs -r rm -f

echo "==> Remplacement des fichiers"
for d in pb_hooks pb_migrations pb_admin; do rm -rf "${DIR:?}/$d"; cp -r "$T/s/$d" "$DIR/$d"; done
[ -d "$DIR/pb_public/.well-known" ] && mv "$DIR/pb_public/.well-known" "$T/wk"
rm -rf "${DIR:?}/pb_public"; cp -r "$T/s/pb_public" "$DIR/pb_public"
[ -d "$T/wk" ] && mv "$T/wk" "$DIR/pb_public/.well-known"
# Scripts d'entretien (y compris celui-ci, en cours d'exécution : remplacé par renommage, jamais réécrit sur place)
for f in "$T"/s/*.sh; do n=$(basename "$f"); [ "$n" = installer.sh ] && continue; install -m 700 "$f" "$DIR/.$n.nouveau" && mv -f "$DIR/.$n.nouveau" "$DIR/$n"; done
cp "$T/s/LISEZMOI.md" "$DIR/LISEZMOI.md" 2>/dev/null || true
echo "$PAQUET" > "$DIR/.paquet"
chown -R sokoyetu:sokoyetu "$DIR"
[ -f "$DIR/sokoyetu.env" ] && chown root:root "$DIR/sokoyetu.env" && chmod 600 "$DIR/sokoyetu.env"

echo "==> Mise à jour de la base"
sudo -u sokoyetu "$DIR/pocketbase" migrate up --dir="$DIR/pb_data" --hooksDir="$DIR/pb_hooks" --migrationsDir="$DIR/pb_migrations"
bash "$DIR/service.sh"
systemctl start sokoyetu; sleep 3
if systemctl is-active --quiet sokoyetu; then
  D=$(cat "$DIR/.domaine" 2>/dev/null || echo sokoyakwetu.com)
  echo "==> Mise à jour terminée. Boutique : https://$D · Administration : https://admin.$D"
else
  journalctl -u sokoyetu -n 30 --no-pager; exit 1
fi
