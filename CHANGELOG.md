# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/); versionnage [SemVer](https://semver.org/lang/fr/).

## [Non publié]
### Ajouté
- Infrastructure Docker Compose (PostgreSQL, migrations, application, Caddy).
- Scripts : installation Ubuntu, sauvegarde chiffrée, restauration, mise à jour, publication du wiki.
- Wiki complet dans `docs/`, CONTRIBUTING, SECURITY.
- Prompt de développement Claude Code et conventions (`CLAUDE.md`).
- Environnement de développement cloud (`scripts/cloud-setup.sh`) et CI GitHub Actions.
- Versionnage SemVer : `scripts/release.sh`, workflow Release (release GitHub + image GHCR), version dans `/api/health`.
- Conception de la phase 1 (wiki) : architecture finale et découpage en modules, schéma de données complet (45 tables, contraintes, triggers de partie double, isolation par entreprise avec RLS liée à l'adhésion, rôles appliqués par la base), plan de tests du moteur comptable et liste des risques. Schéma révisé après une revue adversariale (sécurité, comptabilité, PostgreSQL, complétude).
