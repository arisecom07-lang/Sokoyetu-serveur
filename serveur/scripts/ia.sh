#!/bin/bash
# Sokoyetu — active l'assistant IA des fiches produits (administration → Produits → « Ajouter avec l'IA »).
#   sudo /opt/sokoyetu/ia.sh 'sk-ant-...'     enregistre la clé de l'API Claude (console.anthropic.com → API Keys)
#   sudo /opt/sokoyetu/ia.sh plafond 200      au plus 200 appels à l'assistant par jour (150 par défaut ; fiches et cadrages de photos)
#   sudo /opt/sokoyetu/ia.sh --retirer        désactive l'assistant
# La clé reste sur le serveur (fichier lisible par l'administrateur du serveur seulement), jamais dans le navigateur.
# Le plafond du jour évite une facture imprévue ; fixez aussi une limite de dépense mensuelle sur console.anthropic.com (Settings → Limits).
set -euo pipefail
DIR=/opt/sokoyetu; ENV="$DIR/sokoyetu.env"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ $# -ge 1 ] || { echo "Usage : sudo $0 'sk-ant-...'   ou   sudo $0 plafond NOMBRE_PAR_JOUR   ou   sudo $0 --retirer"; exit 1; }
touch "$ENV"; chmod 600 "$ENV"; chown root:root "$ENV"
if [ "$1" = "plafond" ]; then
  echo "${2:-}" | grep -Eq '^[1-9][0-9]{0,4}$' || { echo "Usage : sudo $0 plafond NOMBRE_PAR_JOUR   (1 à 99999)"; exit 1; }
  grep -v '^SOKOYETU_IA_MAX_JOUR=' "$ENV" > "$ENV.tmp" || true
  echo "SOKOYETU_IA_MAX_JOUR=$2" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
  echo "==> Au plus $2 appels à l'assistant par jour."
else
  grep -v '^ANTHROPIC_API_KEY=' "$ENV" > "$ENV.tmp" || true
  if [ "$1" = "--retirer" ]; then
    mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Assistant IA désactivé."
  else
    echo "$1" | grep -Eq '^sk-ant-[A-Za-z0-9_-]{20,}$' || { rm -f "$ENV.tmp"; echo "Clé invalide : elle commence par sk-ant-"; exit 1; }
    echo "ANTHROPIC_API_KEY=$1" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Clé enregistrée."
  fi
fi
systemctl restart sokoyetu && sleep 2 && systemctl is-active --quiet sokoyetu && echo "==> Service redémarré." || journalctl -u sokoyetu -n 20 --no-pager
