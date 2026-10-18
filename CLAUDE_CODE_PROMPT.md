# Prompt Claude Code — Allumi

> Mandat initial conservé comme référence. Codex reprend le développement; l’ordre de livraison actuel et la priorité de refonte UI sont suivis dans [[Feuille-de-route]] (`docs/Feuille-de-route.md`).

Colle le bloc ci-dessous dans Claude Code, à la racine du dépôt (`cd allumi && claude`).

Modèles conseillés : **Opus 5.5** pour la phase 1 (plan, schéma, moteur comptable), puis **Sonnet 5.5** pour le développement courant.

---

```
Tu es mon ingénieur principal. On construit Allumi, un logiciel de comptabilité open source (licence MIT), auto-hébergeable, pour PME et travailleurs autonomes du Québec et du Canada. C'est une alternative à QuickBooks Online.

0. À LIRE D'ABORD
Lis dans cet ordre : README.md, CLAUDE.md, docs/Developpement-cloud.md, docs/Architecture.md, docs/Regles-comptables.md, Dockerfile, docker-compose.yml, .env.example, scripts/. Ces fichiers existent déjà et forment le contrat d'infrastructure. Si un changement dans l'app l'exige, modifie-les ET la page de docs correspondante dans le même commit.

1. RÈGLE CLEAN-ROOM
Ne décompile ni ne copie rien de QuickBooks ni d'un autre logiciel propriétaire (code, icônes, textes, design, jeux de données). Base-toi uniquement sur les principes comptables (partie double, plan comptable), la documentation publique et une UX générique. Design et nom de modules originaux.

2. STACK PAR DÉFAUT (propose mieux si tu vois mieux, en justifiant)
TypeScript strict, Next.js (App Router, output "standalone"), PostgreSQL 17, Prisma, Zod, Tailwind. Tests avec Vitest, plus Playwright pour quelques parcours clés. Interface bilingue fr-CA (défaut) et en.

3. MVP
- Plan comptable configurable (gabarit canadien de départ), journal à partie double
- Clients, fournisseurs, factures, paiements, dépenses, pièces jointes
- Rapprochement bancaire par import CSV/OFX
- TPS/TVQ avec taux configurables par date d'effet
- Rapports : balance de vérification, bilan, état des résultats, âge des comptes, grand livre
- Multi-entreprise, utilisateurs et rôles (propriétaire, comptable, lecture seule)
- Exports CSV et PDF

4. RÈGLES COMPTABLES NON NÉGOCIABLES
- Montants en entiers (cents) ou Decimal, jamais en float
- Débits = crédits, validé dans l'app ET par contrainte/trigger en base
- Écritures immuables : correction par contre-passation, jamais d'UPDATE/DELETE sur une écriture validée
- Piste d'audit complète (qui, quoi, quand, avant/après)
- Isolation stricte des données entre entreprises (company_id partout, idéalement Row Level Security)
- Périodes fermées : aucune écriture dans une période verrouillée
- Tests de propriétés sur le moteur comptable (génère des écritures aléatoires : la balance reste à zéro)

5. CONTRAT D'INFRASTRUCTURE (l'app doit respecter)
- next.config : output "standalone". Garde un dossier public/ (même vide, avec .gitkeep).
- GET /api/health : 200 + {"status":"ok","version":"x.y.z"} si la base répond (SELECT 1). La version vient de APP_VERSION (injectée par le Dockerfile), sinon de package.json. Sans authentification, sans autre donnée sensible. Affiche aussi la version dans l'interface (pied de page ou page « À propos »).
- Configuration uniquement par variables d'environnement, validée au démarrage avec Zod. Toute nouvelle variable va dans .env.example ET docs/Configuration.md. Message d'erreur clair si une variable manque.
- Migrations Prisma versionnées dans prisma/migrations, appliquées par le service "migrate" de docker-compose, jamais par l'app au runtime.
- Logs JSON sur stdout (pino), niveau via LOG_LEVEL, jamais de secrets ni de renseignements personnels.
- Le conteneur tourne en non-root, système de fichiers en lecture seule. Écritures permises seulement dans /tmp, /app/.next/cache et /app/storage.
- Pièces jointes : stockage disque dans /app/storage derrière une interface abstraite (S3 compatible plus tard).
- Aucune dépendance à Internet au démarrage (pas de télémétrie, pas de CDN de polices).
- Premier démarrage : une page /setup crée l'entreprise et l'administrateur si aucun utilisateur n'existe, puis se désactive.
- Sessions par cookies httpOnly/secure/sameSite, 2FA TOTP, limitation de débit sur la connexion.
- Courriels via SMTP (variables SMTP_*). En dev, Mailpit (docker-compose.dev.yml).
- Vérification Docker : si un démon Docker est disponible, lance `docker compose build && docker compose up -d` et attends le healthcheck. En session cloud (pas de Docker), lance `./scripts/cloud-setup.sh`, valide tout le reste localement, puis attends que le job `docker` de la CI GitHub soit vert avant de déclarer une phase terminée.

6. OPEN SOURCE
- Licence MIT. Aucun secret, aucune donnée client, aucun code propriétaire dans le dépôt.
- README, CONTRIBUTING, SECURITY et CHANGELOG (Keep a Changelog) à jour. Commits Conventional Commits.
- Versionnage SemVer (voir docs/Versions-et-releases.md). Chaque PR ajoute une ligne sous [Non publié] du CHANGELOG. Les versions se publient avec scripts/release.sh (tag vX.Y.Z), jamais à la main. package.json commence à 0.1.0.
- i18n : toutes les chaînes visibles dans des fichiers de traduction fr-CA et en. Zéro chaîne en dur.
- CI GitHub Actions : lint, typecheck, tests, build Docker, npm audit.
- Dépendances à licence compatible MIT, maintenues. Justifie toute nouvelle dépendance importante.
- Jeu de données de démonstration fictif (seed) pour le développement.

7. DOCUMENTATION
Le dossier docs/ EST le wiki (publié par scripts/sync-wiki.sh). Chaque fonctionnalité visible par un utilisateur ou un administrateur a sa page à jour, dans le même commit. Rédige en français, garde les liens au format [[Nom-de-page]].

8. MÉTHODE
Phase 1 (mode plan, AUCUN code d'app) : architecture finale, schéma Prisma complet (tables, contraintes, index), découpage en modules, plan de tests du moteur comptable, risques. Mets à jour docs/Architecture.md. Attends mon OK.
Phase 2 : squelette (Next, Prisma, i18n, auth, /api/health, /setup) + build Docker qui passe.
Phase 3 : moteur comptable (journal, plan comptable, périodes, audit) avec tests de propriétés.
Phase 4 et suivantes : un module à la fois (contacts, factures, paiements, dépenses, banque, taxes, rapports, exports), chacun avec tests, doc et petits commits.
Pose-moi une question seulement si la réponse change vraiment la conception.

DÉFINITION DE TERMINÉ (pour chaque module)
Tests verts, typecheck et lint propres, doc à jour, i18n complète, build Docker OK (local ou CI), CHANGELOG mis à jour. Travaille sur une branche et ouvre une PR.
```
