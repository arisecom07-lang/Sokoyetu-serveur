#!/bin/bash
# Sokoyetu — paiement automatique par Mobile Money (la clé reste sur le serveur, jamais dans le navigateur).
#   sudo /opt/sokoyetu/paiement.sh nyole                              paiements réels avec nyole : la clé secrète af_live_sec_… est demandée (rien ne s'affiche en la collant)
#   sudo /opt/sokoyetu/paiement.sh nyole-essai                        mode essai de nyole : clé af_test_sec_…, paiements simulés sur la page nyole, aucun argent
#   sudo /opt/sokoyetu/paiement.sh flexpay CODE_MARCHAND 'JETON'     paiements réels avec FlexPay (M-Pesa, Airtel, Orange, Afrimoney)
#   sudo /opt/sokoyetu/paiement.sh flexpay-essai CODE_MARCHAND 'JETON'  environnement d'essai de FlexPay
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
  grep -q '^NYOLE_CLE=af_test_' "$ENV" && echo "nyole : clé d'essai (aucun argent encaissé)" || true
  grep -q '^NYOLE_CLE=af_live_' "$ENV" && echo "nyole : clé réelle $(grep '^NYOLE_CLE=' "$ENV" | tail -1 | cut -d= -f2 | cut -c1-16)…" || true
  exit 0
fi
garder() { grep -vE '^(SOKOYETU_PAIEMENT|FLEXPAY_MARCHAND|FLEXPAY_JETON|FLEXPAY_URL|NYOLE_CLE|NYOLE_URL)=' "$ENV" > "$ENV.tmp" || true; }
DOMAINE=$(cat "$DIR/.domaine" 2>/dev/null || echo sokoyakwetu.com)
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
    echo "    Adresse de notification à donner à FlexPay : https://$DOMAINE/api/sokoyetu/notification/flexpay" ;;
  nyole|nyole-essai)
    [ "$1" = nyole ] && PREFIXE=af_live_sec_ || PREFIXE=af_test_sec_
    CLE=${2:-}
    if [ -z "$CLE" ]; then
      echo "Collez votre clé secrète nyole ($PREFIXE…, page « API et journaux » de app.nyole.com), puis Entrée :"
      read -rs CLE; echo
    fi
    CLE=$(printf '%s' "$CLE" | tr -d '[:space:]')
    echo "$CLE" | grep -Eq '^af_(live|test)_sec_[A-Za-z0-9_-]{8,200}$' || { echo "Clé invalide : copiez la clé SECRÈTE en entier (elle commence par af_live_sec_ ou af_test_sec_, pas af_…_pub_)."; exit 1; }
    case "$CLE" in "$PREFIXE"*) ;; *) echo "Cette clé ne correspond pas au choix « $1 » : utilisez $([ "$1" = nyole ] && echo "nyole-essai pour une clé af_test_sec_" || echo "nyole pour une clé af_live_sec_")."; exit 1 ;; esac
    garder
    { echo "SOKOYETU_PAIEMENT=nyole"; echo "NYOLE_CLE=$CLE"; } >> "$ENV.tmp"
    mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Paiement nyole activé$([ "$1" = nyole-essai ] && echo " en MODE ESSAI (aucun argent encaissé)")."
    echo "    Adresse du webhook à indiquer dans nyole (API et journaux) : https://$DOMAINE/api/sokoyetu/notification/nyole" ;;
  test)
    garder; echo "SOKOYETU_PAIEMENT=simulation" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> MODE TEST : les paiements sont simulés, aucun argent n'est encaissé. À n'utiliser que pour essayer la boutique." ;;
  arreter)
    garder; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Paiement désactivé : la boutique n'accepte plus de commande." ;;
  *) echo "Choix inconnu : $1 (nyole, nyole-essai, flexpay, flexpay-essai, test ou arreter)"; exit 1 ;;
esac
systemctl restart sokoyetu && sleep 2 && systemctl is-active --quiet sokoyetu && echo "==> Service redémarré." || journalctl -u sokoyetu -n 20 --no-pager
