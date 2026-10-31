#!/bin/bash
# =====================================================================
#  Sokoyetu — protection du serveur (Ubuntu 24.04). Sans danger à relancer ; la boutique et ses données ne changent pas.
#    sudo /opt/sokoyetu/securite.sh             tout mettre en place, puis afficher le bilan
#    sudo /opt/sokoyetu/securite.sh etat        le bilan seulement, sans rien changer
#    sudo /opt/sokoyetu/securite.sh droits      les droits des fichiers seulement (refaits à chaque mise à jour)
#    sudo /opt/sokoyetu/securite.sh ssh-cles    connexion SSH par clé seulement, mot de passe refusé (si une clé est installée)
#
#  Mis en place :
#    1. Droits des fichiers : le service de la boutique (utilisateur sokoyetu) n'écrit que dans sa base (pb_data) ;
#       le programme, le code et les scripts appartiennent à root. Une faille dans la boutique ne peut ni les modifier,
#       ni prendre la main sur le serveur.
#    2. Service isolé : le reste du système en lecture seule pour lui, jamais vers le réseau interne ni vers le service de
#       métadonnées du nuage. S'il ne redémarre pas ainsi, la protection est retirée aussitôt : la boutique reste en ligne.
#    3. Pare-feu : seulement SSH (freiné), HTTP et HTTPS.
#    4. fail2ban : les adresses qui essaient des mots de passe SSH sont bannies une heure.
#    5. Mises à jour de sécurité d'Ubuntu chaque jour ; redémarrage la nuit (3 h 30 à Bukavu et Goma), seulement
#       quand une mise à jour du système l'exige.
# =====================================================================
set -euo pipefail
DIR="${SOKOYETU_DIR:-/opt/sokoyetu}"   # SOKOYETU_DIR : essais hors serveur
UNITE=/etc/systemd/system/sokoyetu.service.d
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -o DPkg::Lock::Timeout=900 -q)
installer() { dpkg -s "$@" >/dev/null 2>&1 || { "${APT[@]}" update >/dev/null && "${APT[@]}" install -y "$@" >/dev/null; }; }

