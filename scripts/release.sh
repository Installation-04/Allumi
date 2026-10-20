#!/usr/bin/env bash
# Prépare une version : met à jour CHANGELOG.md (+ package.json s'il existe), commit et tag annoté.
# Ne pousse rien. Usage : ./scripts/release.sh 0.1.0   (ou 0.2.0-beta.1)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

V="${1:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "usage : $0 X.Y.Z[-prerelease]" >&2; exit 1; }
TAG="v$V"

[ -z "$(git status --porcelain)" ] || { echo "Arbre de travail non propre. Commit ou stash d'abord." >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Lance ceci depuis la branche main." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "Le tag $TAG existe déjà." >&2; exit 1; }
grep -q '^## \[Non publié\]' CHANGELOG.md || { echo "Section [Non publié] absente de CHANGELOG.md." >&2; exit 1; }

# Le contenu de [Non publié] ne doit pas être vide
BODY="$(awk '/^## \[Non publié\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md | sed '/^[[:space:]]*$/d')"
[ -n "$BODY" ] || { echo "[Non publié] est vide : rien à publier." >&2; exit 1; }

DATE="$(date +%F)"
awk -v v="$V" -v d="$DATE" '/^## \[Non publié\]/{print; print ""; print "## [" v "] - " d; next} {print}' CHANGELOG.md > CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md

if [ -f package.json ]; then
  npm version "$V" --no-git-tag-version --allow-same-version >/dev/null
  git add package.json
  [ -f package-lock.json ] && git add package-lock.json
fi

if [ -f desktop/package.json ]; then
  (cd desktop && npm version "$V" --no-git-tag-version --allow-same-version >/dev/null)
  git add desktop/package.json desktop/package-lock.json
fi

git add CHANGELOG.md
git commit -q -m "chore(release): $TAG"
git tag -a "$TAG" -m "Allumi $TAG"

echo "Version $TAG prête localement. Pour publier :"
echo "  git push origin main && git push origin $TAG"
echo "Le workflow « Release » crée la release GitHub et l'image Docker."
