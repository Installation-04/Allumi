#!/usr/bin/env bash
# Démarre la pile de production avec les images qui correspondent au code extrait : celles publiées pour une version
# étiquetée, sinon des images construites sur place. Sert après un retour arrière (git checkout) ou un « down ».
# Usage : ./scripts/up.sh [--build]
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env

FORCE_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=1 ;;
    *) die "argument inconnu : $arg (usage : $0 [--build])" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "Docker est absent."
select_images "$FORCE_BUILD"
compose_up
