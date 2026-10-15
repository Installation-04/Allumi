#!/usr/bin/env bash
# Sauvegarde PostgreSQL + pièces jointes. Chiffrée avec age si BACKUP_AGE_RECIPIENT est défini.
# Usage : ./scripts/backup.sh
set -euo pipefail
umask 077

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env

BACKUP_DIR="$(env_get BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/var/backups/allumi}"
RETENTION="$(env_get BACKUP_RETENTION_DAYS)"; RETENTION="${RETENTION:-30}"
AGE_RCPT="$(env_get BACKUP_AGE_RECIPIENT)"
RCLONE_REMOTE="$(env_get BACKUP_RCLONE_REMOTE)"
PGUSER_="$(env_get POSTGRES_USER)"; PGUSER_="${PGUSER_:-allumi}"
PGDB_="$(env_get POSTGRES_DB)"; PGDB_="${PGDB_:-allumi}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

info "Dump PostgreSQL…"
compose exec -T db pg_dump -U "$PGUSER_" -d "$PGDB_" --format=custom --no-owner > "$WORK/db.dump"

info "Archive des pièces jointes…"
APP_CID="$(compose ps -q app || true)"
if [ -n "$APP_CID" ]; then
  docker run --rm --volumes-from "$APP_CID" -v "$WORK":/out alpine:3 \
    tar -czf /out/storage.tar.gz -C /app storage
else
  warn "service app arrêté : pièces jointes ignorées."
fi

ARCHIVE="$BACKUP_DIR/allumi-$TS.tar"
tar -cf "$ARCHIVE" -C "$WORK" .

if [ -n "$AGE_RCPT" ]; then
  command -v age >/dev/null 2>&1 || die "age n'est pas installé (apt install age)."
  age -r "$AGE_RCPT" -o "$ARCHIVE.age" "$ARCHIVE"
  rm -f "$ARCHIVE"
  FINAL="$ARCHIVE.age"
else
  warn "BACKUP_AGE_RECIPIENT vide : sauvegarde NON chiffrée. Déconseillé si elle quitte le serveur."
  FINAL="$ARCHIVE"
fi
info "Sauvegarde créée : $FINAL"

if [ -n "$RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || die "rclone n'est pas installé (apt install rclone)."
  info "Envoi hors site vers $RCLONE_REMOTE…"
  rclone copy "$FINAL" "$RCLONE_REMOTE"
else
  warn "Aucune destination hors site (BACKUP_RCLONE_REMOTE). Une sauvegarde sur le même serveur ne protège pas d'une perte du serveur."
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'allumi-*' -mtime +"$RETENTION" -delete
info "Terminé."
