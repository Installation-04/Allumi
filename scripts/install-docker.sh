#!/usr/bin/env bash
# Installe Allumi avec Docker Engine et Compose déjà disponibles, sans modifier le système hôte.
# Usage: ./scripts/install-docker.sh [--app-url http://192.168.1.20:28080] [--http-port 28080] [--prepare-only]
set -euo pipefail
umask 077

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# shellcheck source=installer-options.sh
. "$(dirname "${BASH_SOURCE[0]}")/installer-options.sh"
[ "$ENV_FILE" = "$ALLUMI_DIR/.env" ] || die "cet installateur utilise uniquement .env à la racine du projet."
[ ! -L "$ENV_FILE" ] || die ".env ne doit pas être un lien symbolique."
INSTALL_URL="$(env_get APP_URL)"
INSTALL_HTTP_PORT="$(env_get ALLUMI_HTTP_PORT)"; INSTALL_HTTP_PORT="${INSTALL_HTTP_PORT:-28080}"
INSTALL_URL="${INSTALL_URL:-http://localhost:$INSTALL_HTTP_PORT}"
INSTALL_BIND="$(env_get ALLUMI_BIND_ADDRESS)"; INSTALL_BIND="${INSTALL_BIND:-0.0.0.0}"
INSTALL_LOCALE="$(env_get DEFAULT_LOCALE)"; INSTALL_LOCALE="${INSTALL_LOCALE:-fr-CA}"
PREPARE_ONLY=0; WAIT_SECONDS=300; INTERACTIVE=0
if [ "$#" -eq 0 ]; then
  [ -t 0 ] || die "aucun terminal interactif : utilise --interactive ou fournis une option explicite comme --app-url."
  INTERACTIVE=1
fi
while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-url|--timeout|--http-port|--bind|--locale)
      [ "$#" -ge 2 ] && [[ "$2" != --* ]] || die "valeur manquante pour $1"
      case "$1" in
        --app-url) INSTALL_URL="$2" ;;
        --timeout) WAIT_SECONDS="$2" ;;
        --http-port) INSTALL_HTTP_PORT="$2" ;;
        --bind) INSTALL_BIND="$2" ;;
        --locale) INSTALL_LOCALE="$2" ;;
      esac
      shift 2 ;;
    --interactive) INTERACTIVE=1; shift ;;
    --prepare-only) PREPARE_ONLY=1; shift ;;
    -h|--help)
      cat <<'HELP'
Allumi — installation Docker (Docker Engine et Compose déjà installés).
Sans argument dans un terminal : assistant interactif.
--interactive             Assistant avec récapitulatif et confirmation
--app-url URL             Adresse utilisée par le navigateur (HTTP direct ou proxy externe)
--http-port PORT          Port HTTP sur l’hôte (nouvelle installation : 28080)
--bind IPV4               Adresse d’écoute (défaut : 0.0.0.0)
--locale fr-CA|en         Langue initiale (défaut : fr-CA)
--prepare-only            Préparer .env sans lancer Docker
--timeout SECONDES        Attente de santé après Compose (défaut : 300)
Les réglages existants sont conservés si aucune option ne les remplace.
HELP
      exit 0 ;;
    *) die "option inconnue : $1" ;;
  esac
done
[ "$INTERACTIVE" -eq 0 ] || installer_wizard
valid_url "$INSTALL_URL" || die "--app-url doit être une origine http:// ou https://, sans chemin ni identifiants."
valid_timeout "$WAIT_SECONDS" || die "--timeout doit être entre 1 et 3600 secondes."
valid_port "$INSTALL_HTTP_PORT" || die "le port doit être entre 1 et 65535."
valid_bind "$INSTALL_BIND" || die "--bind doit être une adresse IPv4 valide."
valid_locale "$INSTALL_LOCALE" || die "--locale doit être fr-CA ou en."
# Deployment credentials must come from the selected file, never from a development shell.
unset DATABASE_URL APP_DATABASE_URL POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB APP_DB_PASSWORD AUTH_SECRET ENCRYPTION_KEY SETUP_TOKEN APP_URL ALLUMI_DOMAIN ACME_EMAIL ALLUMI_HTTP_PORT ALLUMI_HTTPS_PORT ALLUMI_BIND_ADDRESS DEFAULT_LOCALE
command -v openssl >/dev/null 2>&1 || die "OpenSSL est requis pour générer les secrets."
[ -f "$ALLUMI_DIR/docker-compose.yml" ] && [ -f "$ALLUMI_DIR/.env.example" ] || die "lance le script depuis une copie complète d’Allumi."
if [ "$PREPARE_ONLY" -eq 0 ]; then
  command -v docker >/dev/null 2>&1 || die "Docker est absent. Installe Docker Engine + Compose, ou utilise scripts/install.sh sur Ubuntu."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 est requis."
  docker info >/dev/null 2>&1 || die "Docker ne répond pas ou ton compte n’a pas accès au moteur."
fi

# Work on a private copy and publish it atomically; never source .env as shell code.
TARGET_ENV="$ENV_FILE"
[ "$TARGET_ENV" = "$ALLUMI_DIR/.env" ] || die "cet installateur utilise uniquement .env à la racine du projet (exclu des images Docker)."
if [ ! -e "$TARGET_ENV" ] && [ "$PREPARE_ONLY" -eq 0 ]; then
  PROJECT_NAME="${COMPOSE_PROJECT_NAME:-allumi}"
  EXISTING_CONTAINERS="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_NAME")"
  EXISTING_VOLUMES="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT_NAME")"
  [ -z "$EXISTING_CONTAINERS$EXISTING_VOLUMES" ] || die "des conteneurs ou volumes Allumi existent déjà sans .env; restaure leur configuration avant de continuer."
