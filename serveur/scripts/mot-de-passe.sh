#!/bin/bash
# Sokoyetu — nouveau mot de passe administrateur (mot de passe oublié)
#   sudo /opt/sokoyetu/mot-de-passe.sh vous@exemple.com 'NouveauMotDePasse'
set -euo pipefail
DIR=/opt/sokoyetu
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ $# -eq 2 ] || { echo "Usage : sudo $0 e-mail 'nouveau mot de passe'"; exit 1; }
sudo -u sokoyetu "$DIR/pocketbase" sokoyetu-admin "$1" "$2" --dir="$DIR/pb_data" --hooksDir="$DIR/pb_hooks" --migrationsDir="$DIR/pb_migrations"
