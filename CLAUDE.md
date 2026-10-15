# CLAUDE.md — conventions du projet Allumi

Allumi est un logiciel de comptabilité open source (MIT), auto-hébergeable, pour le Québec et le Canada.

## Règles de base
- Langue : le code et les commentaires techniques en anglais, la documentation (docs/) et l'interface en français (fr-CA par défaut), avec traduction anglaise.
- Clean-room : ne jamais copier de code, icônes, textes ou design d'un logiciel propriétaire.
- Pas de secrets dans le dépôt. Les valeurs viennent de .env (jamais commité).

## Comptabilité (non négociable)
- Montants en entiers (cents) ou Decimal. Jamais de float.
- Débits = crédits, validé dans l'app et en base.
- Écritures validées immuables : correction par contre-passation.
- Piste d'audit sur toute modification.
- Toute requête est filtrée par company_id.

## Infrastructure
- Le contrat d'infra est dans Dockerfile, docker-compose.yml, .env.example et scripts/. Les modifier en même temps que le code qui l'exige.
- /api/health doit répondre 200 si la base répond.
- Migrations Prisma appliquées par le service `migrate`, jamais par l'app.
- Écritures disque seulement dans /tmp, /app/.next/cache et /app/storage.

## Environnement cloud (Claude Code sur le web)
- Pas de démon Docker en session cloud : ne tente pas `docker compose`. Lance `./scripts/cloud-setup.sh` (PostgreSQL local + .env de dev).
- Le build Docker et le healthcheck sont validés par la CI GitHub (`.github/workflows/ci.yml`). Garde le Dockerfile et docker-compose.yml cohérents avec l'app et vérifie le résultat de la CI.
- Travaille sur une branche, ouvre une PR, ne pousse pas directement sur `main`.

## Versions
- SemVer, tags `vX.Y.Z`. Ne crée ni ne modifie de tag toi-même : les releases passent par `scripts/release.sh` (voir docs/Versions-et-releases.md).
- Chaque PR ajoute une ligne sous [Non publié] dans CHANGELOG.md.

## Documentation
- docs/ est le wiki. Mettre à jour la page concernée dans le même commit que la fonctionnalité.
- Liens internes au format [[Nom-de-page]].

## Workflow
- Commits : Conventional Commits (feat:, fix:, docs:, chore:, test:, refactor:).
- Petits commits, un sujet à la fois. Tests avant de commit.
- Avant de déclarer terminé : tests, typecheck, lint, build Docker, doc, CHANGELOG.
- Commandes utiles : `make help`.
