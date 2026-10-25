#!/bin/bash
# Sokoyetu — envoi des codes de connexion des comptes clients : WhatsApp d'abord, SMS en secours (les clés restent sur le serveur).
#   sudo /opt/sokoyetu/codes.sh whatsapp ID_DU_NUMERO 'JETON' [MODELE] [LANGUE]   codes envoyés sur WhatsApp (API WhatsApp Business de Meta)
#   sudo /opt/sokoyetu/codes.sh sms-twilio SID_DU_COMPTE 'JETON' EXPEDITEUR       SMS de secours par Twilio (EXPEDITEUR : +1… ou un nom)
#   sudo /opt/sokoyetu/codes.sh sms-plivo AUTH_ID 'JETON' EXPEDITEUR             SMS de secours par Plivo
#   sudo /opt/sokoyetu/codes.sh plafond 300                                     au plus 300 codes par jour pour toute la boutique (200 par défaut)
#   sudo /opt/sokoyetu/codes.sh test                                            mode test : rien n'est envoyé, le code s'affiche à l'écran (JAMAIS pour le public)
#   sudo /opt/sokoyetu/codes.sh sans-whatsapp | sans-sms                        ferme un des deux canaux
#   sudo /opt/sokoyetu/codes.sh arreter                                         plus de comptes : les clients commandent sans compte
#   sudo /opt/sokoyetu/codes.sh                                                 affiche le réglage actuel
set -euo pipefail
DIR=/opt/sokoyetu; ENV="$DIR/sokoyetu.env"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
touch "$ENV"; chmod 600 "$ENV"; chown root:root "$ENV"
valeur() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
if [ $# -eq 0 ]; then
  W=$(valeur SOKOYETU_WHATSAPP); S=$(valeur SOKOYETU_SMS)
  echo "WhatsApp : ${W:-fermé}$([ "$W" = meta ] && echo " · modèle $(valeur WHATSAPP_MODELE | grep . || echo code_connexion)")"
  echo "SMS : ${S:-fermé}"
  [ -n "$W$S" ] || echo "Aucun canal : pas de comptes clients, les clients commandent sans compte."
  echo "Plafond : $(valeur SOKOYETU_SMS_MAX_JOUR | grep . || echo 200) codes par jour"
  exit 0
fi
garder() { grep -vE "^($1)=" "$ENV" > "$ENV.tmp" || true; }
WA='SOKOYETU_WHATSAPP|WHATSAPP_NUMERO|WHATSAPP_JETON|WHATSAPP_MODELE|WHATSAPP_LANGUE'
SMS='SOKOYETU_SMS|TWILIO_COMPTE|TWILIO_JETON|TWILIO_EXPEDITEUR|PLIVO_COMPTE|PLIVO_JETON|PLIVO_EXPEDITEUR'
case "$1" in
  whatsapp)
    [ $# -ge 3 ] || { echo "Usage : sudo $0 whatsapp ID_DU_NUMERO 'JETON' [MODELE] [LANGUE]"; exit 1; }
    echo "$2" | grep -Eq '^[0-9]{6,30}$' || { echo "Identifiant du numéro invalide : c'est le « Phone number ID » (des chiffres) dans WhatsApp Manager → API."; exit 1; }
    [ ${#3} -ge 40 ] || { echo "Jeton trop court : copiez en entier le jeton d'accès permanent (utilisateur système)."; exit 1; }
    M="${4:-code_connexion}"; L="${5:-fr}"
    echo "$M" | grep -Eq '^[a-z0-9_]{1,512}$' || { echo "Nom de modèle invalide (minuscules, chiffres et _)."; exit 1; }
    garder "$WA"
    { echo "SOKOYETU_WHATSAPP=meta"; echo "WHATSAPP_NUMERO=$2"; echo "WHATSAPP_JETON=$3"; echo "WHATSAPP_MODELE=$M"; echo "WHATSAPP_LANGUE=$L"; } >> "$ENV.tmp"
    # Le mode test des SMS ne reste jamais à côté d'un vrai canal.
    [ "$(valeur SOKOYETU_SMS)" = simulation ] && { grep -vE "^($SMS)=" "$ENV.tmp" > "$ENV.tmp2" || true; mv "$ENV.tmp2" "$ENV.tmp"; }
    mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Codes envoyés sur WhatsApp (modèle $M, langue $L). Essayez tout de suite avec votre propre téléphone : Mon compte → Créer mon compte." ;;
  sms-twilio|sms-plivo)
    [ $# -eq 4 ] || { echo "Usage : sudo $0 $1 IDENTIFIANT 'JETON' EXPEDITEUR"; exit 1; }
    echo "$2" | grep -Eq '^[A-Za-z0-9]{10,64}$' || { echo "Identifiant du compte invalide : copiez-le depuis votre tableau de bord."; exit 1; }
    [ ${#3} -ge 16 ] || { echo "Jeton trop court : copiez-le en entier."; exit 1; }
    echo "$4" | grep -Eq '^(\+[0-9]{8,15}|[A-Za-z0-9 ]{2,11})$' || { echo "Expéditeur invalide : un numéro (+1…) ou un nom de 11 caractères au plus."; exit 1; }
    F=${1#sms-}; P=$(echo "$F" | tr a-z A-Z)
    garder "$SMS"
    { echo "SOKOYETU_SMS=$F"; echo "${P}_COMPTE=$2"; echo "${P}_JETON=$3"; echo "${P}_EXPEDITEUR=$4"; } >> "$ENV.tmp"
    [ "$(valeur SOKOYETU_WHATSAPP)" = simulation ] && { grep -vE "^($WA)=" "$ENV.tmp" > "$ENV.tmp2" || true; mv "$ENV.tmp2" "$ENV.tmp"; }
    mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> SMS de secours envoyés par $F." ;;
  plafond)
    echo "${2:-}" | grep -Eq '^[0-9]{1,5}$' || { echo "Usage : sudo $0 plafond NOMBRE_PAR_JOUR"; exit 1; }
    garder SOKOYETU_SMS_MAX_JOUR; echo "SOKOYETU_SMS_MAX_JOUR=$2" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Au plus $2 codes par jour." ;;
  test)
    garder "$WA|$SMS"; { echo "SOKOYETU_WHATSAPP=simulation"; echo "SOKOYETU_SMS=simulation"; } >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> MODE TEST : rien n'est envoyé, le code s'affiche à l'écran. N'importe qui peut alors entrer dans n'importe quel compte : à n'utiliser que pour essayer." ;;
  sans-whatsapp) garder "$WA"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"; echo "==> WhatsApp fermé." ;;
  sans-sms) garder "$SMS"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"; echo "==> SMS fermé." ;;
  arreter)
    garder "$WA|$SMS"; mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
    echo "==> Comptes clients fermés : les clients commandent sans compte, comme avant." ;;
  *) echo "Choix inconnu : $1 (whatsapp, sms-twilio, sms-plivo, plafond, test, sans-whatsapp, sans-sms ou arreter)"; exit 1 ;;
esac
systemctl restart sokoyetu && sleep 2 && systemctl is-active --quiet sokoyetu && echo "==> Service redémarré." || journalctl -u sokoyetu -n 20 --no-pager
