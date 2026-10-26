#!/usr/bin/env bash
# Fixed host-agent operation: only retention days may be changed.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env
[[ "${1:-}" =~ ^[1-9][0-9]{0,3}$ ]] && [ "$1" -le 3650 ] || die "rétention invalide (1 à 3650 jours)"
[ ! -L "$ENV_FILE" ] || die ".env ne doit pas être un lien symbolique"
env_set BACKUP_RETENTION_DAYS "$1"