droits() {
  chown root:root "$DIR"; chmod 755 "$DIR"
  for d in pb_hooks pb_migrations pb_public pb_admin; do
    [ -d "$DIR/$d" ] && { chown -R root:root "$DIR/$d"; chmod -R u=rwX,go=rX "$DIR/$d"; }
  done
  [ -f "$DIR/pocketbase" ] && { chown root:root "$DIR/pocketbase"; chmod 755 "$DIR/pocketbase"; }
  for f in "$DIR"/*.sh; do [ -f "$f" ] && { chown root:root "$f"; chmod 700 "$f"; }; done
  for f in "$DIR/LISEZMOI.md" "$DIR/.domaine" "$DIR/.paquet"; do [ -f "$f" ] && { chown root:root "$f"; chmod 644 "$f"; }; done
  mkdir -p "$DIR/pb_data" "$DIR/sauvegardes"
  chown -R sokoyetu:sokoyetu "$DIR/pb_data"; chmod 700 "$DIR/pb_data"
  # Copies d'avant mise à jour : à root seulement. Le résultat de la vérification des sauvegardes reste lisible par la
  # boutique (administration, Santé et journal).
  chown root:root "$DIR/sauvegardes"; chmod 711 "$DIR/sauvegardes"
  find "$DIR/sauvegardes" -mindepth 1 -maxdepth 1 -type f ! -name verification.json -exec chown root:root {} + -exec chmod 600 {} +
  if [ -f "$DIR/sauvegardes/verification.json" ]; then chown root:root "$DIR/sauvegardes/verification.json"; chmod 644 "$DIR/sauvegardes/verification.json"; fi
  if [ -f "$DIR/sokoyetu.env" ]; then chown root:root "$DIR/sokoyetu.env"; chmod 600 "$DIR/sokoyetu.env"; fi
  if [ -f /root/sokoyetu-acces.txt ]; then chmod 600 /root/sokoyetu-acces.txt; fi
  return 0
}

# La boutique répond-elle ? (le serveur tourne et répond en HTTP : redirection vers HTTPS ou page)
en_ligne() {
  local code
  for _ in $(seq 1 25); do
    sleep 1
    systemctl is-active --quiet sokoyetu || continue
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --noproxy '*' http://127.0.0.1/api/health 2>/dev/null || true)
    [ -n "$code" ] && [ "$code" != 000 ] && return 0
  done
  return 1
}

service_isole() {
  mkdir -p "$UNITE"
  cat > "$UNITE/securite.conf" <<UNIT
# Sokoyetu (securite.sh) : le service de la boutique ne voit et ne touche que ce dont il a besoin.
[Service]
ProtectSystem=strict
ReadWritePaths=
ReadWritePaths=$DIR/pb_data
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
UMask=0077
# Jamais vers le réseau interne ni le service de métadonnées du nuage (copie de photos, liens de fournisseurs…).
IPAddressDeny=169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7 fe80::/10
UNIT
  systemctl daemon-reload
  systemctl restart sokoyetu
  if en_ligne; then echo "    ✓ Service de la boutique isolé"; return 0; fi
  echo "    ✗ La boutique ne démarre pas avec cette protection : elle est retirée, la boutique reste en ligne."
  journalctl -u sokoyetu -n 12 --no-pager || true
  rm -f "$UNITE/securite.conf"; systemctl daemon-reload; systemctl restart sokoyetu
  en_ligne || echo "    ✗ La boutique ne redémarre pas : journalctl -u sokoyetu -n 50 --no-pager"
  return 1
}

pare_feu() {
  installer ufw
  ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
  ufw limit OpenSSH >/dev/null 2>&1 || ufw limit 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  echo "    ✓ Pare-feu : SSH (freiné au-delà de 6 connexions en 30 secondes), HTTP et HTTPS seulement"
}

fail2ban_ssh() {
  installer fail2ban || { echo "    ✗ fail2ban non installé (réseau ?) : relancez sudo $0 plus tard"; return 1; }
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/sokoyetu.local <<'JAIL'
# Sokoyetu (securite.sh) : 5 mots de passe SSH refusés en 10 minutes → adresse bannie une heure.
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban >/dev/null 2>&1 || true
  sleep 2
  if systemctl is-active --quiet fail2ban; then echo "    ✓ fail2ban surveille les connexions SSH"; return 0; fi
  echo "    ✗ fail2ban ne démarre pas : journalctl -u fail2ban -n 20 --no-pager"; return 1
}

mises_a_jour() {
  installer unattended-upgrades || { echo "    ✗ Mises à jour automatiques non installées (réseau ?) : relancez sudo $0 plus tard"; return 1; }
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT
  # 1 h 30 UTC = 3 h 30 à Bukavu et Goma, écrit à l'heure du serveur.
  local heure; heure=$(date -d '01:30 UTC' +%H:%M 2>/dev/null || echo 01:30)
  cat > /etc/apt/apt.conf.d/52sokoyetu-securite <<APT
// Sokoyetu (securite.sh) : redémarrage la nuit, seulement quand une mise à jour du système l'exige ;
// la boutique repart d'elle-même en une minute environ.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "$heure";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
APT
  echo "    ✓ Mises à jour de sécurité chaque jour ; redémarrage à $heure (heure du serveur) seulement si nécessaire"
}

cles_ssh() {
  local n=0 f
  for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
    [ -f "$f" ] && n=$(( n + $(grep -cE '^[[:space:]]*(ssh-|ecdsa-|sk-)' "$f" || true) ))
  done
  echo "$n"
}
mot_de_passe_ssh() { mkdir -p /run/sshd; sshd -T 2>/dev/null | awk '/^passwordauthentication /{print $2}'; }

ssh_cles() {
  local n; n=$(cles_ssh)
  if [ "$n" -eq 0 ]; then
    echo "Aucune clé SSH sur ce serveur : la connexion par mot de passe reste active (sinon plus personne ne pourrait se connecter)."
    echo "Ajoutez d'abord une clé (DigitalOcean : Settings → Security → SSH Keys), puis relancez : sudo $0 ssh-cles"; exit 1
  fi
  cat > /etc/ssh/sshd_config.d/10-sokoyetu.conf <<'SSH'
# Sokoyetu (securite.sh ssh-cles) : connexion SSH par clé seulement.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSH
  mkdir -p /run/sshd
  if ! sshd -t; then rm -f /etc/ssh/sshd_config.d/10-sokoyetu.conf; echo "Configuration SSH refusée : rien n'a changé."; exit 1; fi
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  echo "==> SSH : connexion par clé seulement ($n clé(s) installée(s))."
  echo "    Gardez cette fenêtre ouverte et vérifiez qu'une nouvelle connexion fonctionne avant de la fermer."
  echo "    Pour revenir en arrière : sudo rm /etc/ssh/sshd_config.d/10-sokoyetu.conf && sudo systemctl reload ssh"
}

bilan() {
  echo "Bilan de sécurité du serveur :"
  local ok="  ✓" non="  ✗" note="  •"
  if [ "$(stat -c %U "$DIR/pocketbase" 2>/dev/null)" = root ] && [ "$(stat -c %U "$DIR/pb_hooks" 2>/dev/null)" = root ] && [ "$(stat -c %U "$DIR/pb_data" 2>/dev/null)" = sokoyetu ]; then
    echo "$ok Droits des fichiers : programme, code et scripts à root ; la boutique n'écrit que dans sa base"
  else echo "$non Droits des fichiers à corriger : sudo $0 droits"; fi
  if [ -f "$UNITE/securite.conf" ]; then echo "$ok Service de la boutique isolé (système en lecture seule, réseau interne interdit)"
  else echo "$non Service de la boutique non isolé : sudo $0"; fi
  if ufw status 2>/dev/null | grep -q "Status: active"; then
    echo "$ok Pare-feu actif, ports ouverts : $(ufw status 2>/dev/null | grep -E 'ALLOW|LIMIT' | grep -v '(v6)' | awk '{print $1}' | sort -u | tr '\n' ' ')"
  else echo "$non Pare-feu inactif : sudo $0"; fi
  if systemctl is-active --quiet fail2ban 2>/dev/null; then
    echo "$ok fail2ban actif ($(fail2ban-client status sshd 2>/dev/null | awk '/Currently banned/ {print $NF}') adresse(s) bannie(s) en ce moment, $(fail2ban-client status sshd 2>/dev/null | awk '/Total banned/ {print $NF}') depuis son démarrage)"
  else echo "$non fail2ban absent : sudo $0"; fi
  if grep -qs 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades; then
    echo "$ok Mises à jour de sécurité automatiques$(grep -qs 'Automatic-Reboot "true"' /etc/apt/apt.conf.d/52sokoyetu-securite && echo ', redémarrage la nuit si nécessaire')"
  else echo "$non Mises à jour automatiques inactives : sudo $0"; fi
  if [ -f /var/run/reboot-required ]; then echo "$note Un redémarrage termine une mise à jour du système : sudo reboot (ou automatiquement la nuit)."; fi
  local mdp; mdp=$(mot_de_passe_ssh || true)
  if [ "$mdp" = no ]; then echo "$ok SSH : connexion par clé seulement"
  elif [ "$(cles_ssh)" -gt 0 ]; then echo "$note SSH : le mot de passe est encore accepté alors qu'une clé est installée. Conseillé : sudo $0 ssh-cles"
  else echo "$note SSH : connexion par mot de passe (aucune clé installée) ; fail2ban bannit les adresses qui en essaient. Gardez un mot de passe long."; fi
  if [ -f "$DIR/sokoyetu.env" ]; then
    if [ "$(stat -c %a "$DIR/sokoyetu.env")" = 600 ] && [ "$(stat -c %U "$DIR/sokoyetu.env")" = root ]; then echo "$ok Clés du paiement, des codes et de l'IA lisibles par root seulement"
    else echo "$non sokoyetu.env trop ouvert : sudo $0 droits"; fi
  fi
  echo "$note Sauvegardes : chaque nuit sur ce serveur. Pour en garder aussi ailleurs, activez les sauvegardes du Droplet chez DigitalOcean (onglet Backups)."
}

case "${1:-tout}" in
  tout)
    echo "==> Droits des fichiers"; droits; echo "    ✓ Programme, code et scripts à root ; la boutique n'écrit que dans sa base"
    echo "==> Service de la boutique"; service_isole || true
    echo "==> Pare-feu"; pare_feu
    echo "==> Connexions SSH"; fail2ban_ssh || true
    echo "==> Mises à jour du système"; mises_a_jour || true
    echo; bilan ;;
  etat) bilan ;;
  droits) droits ;;
  ssh-cles) ssh_cles ;;
  *) echo "Choix inconnu : $1 (etat, droits ou ssh-cles ; sans rien : tout)"; exit 1 ;;
esac
