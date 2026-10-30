#!/bin/bash
# =====================================================================
#  Sokoyetu — sauvegardes de la base : les lister, en faire une, vérifier qu'elles se restaurent, restaurer.
#    sudo /opt/sokoyetu/sauvegarde.sh liste
#    sudo /opt/sokoyetu/sauvegarde.sh maintenant              sauvegarde immédiate (la boutique reste ouverte)
#    sudo /opt/sokoyetu/sauvegarde.sh verifier [FICHIER]      restaure une copie à part et la contrôle (la plus récente par défaut)
#    sudo /opt/sokoyetu/sauvegarde.sh restaurer FICHIER       remet la boutique dans l'état de cette sauvegarde
#  Les sauvegardes automatiques ont lieu chaque nuit (pb_data/backups, 7 gardées) ; une vérification automatique
#  tourne chaque dimanche (minuterie sokoyetu-sauvegarde). Le résultat s’affiche dans l’administration (Plus → Santé et journal).
# =====================================================================
set -euo pipefail
DIR="${SOKOYETU_DIR:-/opt/sokoyetu}"
PB="${SOKOYETU_PB:-$DIR/pocketbase}"
DATA="$DIR/pb_data"; AUTO="$DATA/backups"; SAUV="$DIR/sauvegardes"
UTILISATEUR="${SOKOYETU_UTILISATEUR:-sokoyetu}"
ESSAI="${SOKOYETU_ESSAI:-}"   # essais hors serveur : ni sudo ni systemctl

