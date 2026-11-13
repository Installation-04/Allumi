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
# Reject hostile outer members before tar can follow a link or overwrite anything outside
# this private workspace. Backups contain only the three named payloads and an optional root directory.
command -v python3 >/dev/null 2>&1 || die "python3 est requis pour vérifier la sauvegarde avant restauration."
python3 - "$WORK/backup.tar" <<'PYBACKUP' || die "archive de sauvegarde invalide."
import pathlib
import sys
import tarfile

try:
    with tarfile.open(sys.argv[1], "r:*") as archive:
        allowed = {"db.dump", "storage.tar.gz", "local-tls.tar.gz"}
        files = set()
        for member in archive:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("path")
            if str(path) == "." and member.isdir():
                continue
            if str(path) not in allowed or not member.isfile() or str(path) in files:
                raise ValueError("member")
            files.add(str(path))
        if "db.dump" not in files:
            raise ValueError("database")
except (OSError, ValueError, tarfile.TarError):
    sys.exit(1)
PYBACKUP
# Ignore stored ownership and permissive modes: the workspace and payloads remain private.
tar --no-same-owner --no-same-permissions -xf "$WORK/backup.tar" -C "$WORK"
[ -f "$WORK/db.dump" ] || die "db.dump absent de l'archive."

# Validate attachment members before stopping services or replacing the database.
# Only plain files/directories under storage are restored; host-agent requests are never replayed.
if [ -f "$WORK/storage.tar.gz" ]; then
  python3 - "$WORK/storage.tar.gz" <<'PYSTORAGE' || die "archive des pièces jointes invalide."
import pathlib
import sys
import tarfile

try:
    with tarfile.open(sys.argv[1], "r:gz") as archive:
        seen = {}
        parents = set()
        for member in archive:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "storage":
                raise ValueError("path")
            if len(path.parts) > 1 and path.parts[1] in ("update-control", "server-control"):
                raise ValueError("control")
            if not (member.isfile() or member.isdir()) or member.issparse() or path in seen:
                raise ValueError("member")
            if member.isfile() and path in parents:
                raise ValueError("parent")
            for parent in path.parents:
                if seen.get(parent) is False:
                    raise ValueError("parent")
                parents.add(parent)
            seen[path] = member.isdir()
        if seen.get(pathlib.PurePosixPath("storage")) is not True:
            raise ValueError("root")
except (OSError, ValueError, EOFError, tarfile.TarError):
    sys.exit(1)
PYSTORAGE
fi

# Validate the complete authority archive before stopping services or replacing the database.
# Restoring an HTTP-only backup into local HTTPS must be deliberate: otherwise Caddy would
# silently generate a new authority and every trusted client would lose its trust anchor.
LOCAL_HTTPS=0
if [ "$(env_get ALLUMI_NETWORK_MODE)" = local-https ]; then
  LOCAL_HTTPS=1
  [ -f "$WORK/local-tls.tar.gz" ] || die "autorité HTTPS locale absente de la sauvegarde : restaure en mode HTTP ou utilise une sauvegarde HTTPS complète."
  command -v python3 >/dev/null 2>&1 || die "python3 est requis pour vérifier l’archive de l’autorité locale."
  python3 - "$WORK/local-tls.tar.gz" <<'PYTLS' || die "archive de l’autorité HTTPS locale invalide."
import pathlib
import sys
import tarfile

try:
    with tarfile.open(sys.argv[1], "r:gz") as archive:
        files = set()
        required = {"data/caddy/pki/authorities/local/root.crt", "data/caddy/pki/authorities/local/root.key"}
        for member in archive:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in ("data", "config"):
                raise ValueError("path")
            if not member.isfile() and not member.isdir():
                raise ValueError("type")
            if member.isfile():
                if str(path) in required and member.size == 0:
                    raise ValueError("empty authority")
                if str(path).endswith("/root.key") and member.mode & 0o077:
                    raise ValueError("private key permissions")
                files.add(str(path))
        if not required.issubset(files):
            raise ValueError("authority")
except (OSError, ValueError, tarfile.TarError):
    sys.exit(1)
PYTLS
  # Validate the merged live Compose configuration before any stop or database mutation.
  validate_deployment_start
  info "Arrêt du proxy HTTPS local…"
  compose stop caddy
else
  validate_deployment_start
fi

info "Arrêt de l'application…"
compose stop app || true
compose up -d db

info "Restauration de la base…"
compose exec -T db psql -U "$PGUSER_" -d postgres -c "DROP DATABASE IF EXISTS \"$PGDB_\" WITH (FORCE);"
compose exec -T db psql -U "$PGUSER_" -d postgres -c "CREATE DATABASE \"$PGDB_\" OWNER \"$PGUSER_\";"
# Les rôles sont globaux au serveur PostgreSQL : ils ne sont pas dans la sauvegarde, mais les droits (GRANT) et les
# propriétaires le sont. On garde les propriétaires (pas de --no-owner) : la fonction audit_redact doit rester à allumi_redactor.
# Sur un serveur neuf, il faut les créer avant la restauration; le service migrate leur donne ensuite leur mot de passe.
compose exec -T db psql -v ON_ERROR_STOP=1 -U "$PGUSER_" -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'allumi_app') THEN
    CREATE ROLE allumi_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'allumi_redactor') THEN
    CREATE ROLE allumi_redactor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
SQL
compose exec -T db pg_restore -U "$PGUSER_" -d "$PGDB_" --exit-on-error --single-transaction < "$WORK/db.dump"
# PostgreSQL ne sauvegarde pas les statistiques : sans elles, les premières vérifications comptables sont lentes.
compose exec -T db psql -U "$PGUSER_" -d "$PGDB_" -c "ANALYZE;"

if [ -f "$WORK/storage.tar.gz" ]; then
  info "Restauration des pièces jointes…"
  docker run --rm --network none --read-only --security-opt no-new-privileges \
    -v allumi_app_storage:/app/storage -v "$WORK":/in:ro alpine:3 \
    sh -c 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf /in/storage.tar.gz -C /app'
fi

if [ "$LOCAL_HTTPS" = 1 ]; then
  info "Restauration privée de l’autorité HTTPS locale…"
  # Create mounts without starting Caddy: it must not mint a replacement authority.
  compose create --no-deps caddy
  CADDY_CID="$(compose ps -aq caddy || true)"
  [ -n "$CADDY_CID" ] || die "conteneur caddy introuvable : restauration de l’autorité locale impossible."
  docker run --rm --user 0:0 --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --volumes-from "$CADDY_CID" -v "$WORK":/in:ro --entrypoint sh caddy:2.11.8-alpine -eu -c \
    'find /data /config -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzpf /in/local-tls.tar.gz -C /'
fi

info "Redémarrage (le service migrate reconfigure le rôle de l'application)…"
compose up -d
info "Restauration terminée. Vérifie $(env_get APP_URL)"
