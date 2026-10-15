#!/usr/bin/env bash
# Restaure une sauvegarde créée par backup.sh. ATTENTION : remplace la base actuelle.
# Usage : ./scripts/restore.sh <fichier.tar|fichier.tar.age> [chemin_cle_privee_age]
set -euo pipefail
umask 077

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env

FILE="${1:-}"; KEY="${2:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || die "usage : $0 <sauvegarde> [cle_privee_age]"

printf 'Cette opération REMPLACE la base de données actuelle. Taper « oui » pour continuer : '
read -r answer
[ "$answer" = "oui" ] || die "annulé."

PGUSER_="$(env_get POSTGRES_USER)"; PGUSER_="${PGUSER_:-allumi}"
PGDB_="$(env_get POSTGRES_DB)"; PGDB_="${PGDB_:-allumi}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

case "$FILE" in
  *.age)
    [ -n "$KEY" ] && [ -f "$KEY" ] || die "fichier chiffré : fournis la clé privée age en 2e argument."
    command -v age >/dev/null 2>&1 || die "age n'est pas installé."
    age -d -i "$KEY" -o "$WORK/backup.tar" "$FILE" ;;
  *) cp "$FILE" "$WORK/backup.tar" ;;
esac
tar -xf "$WORK/backup.tar" -C "$WORK"
[ -f "$WORK/db.dump" ] || die "db.dump absent de l'archive."

info "Arrêt de l'application…"
compose stop app caddy || true
compose up -d db

info "Restauration de la base…"
compose exec -T db psql -U "$PGUSER_" -d postgres -c "DROP DATABASE IF EXISTS \"$PGDB_\" WITH (FORCE);"
compose exec -T db psql -U "$PGUSER_" -d postgres -c "CREATE DATABASE \"$PGDB_\" OWNER \"$PGUSER_\";"
compose exec -T db pg_restore -U "$PGUSER_" -d "$PGDB_" --no-owner < "$WORK/db.dump"

if [ -f "$WORK/storage.tar.gz" ]; then
  info "Restauration des pièces jointes…"
  docker run --rm -v allumi_app_storage:/app/storage -v "$WORK":/in alpine:3 \
    sh -c 'rm -rf /app/storage/* && tar -xzf /in/storage.tar.gz -C /app'
fi

info "Redémarrage…"
compose up -d
info "Restauration terminée. Vérifie https://$(env_get ALLUMI_DOMAIN)"