fi
[ ! -L "$TARGET_ENV" ] || die ".env ne doit pas être un lien symbolique."
LOCK_DIR="${TARGET_ENV}.install-lock"
mkdir "$LOCK_DIR" 2>/dev/null || die "une installation est déjà en cours (verrou $LOCK_DIR)."
TEMP_ENV=""
cleanup() { [ -z "$TEMP_ENV" ] || rm -f "$TEMP_ENV"; rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
TEMP_ENV="$(mktemp "${TARGET_ENV}.install.XXXXXX")"
if [ -e "$TARGET_ENV" ]; then
  [ -f "$TARGET_ENV" ] || die ".env doit être un fichier ordinaire."
  cp "$TARGET_ENV" "$TEMP_ENV"
else
  cp "$ALLUMI_DIR/.env.example" "$TEMP_ENV"
fi
ENV_FILE="$TEMP_ENV"
if [ ! -e "$TARGET_ENV" ]; then
  PGPASS="$(openssl rand -hex 24)"
  env_set POSTGRES_PASSWORD "$PGPASS"
  env_set DATABASE_URL "postgresql://allumi:${PGPASS}@db:5432/allumi?schema=public"
  env_set AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  env_set ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
  env_backfill
else
  for key in POSTGRES_PASSWORD DATABASE_URL APP_DB_PASSWORD APP_DATABASE_URL AUTH_SECRET ENCRYPTION_KEY; do
    value="$(env_get "$key")"
    [ -n "$value" ] && [[ "$value" != *CHANGE_ME* ]] || die "$key manque ou contient une valeur d’exemple; corrige .env sans remplacer les secrets d’une base existante."
  done
  # The production stack owns its database. Never migrate an unrelated development/remote database.
  for key in DATABASE_URL APP_DATABASE_URL; do
    value="$(env_get "$key")"
    [[ "$value" == postgresql://*@db:5432/* ]] || die "$key ne cible pas le service Docker db:5432; utilise un dossier séparé pour cette installation."
  done
  [ -n "$(env_get SETUP_TOKEN)" ] || env_set SETUP_TOKEN "$(openssl rand -hex 16)"
fi
env_backfill
env_set APP_URL "$INSTALL_URL"
env_set ALLUMI_HTTP_PORT "$INSTALL_HTTP_PORT"
env_set ALLUMI_BIND_ADDRESS "$INSTALL_BIND"
env_set DEFAULT_LOCALE "$INSTALL_LOCALE"
chmod 600 "$TEMP_ENV"
if [ "$PREPARE_ONLY" -eq 0 ]; then
  docker compose --project-directory "$ALLUMI_DIR" -f "$ALLUMI_DIR/docker-compose.yml" --env-file "$TEMP_ENV" config --quiet
fi
mv "$TEMP_ENV" "$TARGET_ENV"
TEMP_ENV=""
ENV_FILE="$TARGET_ENV"
info "Configuration prête dans $ENV_FILE (permissions 600). Secrets existants conservés."
if [ "$PREPARE_ONLY" -eq 1 ]; then
  [ "${ALLUMI_REPORT_RESULT:-0}" != 1 ] || printf 'prepared\n' >&3
  info "Aucun conteneur lancé. Relance sans --prepare-only pour installer."
  exit 0
fi
# Explicit --env-file also supports the ENV_FILE path override used by administrative scripts.
docker compose --project-directory "$ALLUMI_DIR" -f "$ALLUMI_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --build --remove-orphans
info "Attente de l’application (maximum ${WAIT_SECONDS} s après le démarrage Compose)…"
DEADLINE=$((SECONDS + WAIT_SECONDS))
while :; do
  APP_ID="$(docker compose --project-directory "$ALLUMI_DIR" -f "$ALLUMI_DIR/docker-compose.yml" --env-file "$ENV_FILE" ps -q app)"
  HEALTH="$(docker inspect -f '{{.State.Health.Status}}' "$APP_ID" 2>/dev/null || true)"
  if [ "$HEALTH" = healthy ]; then break; fi
  [ "$SECONDS" -lt "$DEADLINE" ] || die "application non saine après ${WAIT_SECONDS} s. Consulte docker compose logs migrate app. Les données et .env sont conservés."
  sleep 2
done
cat <<EOF_DONE

Allumi est démarré et l’application est healthy.
  Adresse : ${INSTALL_URL}
  Réseau : HTTP direct sur le port $INSTALL_HTTP_PORT. TLS éventuel géré par votre proxy externe.
  Début  : ouvre /setup; le jeton de première configuration est SETUP_TOKEN dans .env.
  Données : volumes Docker conservés. Ne lance pas docker compose down -v.
  Sauvegardes : à configurer et tester (docs/Sauvegardes.md); aucune tâche planifiée ajoutée.
  Mises à jour : scripts/update.sh pour une copie Git, voir docs/Mise-a-jour.md.
EOF_DONE

[ "${ALLUMI_REPORT_RESULT:-0}" != 1 ] || printf 'started\n' >&3
