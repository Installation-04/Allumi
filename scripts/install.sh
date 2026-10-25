#!/usr/bin/env bash
# Installation d'Allumi sur Ubuntu 22.04 / 24.04.
# Usage: sudo ./scripts/install.sh --interactive [--no-firewall] [--no-cron]
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Configuration and validation are shared with the Docker installer.
FIREWALL=1; CRON=1; INSTALL_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-firewall) FIREWALL=0; shift ;;
    --no-cron) CRON=0; shift ;;
    -h|--help) exec "$ALLUMI_DIR/scripts/install-docker.sh" --help ;;
    *) INSTALL_ARGS+=("$1"); shift ;;
  esac
done
require_root
[ "${#INSTALL_ARGS[@]}" -gt 0 ] || INSTALL_ARGS=(--interactive)

. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) warn "système non testé (${PRETTY_NAME:-inconnu}). On continue." ;; esac

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  info "Installation de Docker (dépôt officiel)…"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg openssl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  info "Docker déjà installé."
fi
docker compose version >/dev/null 2>&1 || die "le plugin docker compose est introuvable."
apt-get install -y openssl age >/dev/null 2>&1 || apt-get install -y openssl >/dev/null

# The child reports its selected action over a private descriptor, including interactive prepare-only.
INSTALL_RESULT="$(mktemp)"
trap 'rm -f "$INSTALL_RESULT"' EXIT
ALLUMI_REPORT_RESULT=1 "$ALLUMI_DIR/scripts/install-docker.sh" "${INSTALL_ARGS[@]}" 3>"$INSTALL_RESULT"
[ "$(cat "$INSTALL_RESULT")" = started ] || exit 0
if [ "$FIREWALL" -eq 1 ]; then
  apt-get install -y ufw >/dev/null
  ufw allow OpenSSH >/dev/null
  ufw allow "$(env_get ALLUMI_HTTP_PORT)/tcp" >/dev/null
  ufw --force enable >/dev/null
fi

# 6. Sauvegardes quotidiennes
if [ "$CRON" -eq 1 ]; then
  info "Planification des sauvegardes (tous les jours à 02:30)…"
  cat > /etc/cron.d/allumi-backup <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root ${ALLUMI_DIR}/scripts/backup.sh >> /var/log/allumi-backup.log 2>&1
EOF
  chmod 644 /etc/cron.d/allumi-backup
fi

# Le jeton n'est affiché que si la page /setup est encore ouverte (voir print_setup_token dans lib.sh).
SETUP_LINE="$(print_setup_token)"

cat <<EOF

$(printf '%s' "$c_grn")Allumi est installé.$(printf '%s' "$c_off")
  Adresse  : $(env_get APP_URL)
  Étape    : ouvre l'adresse et crée l'entreprise + l'administrateur (page /setup)
${SETUP_LINE}
  Secrets  : ${ENV_FILE}  (chmod 600 — sauvegarde-le dans un gestionnaire de mots de passe)
  Sauvegarde : configure BACKUP_AGE_RECIPIENT et BACKUP_RCLONE_REMOTE dans .env, puis lance
               ./scripts/backup.sh pour tester.  Voir docs/Sauvegardes.md
EOF
