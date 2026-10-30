#!/bin/bash
# Sokoyetu — être prévenu si la boutique tombe ou va mal (serveur arrêté, sauvegarde manquée, paiement en panne…).
# Le serveur envoie un signal toutes les 5 minutes à un service d'alerte gratuit ; s'il n'arrive plus, ou s'il signale
# un problème, ce service vous prévient (e-mail, Telegram, application).
#   1. Créez un compte sur https://healthchecks.io, puis un « check » : période 5 minutes, délai de grâce 10 minutes.
#   2. Copiez son adresse de signal (https://hc-ping.com/…), puis :
#        sudo /opt/sokoyetu/alerte.sh https://hc-ping.com/VOTRE-IDENTIFIANT
#   sudo /opt/sokoyetu/alerte.sh test       envoie un signal tout de suite
#   sudo /opt/sokoyetu/alerte.sh arreter    plus d'alerte
#   sudo /opt/sokoyetu/alerte.sh            affiche le réglage actuel
set -euo pipefail
DIR=/opt/sokoyetu; ENV="$DIR/sokoyetu.env"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
touch "$ENV"; chmod 600 "$ENV"; chown root:root "$ENV"
actuelle() { grep -E '^SOKOYETU_ALERTE_URL=' "$ENV" | tail -1 | cut -d= -f2- || true; }
relancer() { systemctl restart sokoyetu && sleep 2 && systemctl is-active --quiet sokoyetu && echo "==> Service redémarré." || journalctl -u sokoyetu -n 20 --no-pager; }
case "${1:-}" in
  "")
    U=$(actuelle); [ -n "$U" ] && echo "Alerte branchée : $U" || echo "Aucune alerte branchée (voir l'aide en tête de ce fichier)." ;;
  test)
    U=$(actuelle); [ -n "$U" ] || { echo "Aucune alerte branchée."; exit 1; }
    curl -fsS -m 10 --retry 2 -X POST --data "Sokoyetu : signal de test envoyé depuis le serveur" "$U" >/dev/null && echo "==> Signal envoyé : il apparaît dans votre tableau Healthchecks." || { echo "Le service d'alerte ne répond pas à cette adresse."; exit 1; } ;;
  arreter)
    grep -v '^SOKOYETU_ALERTE_URL=' "$ENV" > "$ENV.tmp" || true; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Alerte débranchée."; relancer ;;
  https://*)
    echo "$1" | grep -Eq '^https://[^[:space:]"<>]{8,300}$' || { echo "Adresse invalide."; exit 1; }
    curl -fsS -m 10 --retry 2 -X POST --data "Sokoyetu : alerte branchée" "$1" >/dev/null || { echo "Cette adresse ne répond pas : vérifiez-la (https://hc-ping.com/…)."; exit 1; }
    grep -v '^SOKOYETU_ALERTE_URL=' "$ENV" > "$ENV.tmp" || true; echo "SOKOYETU_ALERTE_URL=$1" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Alerte branchée : un signal part toutes les 5 minutes."; relancer ;;
  *) echo "Usage : sudo $0 https://hc-ping.com/VOTRE-IDENTIFIANT   (ou test, arreter)"; exit 1 ;;
esac
