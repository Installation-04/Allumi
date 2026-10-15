# Développement local

## Prérequis
Node.js 22, npm, Docker avec Compose, Git.

## Démarrer
```bash
git clone https://github.com/OWNER/allumi.git && cd allumi
cp .env.example .env
```
Dans `.env` pour le dev, utilise la base locale :
```
DATABASE_URL=postgresql://allumi:allumi_dev_only@localhost:5432/allumi?schema=public
SMTP_HOST=localhost
SMTP_PORT=1025
APP_URL=http://localhost:3000
NODE_ENV=development
```
Puis :
```bash
make dev-up            # PostgreSQL + Mailpit
npm install
npx prisma migrate dev
npm run dev
```
- App : http://localhost:3000
- Mailpit (courriels de test) : http://localhost:8025

## Qualité
```bash
npm run lint && npm run typecheck && npm test
docker compose build   # vérifier que l'image de prod se construit
```

## Règles
- Lis [[Regles-comptables]] avant de toucher au moteur comptable.
- Toute chaîne visible va dans les fichiers de traduction fr-CA et en.
- Documente chaque fonctionnalité dans `docs/` (même commit).
- Commits en Conventional Commits.
- Clean-room : ne copie rien d'un logiciel propriétaire.

## Tester les scripts
```bash
bash -n scripts/*.sh        # syntaxe
shellcheck scripts/*.sh     # si installé
```
