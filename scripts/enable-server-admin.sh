#!/usr/bin/env bash
# Install a limited host agent; the app still has no Docker socket or owner credentials.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_root
require_env
[[ "$ALLUMI_DIR" =~ ^/[A-Za-z0-9/_-]+$ ]] || die "chemin du dépôt non pris en charge"
command -v python3 >/dev/null || die "Installe python3 d’abord."
command -v systemctl >/dev/null || die "systemd est requis pour cet agent optionnel."
CID="$(compose ps -q app)"
[ -n "$CID" ] || die "démarre l’application avant d’activer l’agent"
STORAGE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Source}}{{end}}{{end}}' "$CID")"
[[ "$STORAGE" =~ ^/[A-Za-z0-9/_-]+$ ]] && [ -d "$STORAGE" ] || die "volume de stockage local introuvable"
CONTROL="$STORAGE/server-control"
[ ! -L "$CONTROL" ] || die "le répertoire de contrôle ne doit pas être un lien symbolique"
install -d -o 1000 -g 1000 -m 0700 "$CONTROL"
install -m 0755 "$ALLUMI_DIR/scripts/server-admin-agent.py" /usr/local/sbin/allumi-server-admin-agent
cat > /etc/systemd/system/allumi-server-admin.service <<UNIT
[Unit]
Description=Allumi limited server administration
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
Environment=ALLUMI_DIR=$ALLUMI_DIR
Environment=ALLUMI_SERVER_CONTROL_DIR=$CONTROL
WorkingDirectory=$ALLUMI_DIR
ExecStart=/usr/bin/python3 /usr/local/sbin/allumi-server-admin-agent
TimeoutStartSec=35min
UMask=0077
UNIT
cat > /etc/systemd/system/allumi-server-admin.timer <<'UNIT'
[Unit]
Description=Process Allumi server administration requests
[Timer]
OnBootSec=60
OnUnitInactiveSec=30
[Install]
WantedBy=timers.target
UNIT
env_set ALLUMI_SERVER_ADMIN_ENABLED 1
systemctl daemon-reload
systemctl enable --now allumi-server-admin.timer
compose up -d app
info "Administration serveur activée : /administration/serveur."
