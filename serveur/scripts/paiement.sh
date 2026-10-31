#!/bin/bash
# Sokoyetu — paiement automatique par Mobile Money et par carte (la clé reste sur le serveur, jamais dans le navigateur).
#   sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'     paiements réels avec FlexPay (M-Pesa, Airtel, Orange, Afrimoney)
#   sudo /opt/sokoyetu/paiement.sh flexpay-essai CODE_MARCHAND 'JETON'  environnement d'essai de FlexPay
#   sudo /opt/sokoyetu/paiement.sh carte 'https://…'                  adresse du paiement par carte, si FlexPay en donne une autre
#                                                                     (sans adresse : celle par défaut) ; la carte s'active dans Réglages → Paiements
#   sudo /opt/sokoyetu/paiement.sh test                               mode test : paiements simulés, AUCUN argent encaissé
#   sudo /opt/sokoyetu/paiement.sh arreter                            plus de paiement : la boutique n'accepte plus de commande
#   sudo /opt/sokoyetu/paiement.sh                                    affiche le réglage actuel
set -euo pipefail
DIR=/opt/sokoyetu; ENV="$DIR/sokoyetu.env"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
touch "$ENV"; chmod 600 "$ENV"; chown root:root "$ENV"
actuel() { grep -E '^SOKOYETU_PAIEMENT=' "$ENV" | tail -1 | cut -d= -f2 || true; }
if [ $# -eq 0 ]; then
  M=$(actuel); [ -n "$M" ] || M="aucun (la boutique n'encaisse pas)"
  echo "Paiement : $M"
  grep -q '^FLEXPAY_MARCHAND=' "$ENV" && echo "FlexPay : code marchand $(grep '^FLEXPAY_MARCHAND=' "$ENV" | tail -1 | cut -d= -f2)" || true
  grep -q '^FLEXPAY_CARTE_URL=' "$ENV" && echo "Carte : $(grep '^FLEXPAY_CARTE_URL=' "$ENV" | tail -1 | cut -d= -f2-)" || true
  exit 0
fi
garder() { grep -vE '^(SOKOYETU_PAIEMENT|FLEXPAY_MARCHAND|FLEXPAY_JETON|FLEXPAY_URL)=' "$ENV" > "$ENV.tmp" || true; }
case "$1" in
  flexpay|flexpay-essai)
    [ $# -eq 3 ] || { echo "Usage : sudo $0 $1 CODE_MARCHAND 'JETON'"; exit 1; }
    echo "$2" | grep -Eq '^[A-Za-z0-9_-]{2,60}$' || { echo "Code marchand invalide."; exit 1; }
    [ ${#3} -ge 20 ] || { echo "Jeton trop court : copiez-le en entier depuis votre espace FlexPay."; exit 1; }
    garder
    { echo "SOKOYETU_PAIEMENT=flexpay"; echo "FLEXPAY_MARCHAND=$2"; echo "FLEXPAY_JETON=$3"; } >> "$ENV.tmp"
    [ "$1" = flexpay-essai ] && echo "FLEXPAY_URL=https://beta-backend.flexpay.cd/api/rest/v1" >> "$ENV.tmp"
    mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Paiement FlexPay activé$([ "$1" = flexpay-essai ] && echo " (environnement d'essai)")."
    echo "    Adresse de notification à donner à FlexPay : https://$(cat "$DIR/.domaine" 2>/dev/null || echo sokoyakwetu.com)/api/sokoyetu/notification/flexpay" ;;
  carte)
    grep -vE '^FLEXPAY_CARTE_URL=' "$ENV" > "$ENV.tmp" || true
    if [ $# -ge 2 ]; then
      echo "$2" | grep -Eq '^https://[A-Za-z0-9./_:?=&%-]+$' || { rm -f "$ENV.tmp"; echo "Adresse invalide : elle commence par https://"; exit 1; }
      echo "FLEXPAY_CARTE_URL=$2" >> "$ENV.tmp"
    fi
    mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Paiement par carte : $([ $# -ge 2 ] && echo "$2" || echo "adresse par défaut de FlexPay")." ;;
  test)
    garder; echo "SOKOYETU_PAIEMENT=simulation" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> MODE TEST : les paiements sont simulés, aucun argent n'est encaissé. À n'utiliser que pour essayer la boutique." ;;
  arreter)
    garder; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Paiement désactivé : la boutique n'accepte plus de commande." ;;
  *) echo "Choix inconnu : $1 (flexpay, flexpay-essai, carte, test ou arreter)"; exit 1 ;;
esac
systemctl restart sokoyetu && sleep 2 && systemctl is-active --quiet sokoyetu && echo "==> Service redémarré." || journalctl -u sokoyetu -n 20 --no-pager
