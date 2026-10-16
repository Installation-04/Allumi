# Développement local

## Prérequis
Node.js 22, npm, Docker avec Compose, Git.

## Démarrer
```bash
git clone https://github.com/OWNER/allumi.git && cd allumi
cp .env.example .env
```
Dans `.env` pour le dev, utilise la base locale (le propriétaire pour les migrations, le rôle restreint pour l'application) :
```
DATABASE_URL=postgresql://allumi:allumi_dev_only@localhost:5432/allumi?schema=public
APP_DB_PASSWORD=allumi_app_dev_only
APP_DATABASE_URL=postgresql://allumi_app:allumi_app_dev_only@localhost:5432/allumi
SMTP_HOST=localhost
SMTP_PORT=1025
APP_URL=http://localhost:3000
NODE_ENV=development
AUTH_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -base64 32>
```
Puis :
```bash
make dev-up            # PostgreSQL + Mailpit
npm install
npm run db:migrate     # migrations + rôle restreint de l'application
npm run dev
```
- App : http://localhost:3000 (la première visite mène à `/setup` : voir [[Premier-demarrage]])
- Mailpit (courriels de test) : http://localhost:8025

Sans Docker (ex. une session cloud), `./scripts/cloud-setup.sh` fait tout cela avec un PostgreSQL local : voir [[Developpement-cloud]].

Pour ne pas envoyer de télémétrie anonyme de Next.js : `npx next telemetry disable`.

## Qualité
```bash
npm run lint && npm run typecheck
npm test                # unitaires + intégration (base PostgreSQL réelle, rôle restreint)
npm run build && npm run test:e2e   # parcours dans un navigateur (Playwright, serveur autonome)
docker compose build    # vérifier que l'image de prod se construit
```
Les tests d'intégration clonent une base migrée par fichier de test : ils ne touchent pas à ta base de dev. Voir [[Plan-de-tests]].

## Organisation du code
`src/modules/<module>/{domain,service}` (règles pures, puis cas d'utilisation), `src/platform` (environnement, base, journaux), `src/app` (pages minces). Un module n'est importé que par son `index.ts`; seul `src/platform/db.ts` touche au client Prisma généré (règles ESLint). Détails : [[Architecture]].

## Règles
- Lis [[Regles-comptables]] avant de toucher au moteur comptable.
- Toute chaîne visible va dans les fichiers de traduction fr-CA et en.
- Documente chaque fonctionnalité dans `docs/` (même commit).
- Commits en Conventional Commits.
- Clean-room : ne copie rien d'un logiciel propriétaire.

## Tester les scripts
```bash
bash -n scripts/*.sh        # syntaxe
shellcheck -x -P SCRIPTDIR scripts/*.sh   # si installé
```
