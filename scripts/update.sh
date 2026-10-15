#!/usr/bin/env bash
# Met à jour Allumi : sauvegarde, récupère la nouvelle version, reconstruit, migre, vérifie.
# Usage : ./scripts/update.sh [--no-backup]
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env
cd "$ALLUMI_DIR"

BACKUP=1
[ "${1:-}" = "--no-backup" ] && BACKUP=0

if [ "$BACKUP" -eq 1 ]; then
  info "Sauvegarde préalable…"
  "$ALLUMI_DIR/scripts/backup.sh"
fi

info "Récupération de la nouvelle version…"
git fetch --tags origin
git pull --ff-only

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
