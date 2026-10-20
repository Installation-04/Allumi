# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/); versionnage [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.2.0-alpha.2] - 2026-10-20

### Ajouté
- Choix de thème clair, sombre ou système, mémorisé par navigateur et appliqué dès le rendu serveur; contrastes des contacts et onglets corrigés.
- Parcours anglais et thèmes vérifiés sur ordinateur/téléphone; manifeste iOS localisé et guide anglais illustré.

### Documentation
- Guides alignés sur la préversion v0.2.0-alpha.1 : contacts intégrés, installation Proxmox épinglée et liens clients.

## [0.2.0-alpha.1] - 2026-10-20
### Modifié
- Suivi du développement transféré dans Notion; retrait du carnet et de ses liens du wiki, du README et de l’interface.
- Interface affinée selon les références visuelles : barre latérale sombre pleine hauteur, en-tête et onglets compacts sur ordinateur; navigation fixe en bas et résumés en cartes sur téléphone.
- Migration `deposit_needs_items` : un dépôt bancaire doit contenir au moins un paiement (un dépôt vide sortait son montant des fonds non déposés sans déposer de paiement).
- `restore.sh` crée les rôles PostgreSQL de l'application avant `pg_restore` (les rôles ne sont pas dans la sauvegarde), restaure en une transaction et recalcule les statistiques.

### Ajouté
- Client Windows EXE avec sélection du serveur HTTPS et mises à jour depuis les releases; publication des installateurs, métadonnées de mise à jour et sommes SHA-256.
- Installation iOS depuis Safari sur l’écran d’accueil : manifeste, icônes et affichage autonome, en ligne.
- Page Versions et agent serveur facultatif : demande réservée à l’administrateur, sauvegarde obligatoire, versions publiées et plus récentes uniquement; guides Windows, iOS et Proxmox.
- Navigation par activité avec pages d’accueil explicites, menu complet sur téléphone et barre latérale défilante.
- Contacts (phase 4.1) : clients/fournisseurs, recherche, pagination, fiches adaptatives, archivage/restauration, permissions et audit; guide et captures ordinateur/téléphone.
- Wiki enrichi : guide utilisateur, état des fonctionnalités, références visuelles ordinateur/mobile, procédure de publication et synchronisation des images.
- Refonte de l’espace comptable : navigation latérale sur ordinateur, navigation tactile horizontale, identité verte, cartes de soldes réels du grand livre, dernières écritures et accès rapides; reprise du mandat et découpage de la phase 4 dans la feuille de route.
- Web mobile : saisie des écritures en lignes adaptatives, contrôles tactiles agrandis, navigation et espacement adaptés aux téléphones; vérification du parcours comptable à largeur mobile.
- L'activation de la vérification en deux étapes demande le mot de passe du compte, comme sa désactivation : un témoin de session volé ne permet plus d'enrôler l'application d'un tiers.
- Moteur comptable (phase 3) : plan comptable (plan de départ canadien de 47 comptes, bilingue, comptes système), journal avec écritures manuelles et soldes d'ouverture (partie double vérifiée par l'application et par la base, numérotation sans trou, contre-passation), exercices et périodes mensuelles (verrouillage, fermeture, réouverture réservée au propriétaire avec 2FA, motif et audit), balance de vérification, consultation de la piste d'audit; écrans, messages français et anglais, pages du wiki ([[Plan-comptable]], [[Journal-et-ecritures]], [[Exercices-et-periodes]], [[Piste-d-audit]]). Rouvrir une période ou un exercice demande en plus un code de l'application d'authentification saisi à ce moment. Tests : propriétés (P1, P2, P3, P5, P7, P8, P11, P13), test à états, accord domaine/base, et les cas SQL de la phase 1 portés en Vitest. Nouvelle variable de test `ALLUMI_TEST_TEMPLATE`.
- Infrastructure Docker Compose (PostgreSQL, migrations, application, Caddy).
- Scripts : installation Ubuntu, sauvegarde chiffrée, restauration, mise à jour, publication du wiki.
- Wiki complet dans `docs/`, CONTRIBUTING, SECURITY.
- Prompt de développement Claude Code et conventions (`CLAUDE.md`).
- Environnement de développement cloud (`scripts/cloud-setup.sh`) et CI GitHub Actions.
- Versionnage SemVer : `scripts/release.sh`, workflow Release (release GitHub + image GHCR), version dans `/api/health`.
- Squelette de l'application (phase 2) : Next.js 16, TypeScript strict, Prisma 7, Tailwind 4; page `/setup` de premier démarrage (se désactive ensuite), connexion (argon2id, sessions à jeton haché, limitation de débit, verrouillage de compte), vérification en deux étapes TOTP avec codes de récupération, interface en français canadien et en anglais, `GET /api/health`.
- **Nouvelles variables d'environnement `APP_DB_PASSWORD` et `APP_DATABASE_URL`** : l'application se connecte avec un rôle PostgreSQL restreint (`allumi_app`) et ne reçoit plus les identifiants du propriétaire de la base. `install.sh` et `cloud-setup.sh` les génèrent; le service `migrate` configure le rôle à chaque démarrage.
- Tests : unitaires (dont propriétés), intégration sur une vraie base avec le rôle restreint, parcours Playwright; jobs `e2e` et `docker` de la CI, vérification de dérive Prisma.
- **Nouvelles variables facultatives `SETUP_TOKEN` et `TRUSTED_PROXY_HOPS`** : le jeton d'installation (généré par `install.sh`) empêche la première personne qui atteint l'adresse de créer l'administrateur; `TRUSTED_PROXY_HOPS` dit combien de proxys de confiance précèdent l'application, pour que la limitation de débit ne se fie pas à une adresse que le client peut forger.
- Revue d'exactitude de la phase 2 : le formulaire `/setup` conserve le mois d'exercice et la langue choisis après une erreur; le code de récupération se saisit au clavier d'un téléphone; les codes de récupération restent affichés si on change de langue; erreurs inattendues en message traduit plutôt qu'en page brute; contraste, focus, titres de page et en-tête étroit; sauvegardes qui conservent les propriétaires (la fonction de caviardage de la Loi 25 ne casse plus après une restauration); `update.sh vX.Y.Z`; `/setup` reste fermé en production sans `SETUP_TOKEN`.
- Revue de sécurité de la phase 2 : le verrouillage de compte repart à zéro quand il expire, une réponse identique pour un compte verrouillé et un compte inconnu, déconnexion qui efface bien le cookie `__Host-`, autres sessions fermées lors d'un changement de 2FA, purge des compteurs de limitation, clés distinctes pour les compteurs (`AUTH_SECRET`) et les codes de récupération (`ENCRYPTION_KEY`).
- Conception de la phase 1 (wiki) : architecture finale et découpage en modules, schéma de données complet (45 tables, contraintes, triggers de partie double, isolation par entreprise avec RLS liée à l'adhésion, rôles appliqués par la base), plan de tests du moteur comptable et liste des risques. Schéma révisé après une revue adversariale (sécurité, comptabilité, PostgreSQL, complétude).
