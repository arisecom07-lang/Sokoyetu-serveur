#!/bin/bash
# Sokoyetu — installe ou met à jour le service automatique (démarrage avec le serveur, redémarrage en cas d'arrêt).
#   Appelé par installer.sh et mise-a-jour.sh ; à la main : sudo /opt/sokoyetu/service.sh
set -euo pipefail
DIR=/opt/sokoyetu
DOMAINE="${DOMAINE:-$(cat "$DIR/.domaine" 2>/dev/null || echo sokoyakwetu.com)}"
[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }

cat > /etc/systemd/system/sokoyetu.service <<UNIT
[Unit]
Description=Sokoyetu (boutique, administration et base de données)
After=network-online.target
Wants=network-online.target

[Service]
User=sokoyetu
Group=sokoyetu
WorkingDirectory=$DIR
Environment=SOKOYETU_DOMAINE=$DOMAINE
EnvironmentFile=-$DIR/sokoyetu.env
ExecStart=$DIR/pocketbase serve $DOMAINE www.$DOMAINE admin.$DOMAINE --dir=$DIR/pb_data --hooksDir=$DIR/pb_hooks --migrationsDir=$DIR/pb_migrations --publicDir=$DIR/pb_public --hooksWatch=false
Restart=always
RestartSec=5s
LimitNOFILE=8192
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DIR

[Install]
WantedBy=multi-user.target
UNIT
# Chaque dimanche : la dernière sauvegarde est restaurée à part et contrôlée (résultat dans l'administration, Plus → Santé et journal).
cat > /etc/systemd/system/sokoyetu-sauvegarde.service <<UNIT
[Unit]
Description=Sokoyetu : vérification de la dernière sauvegarde (restauration d'essai)

[Service]
Type=oneshot
ExecStart=$DIR/sauvegarde.sh verifier
Nice=10
IOSchedulingClass=idle
UNIT
cat > /etc/systemd/system/sokoyetu-sauvegarde.timer <<UNIT
[Unit]
Description=Sokoyetu : vérification hebdomadaire des sauvegardes

[Timer]
OnCalendar=Sun *-*-* 04:40:00
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable sokoyetu >/dev/null 2>&1
systemctl enable --now sokoyetu-sauvegarde.timer >/dev/null 2>&1 || true
