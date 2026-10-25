#!/bin/bash
# Sokoyetu — lance la boutique et l'administration sur cet ordinateur, avec le vrai serveur PocketBase.
#   npm run build && bash outils/serveur-local.sh
#   boutique : http://localhost:8090      administration : http://admin.localhost:8090
#   compte de test : admin@sokoyetu.test / Sokoyetu-2026
set -euo pipefail
cd "$(dirname "$0")/.."
PB_VERSION=0.40.5
PB_SHA256=1dbea1b01eb3dfe64953513859d01e759c96650c4e3264fa4eecd54b769382e4
PB=.local/pocketbase
D=dist/sokoyetu-serveur
PORT=${PORT:-8090}
DATA=${DATA:-.local/pb_data}
mkdir -p .local
if [ ! -x "$PB" ]; then
  curl -fsSL -o .local/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
  echo "$PB_SHA256  .local/pb.zip" | sha256sum -c -
  python3 -m zipfile -e .local/pb.zip .local/pb && mv .local/pb/pocketbase "$PB" && chmod +x "$PB" && rm -rf .local/pb .local/pb.zip
fi
[ -d "$D" ] || { echo "Construisez d'abord le paquet : npm run build"; exit 1; }
ARGS=(--dir="$DATA" --hooksDir="$D/pb_hooks" --migrationsDir="$D/pb_migrations")
"$PB" migrate up "${ARGS[@]}" >/dev/null
"$PB" sokoyetu-admin admin@sokoyetu.test 'Sokoyetu-2026' "${ARGS[@]}" >/dev/null
"$PB" superuser upsert technique@sokoyetu.test 'Technique-2026' "${ARGS[@]}" >/dev/null
# Paiement en mode test (aucun argent) : confirmé au bout de quelques secondes, refusé si le numéro finit par 0000.
export SOKOYETU_PAIEMENT="${SOKOYETU_PAIEMENT:-simulation}" SOKOYETU_SIMULATION_DELAI="${SOKOYETU_SIMULATION_DELAI:-3}"
# Comptes clients en mode test : rien n'est envoyé (ni WhatsApp ni SMS), le code de connexion s'affiche à l'écran.
export SOKOYETU_WHATSAPP="${SOKOYETU_WHATSAPP-simulation}" SOKOYETU_SMS="${SOKOYETU_SMS-simulation}"
echo "Boutique : http://localhost:$PORT   ·   Administration : http://admin.localhost:$PORT   ·   Paiement : $SOKOYETU_PAIEMENT   ·   Codes : WhatsApp ${SOKOYETU_WHATSAPP:-fermé}, SMS ${SOKOYETU_SMS:-fermé}"
exec "$PB" serve --http=127.0.0.1:$PORT "${ARGS[@]}" --publicDir="$D/pb_public"
