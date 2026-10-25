#!/bin/bash
# Sokoyetu — active l'assistant IA des fiches produits (administration → Produits → « Ajouter avec l'IA »).
#   sudo /opt/sokoyetu/ia.sh 'sk-ant-...'     enregistre la clé de l'API Claude (console.anthropic.com → API Keys)
#   sudo /opt/sokoyetu/ia.sh --retirer        désactive l'assistant
# La clé reste sur le serveur (fichier lisible par l'administrateur du serveur seulement), jamais dans le navigateur.
set -euo pipefail
DIR=/opt/sokoyetu; ENV="$DIR/sokoyetu.env"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ $# -eq 1 ] || { echo "Usage : sudo $0 'sk-ant-...'   ou   sudo $0 --retirer"; exit 1; }
touch "$ENV"; chmod 600 "$ENV"; chown root:root "$ENV"
grep -v '^ANTHROPIC_API_KEY=' "$ENV" > "$ENV.tmp" || true
if [ "$1" = "--retirer" ]; then
  mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
  echo "==> Assistant IA désactivé."
else
  echo "$1" | grep -Eq '^sk-ant-[A-Za-z0-9_-]{20,}$' || { rm -f "$ENV.tmp"; echo "Clé invalide : elle commence par sk-ant-"; exit 1; }
  echo "ANTHROPIC_API_KEY=$1" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
  echo "==> Clé enregistrée."
fi
systemctl restart sokoyetu && sleep 2 && systemctl is-active --quiet sokoyetu && echo "==> Service redémarré." || journalctl -u sokoyetu -n 20 --no-pager
