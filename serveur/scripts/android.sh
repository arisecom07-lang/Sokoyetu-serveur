#!/bin/bash
# Sokoyetu — relie l'application Google Play au site (fichier .well-known/assetlinks.json)
#   sudo /opt/sokoyetu/android.sh 'AB:CD:...:EF' ['12:34:...:56']   (une ou deux empreintes SHA-256 : PWABuilder, Play Console)
set -euo pipefail
DIR=/opt/sokoyetu; PKG="${PKG:-cd.sokoyetu.app}"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ $# -ge 1 ] || { echo "Usage : sudo $0 'EMPREINTE:SHA256' ['DEUXIÈME:EMPREINTE']"; exit 1; }
LIST=""
for FP in "$@"; do
  echo "$FP" | grep -Eq '^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$' || { echo "Empreinte invalide : $FP (32 paires de caractères séparées par « : »)"; exit 1; }
  LIST="$LIST${LIST:+,}\"$(echo "$FP" | tr 'a-f' 'A-F')\""
done
mkdir -p "$DIR/pb_public/.well-known"
printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":[%s]}}]\n' "$PKG" "$LIST" > "$DIR/pb_public/.well-known/assetlinks.json"
chown -R sokoyetu:sokoyetu "$DIR/pb_public/.well-known"
echo "==> Fichier en place : https://$(cat "$DIR/.domaine" 2>/dev/null || echo sokoyakwetu.com)/.well-known/assetlinks.json"
