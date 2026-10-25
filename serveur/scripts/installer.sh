#!/bin/bash
# =====================================================================
#  Sokoyetu — installation du serveur (Ubuntu 24.04, DigitalOcean)
#  Lancé automatiquement par le script de démarrage du Droplet, ou à la main :
#    sudo EMAIL=vous@exemple.com MOT_DE_PASSE='...' bash installer.sh
#  Boutique : https://sokoyakwetu.com · Administration : https://admin.sokoyakwetu.com
# =====================================================================
set -euo pipefail
DOMAINE="${DOMAINE:-sokoyakwetu.com}"
EMAIL="${EMAIL:?Indiquez EMAIL (votre e-mail administrateur)}"
MOT_DE_PASSE="${MOT_DE_PASSE:?Indiquez MOT_DE_PASSE (10 caractères minimum)}"
PAQUET="${PAQUET:-}"
PB_VERSION="0.40.5"
PB_SHA256="1dbea1b01eb3dfe64953513859d01e759c96650c4e3264fa4eecd54b769382e4"
DIR=/opt/sokoyetu
SRC="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ ${#MOT_DE_PASSE} -ge 10 ] || { echo "Mot de passe trop court (10 caractères minimum)."; exit 1; }
echo "==> Sokoyetu : installation pour $DOMAINE"

# Outils (déjà présents sur Ubuntu 24.04 ; installés seulement s'ils manquent)
for c in curl ufw python3; do
  command -v $c >/dev/null 2>&1 || { apt-get -o DPkg::Lock::Timeout=900 update -q && apt-get -o DPkg::Lock::Timeout=900 install -y -q curl ufw python3; break; }
done

# Mémoire d'appoint (utile sur les petits serveurs de 1 Go)
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id sokoyetu >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin sokoyetu
mkdir -p "$DIR/pb_data"

# PocketBase (version figée, empreinte vérifiée)
if [ ! -x "$DIR/pocketbase" ] || ! "$DIR/pocketbase" --version | grep -q "$PB_VERSION"; then
  T=$(mktemp -d)
  curl -fsSL -o "$T/pb.zip" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
  echo "$PB_SHA256  $T/pb.zip" | sha256sum -c -
  python3 -m zipfile -e "$T/pb.zip" "$T/x" && install -m 755 "$T/x/pocketbase" "$DIR/pocketbase" && rm -rf "$T"
fi

# Fichiers de la boutique et de l'administration
if [ ! -d "$SRC/pb_hooks" ]; then
  [ -n "$PAQUET" ] || { echo "Paquet introuvable : indiquez PAQUET (adresse du fichier sokoyetu-serveur.zip)."; exit 1; }
  T=$(mktemp -d)
  if [ -f "$PAQUET" ]; then cp "$PAQUET" "$T/s.zip"; else curl -fsSL -o "$T/s.zip" "$PAQUET"; fi
  python3 -m zipfile -e "$T/s.zip" "$T/s"; SRC="$T/s"
fi
for d in pb_hooks pb_migrations pb_admin; do rm -rf "${DIR:?}/$d"; cp -r "$SRC/$d" "$DIR/$d"; done
WK=$(mktemp -d); [ -d "$DIR/pb_public/.well-known" ] && mv "$DIR/pb_public/.well-known" "$WK/"
rm -rf "${DIR:?}/pb_public"; cp -r "$SRC/pb_public" "$DIR/pb_public"
[ -d "$WK/.well-known" ] && mv "$WK/.well-known" "$DIR/pb_public/.well-known"; rm -rf "$WK"
for f in mise-a-jour.sh mot-de-passe.sh android.sh ia.sh service.sh; do cp "$SRC/$f" "$DIR/$f"; chmod 700 "$DIR/$f"; done
cp "$SRC/LISEZMOI.md" "$DIR/LISEZMOI.md" 2>/dev/null || true
[ -n "$PAQUET" ] && echo "$PAQUET" > "$DIR/.paquet"
echo "$DOMAINE" > "$DIR/.domaine"
chown -R sokoyetu:sokoyetu "$DIR"
[ -f "$DIR/sokoyetu.env" ] && chown root:root "$DIR/sokoyetu.env" && chmod 600 "$DIR/sokoyetu.env"

PB() { sudo -u sokoyetu "$DIR/pocketbase" "$@" --dir="$DIR/pb_data" --hooksDir="$DIR/pb_hooks" --migrationsDir="$DIR/pb_migrations"; }
systemctl stop sokoyetu 2>/dev/null || true
PB migrate up
PB sokoyetu-admin "$EMAIL" "$MOT_DE_PASSE"
# Compte technique (tableau /_/), mot de passe aléatoire gardé pour l'administrateur du serveur
if [ ! -f /root/sokoyetu-acces.txt ]; then
  SU_PASS=$(od -An -N18 -tx1 /dev/urandom | tr -d ' \n')
  PB superuser upsert "$EMAIL" "$SU_PASS"
  printf "Tableau technique : https://%s/_/\nE-mail : %s\nMot de passe : %s\n" "$DOMAINE" "$EMAIL" "$SU_PASS" > /root/sokoyetu-acces.txt
  chmod 600 /root/sokoyetu-acces.txt
fi

DOMAINE="$DOMAINE" bash "$DIR/service.sh"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
systemctl restart sokoyetu
sleep 3
if systemctl is-active --quiet sokoyetu; then
  echo "==> Sokoyetu est en ligne."
  echo "    Boutique       : https://$DOMAINE"
  echo "    Administration : https://admin.$DOMAINE  (e-mail : $EMAIL)"
  echo "    Les adresses répondent dès que le nom de domaine pointe vers ce serveur (enregistrements A : @, www et admin)."
else
  journalctl -u sokoyetu -n 30 --no-pager; exit 1
fi
