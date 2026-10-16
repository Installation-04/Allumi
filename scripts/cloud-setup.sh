#!/usr/bin/env bash
# Prépare un environnement cloud (Claude Code sur le web) : PostgreSQL local + .env de dev + dépendances.
# Pas de Docker requis. Idempotent. Usage : ./scripts/cloud-setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
as_pg() { if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi; }

DB=allumi; DBUSER=allumi; DBPASS=allumi_dev_only; APPPASS=allumi_app_dev_only

# 1. PostgreSQL
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[cloud-setup] installation de PostgreSQL…"
  $SUDO apt-get update -y >/dev/null
  $SUDO apt-get install -y postgresql postgresql-client >/dev/null
fi
VER="$(ls /usr/lib/postgresql | sort -n | tail -n1)"
if ! pg_lsclusters | grep -q "^$VER *main"; then
  $SUDO pg_createcluster "$VER" main
fi
pg_lsclusters | grep -q "^$VER *main *[0-9]* *online" || $SUDO pg_ctlcluster "$VER" main start
for _ in $(seq 1 20); do pg_isready -q && break; sleep 1; done
pg_isready -q || { echo "[cloud-setup] PostgreSQL ne répond pas" >&2; exit 1; }

# 2. Utilisateur et base (dev seulement)
as_pg psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='$DBUSER'" | grep -q 1 \
  || as_pg psql -qc "CREATE ROLE $DBUSER LOGIN SUPERUSER PASSWORD '$DBPASS'"
as_pg psql -qtAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 \
  || as_pg createdb -O "$DBUSER" "$DB"

# 3. .env de dev (jamais commité)
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$DBUSER:$DBPASS@localhost:5432/$DB?schema=public|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$DBPASS|" \
    -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$APPPASS|" \
    -e "s|^APP_DATABASE_URL=.*|APP_DATABASE_URL=postgresql://allumi_app:$APPPASS@localhost:5432/$DB|" \
    -e "s|^APP_URL=.*|APP_URL=http://localhost:3000|" \
    -e "s|^NODE_ENV=.*|NODE_ENV=development|" \
    -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')|" \
    .env
  chmod 600 .env
fi

# 3b. .env de dev créé avant l'introduction du rôle applicatif : on ajoute les variables manquantes.
if ! grep -q '^APP_DATABASE_URL=' .env; then
  printf '\nAPP_DB_PASSWORD=%s\nAPP_DATABASE_URL=postgresql://allumi_app:%s@localhost:5432/%s\n' "$APPPASS" "$APPPASS" "$DB" >> .env
fi

# 4. Dépendances, migrations et rôle applicatif (si l'app existe déjà)
if [ -f package.json ]; then
  npm ci || npm install
  if [ -f prisma/schema.prisma ]; then
    npx prisma generate
    npm run db:migrate
  fi
fi
echo "[cloud-setup] OK — base : postgresql://$DBUSER@localhost:5432/$DB"