[ -n "$ESSAI" ] || [ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
mkdir -p "$SAUV"; chmod 700 "$SAUV"
proprietaire() { [ -n "$ESSAI" ] || chown -R "$UTILISATEUR:$UTILISATEUR" "$@"; }
taille() { du -sh "$1" 2>/dev/null | cut -f1; }

# Fichier donné par son nom (dans pb_data/backups ou sauvegardes/) ou par son chemin.
resoudre() {
  local f="$1"
  for c in "$f" "$AUTO/$f" "$SAUV/$f"; do [ -f "$c" ] && { echo "$c"; return; }; done
  echo ""
}
plus_recente() { ls -1t "$AUTO"/*.zip 2>/dev/null | head -1 || true; }

# Décompresse une sauvegarde (zip de PocketBase ou tar.gz d'avant mise à jour) dans $2 ; renvoie le dossier pb_data.
extraire() {
  local f="$1" dest="$2"
  case "$f" in
    *.zip) python3 -I -m zipfile -e "$f" "$dest" >/dev/null 2>&1 || { echo "Fichier zip illisible : $(basename "$f")" >&2; return 1; }; echo "$dest" ;;
    *.tar.gz) tar -xzf "$f" -C "$dest"; echo "$dest/pb_data" ;;
    *) echo "Format inconnu : $f (zip ou tar.gz)" >&2; return 1 ;;
  esac
}

liste() {
  echo "Sauvegardes automatiques (chaque nuit) :"
  ls -1t "$AUTO"/*.zip 2>/dev/null | while read -r f; do echo "  $(basename "$f")  ·  $(taille "$f")  ·  $(date -r "$f" '+%d/%m/%Y %H:%M')"; done || true
  echo "Copies d'avant mise à jour ou restauration :"
  ls -1t "$SAUV"/*.tar.gz 2>/dev/null | while read -r f; do echo "  $(basename "$f")  ·  $(taille "$f")  ·  $(date -r "$f" '+%d/%m/%Y %H:%M')"; done || true
  [ -f "$SAUV/verification.json" ] && echo "Dernière vérification : $(cat "$SAUV/verification.json")" || echo "Aucune vérification pour l'instant : sudo $0 verifier"
}

# Copie cohérente de la base pendant que la boutique tourne (API de sauvegarde de SQLite), plus les photos envoyées.
maintenant() {
  local T; T=$(mktemp -d); trap 'rm -rf "$T"' RETURN
  mkdir -p "$AUTO" "$T/copie"
  for db in data.db auxiliary.db; do
    [ -f "$DATA/$db" ] && python3 -I -c "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$DATA/$db" "$T/copie/$db"
  done
  [ -d "$DATA/storage" ] && cp -a "$DATA/storage" "$T/copie/storage"
  local nom="@manuel_sokoyetu_$(date -u +%Y%m%d%H%M%S).zip"
  python3 -I -c "
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(base, f); z.write(p, os.path.relpath(p, src))
" "$T/copie" "$AUTO/$nom"
  proprietaire "$AUTO/$nom"
  echo "==> Sauvegarde faite : $nom ($(taille "$AUTO/$nom"))"
}

# Écrit le résultat de la vérification (lu par l'administration) ; $1 = ok (true/false), $2 = fichier, $3 = message.
resultat() {
  python3 -I -c "import json,sys,time; print(json.dumps({'quand': int(time.time()*1000), 'ok': sys.argv[1] == 'true', 'fichier': sys.argv[2], 'message': sys.argv[3]}, ensure_ascii=False))" "$1" "$2" "$3" > "$SAUV/verification.json"
  proprietaire "$SAUV/verification.json"
}

verifier() {
  local f; f=$(resoudre "${1:-$(plus_recente)}")
  if [ -z "$f" ]; then
    resultat false "" "Aucune sauvegarde à vérifier."
    echo "Aucune sauvegarde trouvée (la première a lieu dans la nuit). Faites-en une : sudo $0 maintenant"; exit 1
  fi
  local nom; nom=$(basename "$f")
  # Place disque : la copie décompressée prend environ trois fois la taille du fichier.
  local besoin libre; besoin=$(( $(stat -c %s "$f") * 3 / 1024 )); libre=$(df -Pk "${TMPDIR:-/tmp}" | awk 'NR==2 {print $4}')
  if [ "$libre" -lt "$besoin" ]; then resultat false "$nom" "Pas assez de place sur le disque pour vérifier."; echo "Pas assez de place sur le disque pour vérifier $nom."; exit 1; fi

  T=$(mktemp -d); PID=""
  # Jamais « kill 0 » (tout le groupe de processus) : seulement le PocketBase d'essai, s'il tourne encore.
  trap '[ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -rf "$T"' EXIT
  echo "==> Vérification de $nom ($(taille "$f"))"
  local copie; copie=$(extraire "$f" "$T") || { resultat false "$nom" "Fichier illisible."; exit 1; }
  [ -f "$copie/data.db" ] || { resultat false "$nom" "La sauvegarde ne contient pas la base (data.db)."; echo "✗ data.db absent de la sauvegarde."; exit 1; }

  # 1. La base est intacte, et voici ce qu'elle contient.
  local bilan
  if ! bilan=$(python3 -I - "$copie/data.db" <<'PY'
import sqlite3, sys
db = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
etat = db.execute('PRAGMA integrity_check').fetchone()[0]
if etat != 'ok':
    print('Base endommagée : ' + etat); sys.exit(1)
def n(t):
    try: return db.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0]
    except Exception: return 0
print('%d commandes, %d articles, %d photos, %d comptes clients' % (n('orders'), n('products'), n('media'), n('clients')))
PY
  ); then resultat false "$nom" "$bilan"; echo "✗ $bilan"; exit 1; fi
  echo "    Base intacte : $bilan"
  local fichiers=0; [ -d "$copie/storage" ] && fichiers=$(find "$copie/storage" -type f | wc -l)
  echo "    Fichiers envoyés (photos, vidéos) : $fichiers"

  # 2. PocketBase redémarre sur cette copie (migrations à jour), sans les règles de la boutique ni ses tâches.
  mkdir -p "$T/vide"
  local PORT=$(( 18000 + RANDOM % 1000 ))
  "$PB" serve --http="127.0.0.1:$PORT" --dir="$copie" --hooksDir="$T/vide" --migrationsDir="$DIR/pb_migrations" --publicDir="$T/vide" > "$T/pb.log" 2>&1 &
  PID=$!
  local ok=false
  for i in $(seq 1 60); do
    if curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q 200; then ok=true; break; fi
    sleep 0.5
  done
  kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""
  if [ "$ok" != true ]; then
    resultat false "$nom" "La copie restaurée ne démarre pas : $(tail -3 "$T/pb.log" | tr '\n' ' ' | cut -c1-200)"
    echo "✗ La copie restaurée ne démarre pas :"; tail -5 "$T/pb.log"; exit 1
  fi
  resultat true "$nom" "Restauration réussie : $bilan, $fichiers fichiers."
  echo "✓ $nom se restaure : $bilan, $fichiers fichiers."
}

restaurer() {
  [ -n "${1:-}" ] || { echo "Usage : sudo $0 restaurer FICHIER   (voir : sudo $0 liste)"; exit 1; }
  local f; f=$(resoudre "$1"); [ -n "$f" ] || { echo "Sauvegarde introuvable : $1"; exit 1; }
  if [ "${2:-}" != "--oui" ]; then
    echo "La boutique va revenir à l'état de $(basename "$f") : les commandes et changements faits depuis seront perdus."
    echo "(Une copie de l'état actuel est gardée dans $SAUV.)"
    read -r -p "Tapez RESTAURER pour continuer : " r; [ "$r" = "RESTAURER" ] || { echo "Annulé."; exit 1; }
  fi
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  local copie; copie=$(extraire "$f" "$T")
  [ -f "$copie/data.db" ] || { echo "✗ Cette sauvegarde ne contient pas la base (data.db) : rien n'a été changé."; exit 1; }
  [ -n "$ESSAI" ] || systemctl stop sokoyetu
  local securite="$SAUV/avant-restauration-$(date +%Y%m%d-%H%M).tar.gz"
  (umask 077; tar -czf "$securite" --exclude=pb_data/backups --exclude=pb_data/.autocert_cache -C "$DIR" pb_data)
  echo "==> État actuel gardé : $(basename "$securite")"
  # Tout pb_data est remplacé, sauf les sauvegardes et les certificats HTTPS.
  find "$DATA" -mindepth 1 -maxdepth 1 ! -name backups ! -name .autocert_cache -exec rm -rf {} +
  ( cd "$copie" && find . -mindepth 1 -maxdepth 1 ! -name backups ! -name .autocert_cache -exec cp -a {} "$DATA/" \; )
  proprietaire "$DATA"
  if [ -n "$ESSAI" ]; then "$PB" migrate up --dir="$DATA" --migrationsDir="$DIR/pb_migrations" >/dev/null
  else sudo -u "$UTILISATEUR" "$PB" migrate up --dir="$DATA" --hooksDir="$DIR/pb_hooks" --migrationsDir="$DIR/pb_migrations" >/dev/null; fi
  if [ -z "$ESSAI" ]; then
    systemctl start sokoyetu; sleep 3
    systemctl is-active --quiet sokoyetu || { journalctl -u sokoyetu -n 30 --no-pager; echo "✗ La boutique ne redémarre pas : sudo $0 restaurer $(basename "$securite") pour revenir en arrière."; exit 1; }
  fi
  echo "✓ Boutique restaurée depuis $(basename "$f")."
}

case "${1:-liste}" in
  liste) liste ;;
  maintenant) maintenant ;;
  verifier) verifier "${2:-}" ;;
  restaurer) restaurer "${2:-}" "${3:-}" ;;
  *) echo "Choix inconnu : $1 (liste, maintenant, verifier ou restaurer)"; exit 1 ;;
esac
