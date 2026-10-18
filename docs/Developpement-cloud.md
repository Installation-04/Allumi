# Développement dans le cloud (Claude Code sur le web)

Allumi se développe très bien dans un environnement cloud de Claude Code : rien à installer sur ta machine.

## Particularité : pas de Docker
Les sessions cloud n'ont généralement pas de démon Docker. On utilise donc un PostgreSQL local dans la session, et la validation du build Docker est faite par GitHub Actions (`.github/workflows/ci.yml`).

| Besoin | En session cloud | Où c'est validé |
|---|---|---|
| Base de données | PostgreSQL local (`scripts/cloud-setup.sh`) | — |
| Lint, types, tests | `npm run lint && npm run typecheck && npm test` | CI |
| Parcours navigateur | `npm run build && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (Chromium est préinstallé) | CI (job `e2e`) |
| Build Docker + healthcheck | Non disponible | CI (job `docker`) |

## Mise en place
1. Pousse le repo sur GitHub (privé au début, public au lancement).
2. Sur claude.ai/code, connecte le dépôt `Allumi` et crée un environnement.
3. Dans l'environnement, mets comme **script de setup** : `./scripts/cloud-setup.sh`
4. Accès réseau : « Limité » (par défaut) suffit — npm et GitHub passent. Garde-le limité.
5. Aucun secret réel n'est nécessaire : le script génère un `.env` de dev, applique les migrations et configure le rôle restreint de l'application (`allumi_app`).
6. Démarre la session avec le prompt de `CLAUDE_CODE_PROMPT.md` (phase 1 d'abord).

## Flux de travail conseillé
- Une session = un sujet; Claude Code travaille sur une branche et ouvre une PR.
- La CI valide le build Docker : ne fusionne pas une PR dont le job `docker` est rouge.
- Tu relis le diff et fusionnes. Les migrations Prisma et le moteur comptable méritent une relecture attentive.

## Limites
- Les sessions sont éphémères : tout ce qui compte doit être commité et poussé.
- Ne mets jamais de vraies données comptables ni de vrais secrets dans une session de dev.
