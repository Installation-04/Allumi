#!/usr/bin/env bash
# Fonctions communes aux scripts Allumi. À sourcer, pas à exécuter.

ALLUMI_DIR="${ALLUMI_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ALLUMI_DIR/.env}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_off=$'\033[0m'
info() { printf '%s[allumi]%s %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s[allumi]%s %s\n' "$c_ylw" "$c_off" "$*" >&2; }
die()  { printf '%s[allumi] erreur :%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

# Lit une variable de .env SANS exécuter le fichier (les valeurs peuvent contenir des espaces).
# Une variable absente donne une chaîne vide (jamais un échec : les scripts tournent en « set -e »)
# et, comme Compose, on retire une paire de guillemets autour de la valeur.
env_get() {
  local key="$1" value
  [ -f "$ENV_FILE" ] || return 0
  value="$({ grep -E "^${key}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2-)"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s\n' "$value"
}

# Remplace ou ajoute une variable dans .env.
env_set() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Values go through the environment: awk -v would interpret backslash escapes in them.
    K="$key" V="$val" awk 'BEGIN{FS="="} $1==ENVIRON["K"] {print ENVIRON["K"] "=" ENVIRON["V"]; next} {print}' "$ENV_FILE" > "$tmp"
  else
    # A last line without a newline must not swallow the new key.
    { cat "$ENV_FILE"; [ -z "$(tail -c1 "$ENV_FILE")" ] || echo; printf '%s=%s\n' "$key" "$val"; } > "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

# Complète un .env créé par une version plus ancienne : rôle restreint de l'application et jeton de /setup.
env_backfill() {
  local pass db url token
  pass="$(env_get APP_DB_PASSWORD)"
  url="$(env_get APP_DATABASE_URL)"
  if [ -z "$pass" ] || [ "$pass" = "CHANGE_ME" ]; then
    pass="$(openssl rand -hex 24)"
    env_set APP_DB_PASSWORD "$pass"
    url=""
  fi
  db="$(env_get POSTGRES_DB)"; db="${db:-allumi}"
  if [ -z "$url" ] || [ "${url#*CHANGE_ME}" != "$url" ]; then
    env_set APP_DATABASE_URL "postgresql://allumi_app:${pass}@db:5432/${db}"
  fi
  token="$(env_get SETUP_TOKEN)"
  if [ -z "$token" ]; then
    env_set SETUP_TOKEN "$(openssl rand -hex 16)"
  fi
}

compose() { docker compose --project-directory "$ALLUMI_DIR" "$@"; }

require_root() { [ "$(id -u)" -eq 0 ] || die "lance ce script avec sudo."; }
require_env()  { [ -f "$ENV_FILE" ] || die "fichier .env introuvable ($ENV_FILE). Lance d'abord install.sh."; }
