#!/usr/bin/env bash
# Installation d'Allumi sur Ubuntu 22.04 / 24.04.
# Usage : sudo ./scripts/install.sh --domain compta.exemple.ca --email admin@exemple.ca [--no-firewall] [--no-cron]
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DOMAIN=""; EMAIL=""; FIREWALL=1; CRON=1
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)      DOMAIN="${2:-}"; shift 2 ;;
    --email)       EMAIL="${2:-}"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    --no-cron)     CRON=0; shift ;;
    -h|--help)     sed -n '2,3p' "$0"; exit 0 ;;
    *) die "option inconnue : $1" ;;
  esac
done

require_root
[ -n "$DOMAIN" ] || die "--domain est requis."
[ -n "$EMAIL" ]  || die "--email est requis."
printf '%s' "$DOMAIN" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$' || die "domaine invalide : $DOMAIN"
printf '%s' "$EMAIL"  | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "courriel invalide : $EMAIL"

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

# 2. Pare-feu
if [ "$FIREWALL" -eq 1 ]; then
  info "Configuration du pare-feu (SSH, 80, 443)…"
  apt-get install -y ufw >/dev/null
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
fi

# 3. Fichier .env
cd "$ALLUMI_DIR"
if [ -f "$ENV_FILE" ]; then
  warn ".env existe déjà : secrets conservés, domaine et courriel mis à jour."
else
  info "Génération de .env avec des secrets aléatoires…"
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  PGPASS="$(openssl rand -hex 24)"
  env_set POSTGRES_PASSWORD "$PGPASS"
  env_set DATABASE_URL "postgresql://allumi:${PGPASS}@db:5432/allumi?schema=public"
  env_set AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  env_set ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
fi
chmod 600 "$ENV_FILE"
env_set ALLUMI_DOMAIN "$DOMAIN"
env_set ACME_EMAIL "$EMAIL"
env_set APP_URL "https://${DOMAIN}"

# 4. Démarrage
info "Construction et démarrage (la première fois, ça peut prendre quelques minutes)…"
mkdir -p public
compose up -d --build

# 5. Attente de l'état « healthy »
info "Attente du démarrage de l'application…"
ok=0
for _ in $(seq 1 60); do
  st="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || true)"
  if [ "$st" = "healthy" ]; then ok=1; break; fi
  sleep 5
done
[ "$ok" -eq 1 ] || { warn "l'app n'est pas « healthy » après 5 min. Regarde : docker compose logs app"; }

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

cat <<EOF

$(printf '%s' "$c_grn")Allumi est installé.$(printf '%s' "$c_off")
  Adresse  : https://${DOMAIN}   (le certificat HTTPS peut prendre une minute)
  Étape    : ouvre l'adresse et crée l'entreprise + l'administrateur (page /setup)
  Secrets  : ${ENV_FILE}  (chmod 600 — sauvegarde-le dans un gestionnaire de mots de passe)
  Sauvegarde : configure BACKUP_AGE_RECIPIENT et BACKUP_RCLONE_REMOTE dans .env, puis lance
               ./scripts/backup.sh pour tester.  Voir docs/Sauvegardes.md
EOF
