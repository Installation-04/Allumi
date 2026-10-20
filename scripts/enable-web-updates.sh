#!/usr/bin/env bash
# Install the opt-in, root-owned host updater (run from the server checkout).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_root
require_env
[[ "$ALLUMI_DIR" =~ ^/[A-Za-z0-9/_-]+$ ]] || die "chemin du dépôt non pris en charge"
command -v python3 >/dev/null || die "Installe python3 d'abord."
[ ! -e "$ALLUMI_DIR/compose.override.yaml" ] || die "compose.override.yaml existe : intègre manuellement le montage documenté."
install -d -m 0755 /var/lib/allumi-update
chown 1000:1000 /var/lib/allumi-update
install -m 0755 "$ALLUMI_DIR/scripts/update-agent.py" /usr/local/sbin/allumi-update-agent
cat > "$ALLUMI_DIR/compose.override.yaml" <<'YAML'
services:
  app:
    environment:
      ALLUMI_UPDATE_DIR: /app/storage/update-control
    volumes:
      - /var/lib/allumi-update:/app/storage/update-control
YAML
cat > /etc/systemd/system/allumi-update.service <<UNIT
[Unit]
Description=Allumi requested server update
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
Environment=ALLUMI_DIR=$ALLUMI_DIR
WorkingDirectory=$ALLUMI_DIR
ExecStart=/usr/bin/python3 /usr/local/sbin/allumi-update-agent
TimeoutStartSec=40min
UMask=0022
UNIT
cat > /etc/systemd/system/allumi-update.timer <<'UNIT'
[Unit]
Description=Check for an administrator-requested Allumi update
[Timer]
OnBootSec=60
OnUnitInactiveSec=30
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now allumi-update.timer
cd "$ALLUMI_DIR"
compose up -d app
info "Agent activé. Journal : journalctl -u allumi-update.service"
