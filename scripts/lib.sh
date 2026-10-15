#!/usr/bin/env bash
# Fonctions communes aux scripts Allumi. À sourcer, pas à exécuter.

ALLUMI_DIR="${ALLUMI_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$ALLUMI_DIR/.env}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_off=$'\033[0m'
info() { printf '%s[allumi]%s %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s[allumi]%s %s\n' "$c_ylw" "$c_off" "$*" >&2; }
die()  { printf '%s[allumi] erreur :%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

# Lit une variable de .env SANS exécuter le fichier (les valeurs peuvent contenir des espaces).
env_get() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2-
}

# Remplace ou ajoute une variable dans .env.
env_set() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"; printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

compose() { docker compose --project-directory "$ALLUMI_DIR" "$@"; }

require_root() { [ "$(id -u)" -eq 0 ] || die "lance ce script avec sudo."; }
require_env()  { [ -f "$ENV_FILE" ] || die "fichier .env introuvable ($ENV_FILE). Lance d'abord install.sh."; }
