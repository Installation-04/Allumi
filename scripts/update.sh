#!/usr/bin/env bash
# Met à jour Allumi : sauvegarde, récupère la nouvelle version, reconstruit, migre, vérifie.
# Usage : ./scripts/update.sh [--no-backup] [vX.Y.Z]
#   sans version : suit la branche courante (git pull --ff-only)
#   avec une version : se place sur cette étiquette (production : voir docs/Mise-a-jour.md)
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env
cd "$ALLUMI_DIR"

BACKUP=1
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --no-backup) BACKUP=0 ;;
    v[0-9]*) TARGET="$arg" ;;
    *) die "argument inconnu : $arg (usage : $0 [--no-backup] [vX.Y.Z])" ;;
  esac
done

if [ "$BACKUP" -eq 1 ]; then
  info "Sauvegarde préalable…"
  "$ALLUMI_DIR/scripts/backup.sh"
fi

info "Récupération de la nouvelle version…"
git fetch --tags origin
if [ -n "$TARGET" ]; then
  git checkout "$TARGET"
elif git symbolic-ref -q HEAD >/dev/null; then
  git pull --ff-only
else
  warn "HEAD détachée (version épinglée) : rien à tirer. Pour changer de version : $0 vX.Y.Z"
fi
# Un .env créé par une version plus ancienne reçoit les variables ajoutées depuis.
env_backfill

info "Reconstruction et redémarrage (les migrations passent par le service migrate)…"
compose up -d --build --remove-orphans

ok=0
for _ in $(seq 1 60); do
  st="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || true)"
  [ "$st" = "healthy" ] && { ok=1; break; }
  sleep 5
done
if [ "$ok" -eq 1 ]; then
  info "Mise à jour réussie."
  docker image prune -f >/dev/null
else
  die "l'app n'est pas « healthy ». Logs : docker compose logs app. Retour arrière : voir docs/Mise-a-jour.md"
fi
