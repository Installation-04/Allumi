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
  # Removing the bundled proxy changes the trust boundary. Reset old deployments once.
  if [ "$(env_get ALLUMI_NETWORK_MODE)" != direct ]; then
    env_set TRUSTED_PROXY_HOPS 0
    env_set ALLUMI_NETWORK_MODE direct
  fi
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

# --- Images : téléchargées (version publiée) ou construites sur place ------------------------------------------
# Le workflow Release construit et publie, pour chaque version étiquetée, les images application et migrations
# (AMD64 et ARM64) avant de publier la release. Une copie placée exactement sur une étiquette les télécharge au lieu
# de les compiler. Toute autre copie (branche, commit quelconque, fichiers modifiés), --build, ou une image
# introuvable (hors ligne, architecture non publiée) se construit sur place, comme avant.
IMAGE_REPO="${ALLUMI_IMAGE_REPO:-ghcr.io/installation-04/allumi}"
IMAGE_MODE=build

# Retire une variable de .env (sans effet si elle est absente).
env_unset() {
  local key="$1" tmp
  [ -f "$ENV_FILE" ] || return 0
  tmp="$(mktemp)"
  { grep -v -E "^${key}=" "$ENV_FILE" || true; } > "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

# Étiquette de version si HEAD est exactement dessus, que ce dossier est bien la racine du dépôt (pas un dépôt
# parent) et que les fichiers suivis ne sont pas modifiés : sinon rien. L'image publiée ne contient pas de
# modifications locales.
release_tag() {
  local top
  top="$(git -C "$ALLUMI_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$top" ] && [ "$top" = "$(cd "$ALLUMI_DIR" && pwd -P)" ] || return 0
  [ -z "$(git -C "$ALLUMI_DIR" status --porcelain --untracked-files=no 2>/dev/null)" ] || return 0
  { git -C "$ALLUMI_DIR" describe --tags --exact-match HEAD 2>/dev/null || true; } |
    { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' || true; } | head -n 1
}

# Choisit entre images publiées et construction locale, l'inscrit dans .env (ALLUMI_APP_IMAGE, ALLUMI_MIGRATE_IMAGE :
# le Compose du dépôt les lit, donc « docker compose up -d » reste cohérent) et positionne IMAGE_MODE.
# Argument : 1 pour forcer la construction locale.
select_images() {
  local force_build="${1:-0}" tag version=""
  IMAGE_MODE=build
  [ "$force_build" = 1 ] || [ "${ALLUMI_BUILD:-0}" = 1 ] || tag="$(release_tag)"
  if [ -n "${tag:-}" ]; then
    version="${tag#v}"
    env_set ALLUMI_APP_IMAGE "${IMAGE_REPO}:${version}"
    env_set ALLUMI_MIGRATE_IMAGE "${IMAGE_REPO}-migrate:${version}"
    info "Téléchargement des images publiées de ${tag} (aucune compilation sur cette machine)…"
    if docker compose --project-directory "$ALLUMI_DIR" --env-file "$ENV_FILE" pull --quiet app migrate; then
      IMAGE_MODE=pull
      return 0
    fi
    warn "images publiées de ${tag} indisponibles (hors ligne, version sans images ou architecture non publiée) : construction sur place."
  else
    info "Images construites sur place (copie non étiquetée ou modifiée, ou --build)."
  fi
  env_unset ALLUMI_APP_IMAGE
  env_unset ALLUMI_MIGRATE_IMAGE
}

# Démarre (ou met à jour) la pile selon IMAGE_MODE : jamais de construction quand les images ont été téléchargées.
compose_up() {
  local build_flag=--build
  [ "$IMAGE_MODE" != pull ] || build_flag=--no-build
  docker compose --project-directory "$ALLUMI_DIR" -f "$ALLUMI_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d "$build_flag" --remove-orphans
}

require_root() { [ "$(id -u)" -eq 0 ] || die "lance ce script avec sudo."; }
require_env()  { [ -f "$ENV_FILE" ] || die "fichier .env introuvable ($ENV_FILE). Lance d'abord install.sh."; }
