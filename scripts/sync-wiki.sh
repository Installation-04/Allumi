#!/usr/bin/env bash
# Publie le dossier docs/ sur le wiki GitHub du dépôt.
# Prérequis : wiki activé sur GitHub et au moins une page créée (une fois, depuis l'interface).
# Usage : ./scripts/sync-wiki.sh [url_du_wiki.git]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGIN="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
WIKI_URL="${1:-}"
if [ -z "$WIKI_URL" ]; then
  [ -n "$ORIGIN" ] || { echo "Aucun remote origin. Passe l'URL du wiki en argument." >&2; exit 1; }
  WIKI_URL="${ORIGIN%.git}.wiki.git"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet "$WIKI_URL" "$TMP/wiki"
find "$TMP/wiki" -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
cp -R "$ROOT"/docs/. "$TMP/wiki/"
[ -f "$TMP/wiki/Home.md" ] || { echo "docs/Home.md manquant." >&2; exit 1; }

cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then
  echo "Wiki déjà à jour."
else
  git commit --quiet -m "docs: sync wiki from docs/"
  git push --quiet
  echo "Wiki publié."
fi
