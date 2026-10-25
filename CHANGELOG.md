# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/); versionnage [SemVer](https://semver.org/lang/fr/).

## [Non publié]

- Banque (phase 5, lot 5c) : rapprochement bancaire (Banque et transactions → Rapprochement bancaire; propriétaires et comptables agissent, tous consultent). On commence un rapprochement par compte de banque, de caisse ou de carte de crédit avec la date et le solde finaux du relevé (le solde dû pour une carte), on pointe les lignes du journal que le relevé confirme (une case par ligne, ou d'un clic toutes celles qu'apparient des transactions) avec le solde du relevé, le total compté et l'écart en direct, et on le termine quand l'écart est exactement nul. Un rapprochement terminé est figé et fige les appariements de ses lignes; seul le dernier d'un compte se rouvre, avec un motif consigné à la piste d'audit; on peut abandonner celui qui est en cours. Une ligne n'est comptée que par un rapprochement, sur son compte, au plus le jour du relevé; au plus 5 000 lignes par feuille. Les règles sont celles du domaine, du service et de la base (gardes déjà en place). Migration `20261028000000_bank_reconciliation` : seul un rapprochement terminé fige un appariement (les coches d'un rapprochement en cours se changent librement). Aucune écriture n'est créée ni changée.

- Banque (phase 5, lot 5b) : appariement des transactions bancaires (Transactions bancaires → Traiter; propriétaires et comptables). Allumi propose l'écriture probable de chaque ligne (même compte, montant exact, sept jours, la plus proche) et l'apparie en un clic; une fiche permet d'apparier une ligne à une ou plusieurs lignes du journal cochées (un dépôt de plusieurs chèques, un paiement Stripe brut moins les frais) avec le total courant, d'enregistrer une ligne contre un autre compte (écriture de deux lignes de source Banque, datée de la transaction) ou de lier deux lignes de montants opposés sur deux comptes en un virement (une écriture, datée de la plus ancienne). Le total apparié est exactement le montant de la transaction (domaine, service et base); une ligne du journal ne s'apparie qu'à une transaction, même sous deux demandes simultanées; une transaction n'a jamais deux écritures non contre-passées; défaire un appariement est refusé tant qu'un rapprochement compte la ligne. Les écritures de source Banque se contre-passent comme les écritures manuelles. Migration `20261027000000_bank_matching` (garde sur `bank_match`); le rapprochement de fin de période suit.

- Banque (phase 5, lot 5a) : import de relevés bancaires et de cartes de crédit en CSV et en OFX/QFX (Transactions bancaires → Importer un relevé; propriétaires et comptables). Le navigateur lit le fichier avec le code du serveur pour l'aperçu (format, nombre de transactions, dates, entrées et sorties, premières lignes, choix des colonnes d'un CSV : date et son ordre, description, montant en une colonne signée ou en deux colonnes sorties/entrées, séparateur décimal, signes inversés pour une carte); le serveur relit le fichier avant d'enregistrer. Montants en cents exacts, UTF-8 et Windows-1252, 4 Mo et 20 000 lignes au plus; un fichier ou une ligne illisible refuse l'import entier. Un fichier déjà importé est refusé (SHA-256) et une ligne déjà connue est laissée telle quelle (identifiant de la banque pour l'OFX; date, montant, description et rang pour le CSV), donc des relevés qui se chevauchent s'importent sans doublon, même simultanément. Le fichier n'est pas conservé; les colonnes choisies sont retenues par compte. La page des transactions importées devient « Transactions bancaires » : tous les comptes, relevés et services (Stripe, PayPal) ensemble, avec filtres et recherche. Aucune écriture comptable, aucune migration; l'appariement et le rapprochement suivent.

- Encaissements de factures (lot 4.5) : une facture validée affiche son état (non payée, partiellement payée, payée), ses encaissements et, pour le propriétaire et les comptables, un formulaire qui propose le solde restant. Un encaissement crée en une transaction l’écriture (débit du compte de réception : banque, caisse ou fonds non déposés; crédit des comptes clients), l’encaissement numéroté sans trou (`E-00001`) et l’affectation à la facture. Le solde vu par le formulaire est vérifié sous verrou : un double envoi, un formulaire périmé ou deux encaissements simultanés ne dépassent jamais le solde. Nouvelle page Ventes → Encaissements (liste et fiche) et annulation motivée (écriture inverse, affectation retirée, solde rétabli); une facture ne s’annule plus tant qu’un encaissement lui est appliqué. Ni remboursement, ni dépôt groupé, ni trop-perçu, ni paiement fournisseur dans ce lot. Aucune migration.

- Intégrations (Stripe et PayPal) : le propriétaire connecte un service (clés vérifiées auprès du service, puis chiffrées en AES-256-GCM, liées à la connexion, lisibles du propriétaire seul et jamais copiées dans l’audit) et importe ses transactions (paiements, frais, remboursements, virements) dans une boîte de réception : Banque et transactions → Intégrations et Transactions importées. Montants en cents exacts (brut, frais, net), devise conservée (pas de conversion), devises sans cents ignorées et comptées; réponse inattendue refusée sans rien importer. Synchronisation manuelle, idempotente, par fenêtres de 31 jours reprises là où elles s’arrêtent, un passage à la fois. Aucune écriture comptable ni donnée de client importée. Architecture prête pour d’autres services (Square, flux bancaires, Shopify/WooCommerce…). Les connecteurs suivent la documentation officielle mais n’ont pas été essayés contre un vrai compte : voir la page Intégrations. Migration `20261025000000_integrations`; `ENCRYPTION_KEY` protège désormais aussi ces clés.


- Paiement en ligne des factures (Stripe) : le propriétaire crée, pour une facture validée, un lien de paiement hébergé par Stripe (une page, un paiement, pour le solde du moment; aucune adresse publique ni webhook : Allumi appelle Stripe et, sur demande, regarde si la page a été payée). Un paiement réglé s'enregistre en une transaction : encaissement au montant brut sur le compte de la connexion, appliqué à la facture, et frais de traitement dans une écriture à part (compte de charges choisi sur la connexion), de sorte que le solde du compte égale le net versé par Stripe. Rien ne s'enregistre deux fois (session unique, lien verrouillé, clés d'idempotence à la création); ce que les livres refusent (solde changé, facture annulée, période verrouillée, autre devise de règlement) met le lien « À vérifier » avec sa raison, sans rien écrire. Annulation d'un lien (page fermée chez Stripe, paiement arrivé entre-temps enregistré). La base refuse les mêmes cas que le domaine (gardes `payment_link_guard` et `online_payment_guard`, un seul lien en cours par facture, rien ne se supprime ni ne change une fois payé). Dollars canadiens, 0,50 $ à 999 999,99 $; PayPal et les remboursements viendront après. Appels non essayés contre un vrai compte Stripe : voir la page Intégrations. Migration `20261026000000_online_payments`; dépend des encaissements (#31) et des intégrations (#32).

## [0.4.0-alpha.12] - 2026-10-25

- Publication : démarrage réel des images téléchargées depuis GHCR sur AMD64 et ARM64 avant publication des fichiers de release.

- Sécurité : politique CSP stricte par nonce sur les pages (scripts et styles seulement avec un nonce neuf à chaque réponse, `strict-dynamic`, aucun `unsafe-inline` ni `unsafe-eval` en production), générée par `src/proxy.ts` à partir de `src/platform/csp.ts`. Sans `upgrade-insecure-requests` (HTTP direct par conception). Les images et icônes gardent la politique ciblée. Le parcours navigateur échoue à la moindre ressource bloquée. Aucune migration.

- Installation : le jeton de première configuration est affiché à la fin de l’installation (`install-docker.sh`, donc aussi `get.sh --docker-only`, et `install.sh`), avec ce à quoi il sert. Il n’apparaît que si la page `/setup` est encore ouverte, vérifiée sur la vraie page dans le conteneur : une instance déjà configurée n’affiche plus un secret inutile, et sans réponse le script renvoie vers `.env`. `install.sh` l’affichait toujours; il utilise maintenant la même vérification, sans doublon. C’est le seul secret imprimé.

- Sécurité du déploiement : `update.sh` et `up.sh` ignorent désormais les variables de déploiement exportées par le shell (`DATABASE_URL`, `APP_DATABASE_URL`, `ALLUMI_APP_IMAGE`, etc.), comme le faisait déjà `install-docker.sh`. Compose donne la priorité à l’environnement sur `.env` : un shell de développement pouvait faire migrer et servir la mauvaise base. Fonction commune `isolate_deployment_env` dans `lib.sh`.

- Nouveau logo, original : une flamme (« allumé ») posée sur un signe égal (débit = crédit), à la place de la lettre « a » sur fond vert. Logo dessiné dans l’en-tête et le menu, icône d’onglet (SVG et `favicon.ico`, jusque-là absentes), icônes iOS et PWA avec variante « maskable » pour Android, icône de l’installateur Windows. Tout est généré par `npm run icons` à partir d’une seule définition; tests de cohérence ajoutés. Les captures ordinateur et téléphone du README et du wiki ont été régénérées avec ce logo.

- Images déjà construites : une copie placée sur une version étiquetée télécharge les images publiées par la release (application et migrations, AMD64/ARM64) au lieu de les compiler. `install-docker.sh`, `update.sh` (donc aussi la mise à jour depuis l’interface) et le nouveau `up.sh` choisissent seuls; repli sur la construction si les images sont introuvables, pour une branche ou des fichiers modifiés, ou avec `--build`. Le Compose lit `ALLUMI_APP_IMAGE`/`ALLUMI_MIGRATE_IMAGE` (noms locaux par défaut : développement et CI inchangés). La première mise à jour depuis une version antérieure construit encore sur place.

## [0.4.0-alpha.11] - 2026-10-25

- Documentation : captures ordinateur/téléphone de l’écran Sécurité du compte (appareils connectés et changement de mot de passe).

- Documentation : cadrage mobile ciblé, références dans le README et génération des captures par préfixe.
- Installation en une commande : `scripts/get.sh` (POSIX sh, utilisable avec `curl … | sh`) détecte le système, le processeur (AMD64/ARM64), la mémoire, le disque, la virtualisation, les droits et Docker, puis lance `install.sh` ou `install-docker.sh`. `--check` ne modifie rien; confirmation avant d’agir; dépôt cloné sur la dernière version, sans écraser de modifications locales. Tests dans la CI.

- Sécurité du compte : liste des appareils connectés avec déconnexion d’un appareil ou de tous les autres, et changement de mot de passe (mot de passe actuel exigé, politique de longueur, essais limités, autres appareils déconnectés, piste d’audit). FR/EN, sans migration.

## [0.4.0-alpha.10] - 2026-10-24

- Docker : application HTTP directe sur 28080 et PostgreSQL privé, sans Caddy ni SSL intégré; assistant par URL/IP, transition documentée avec conservation des données, tests natifs AMD64/ARM64. En accès direct, ignorer les en-têtes IP transférés; première configuration protégée par jeton en production HTTP comme HTTPS.

## [0.4.0-alpha.9] - 2026-10-24

- Docker : ports initiaux 28080/28443, conservation des anciens ports, CI native AMD64/ARM64 et publication des images serveur/migrations avec manifestes multiarchitecture.

- Assistant Docker interactif standard/avancé : domaine, courriel, langue, ports, adresse IPv4, délai et préparation seule; récapitulatif avant confirmation, conservation des réglages et secrets. Ports Compose persistants et redirection HTTP respectant le port HTTPS configuré.

## [0.4.0-alpha.8] - 2026-10-24

- Dépendance transitive `fast-uri` mise à jour de 3.1.8 à 3.1.9 pour corriger les avis de sécurité sur la normalisation des URI.

- Sécurité : sérialisation des changements 2FA, vérification et autorisation de session atomiques, expiration après dix minutes des connexions en attente de 2FA; protections HTTP et CSP ciblée servies aussi sans Caddy.

## [0.4.0-alpha.7] - 2026-10-24

- Annulation atomique des avoirs : retrait daté des affectations d’origine, contre-passation exacte, motif et historique FR/EN sur ordinateur et mobile; refus des remboursements actifs et affectations à une autre facture.

## [0.4.0-alpha.6] - 2026-10-24

### Ajouté
- Installateur Docker Compose dédié : préparation seule, génération atomique de configuration privée, conservation des secrets, refus des configurations de développement et des volumes orphelins, contrôle de santé avec code d’échec. Tests du script et démarrage réel de la pile dans la CI; guide Docker/Proxmox.

## [0.4.0-alpha.5] - 2026-10-24

### Ajouté
- Validation et affectation intégrale des avoirs à leur facture : numérotation atomique, écritures inversées exactes, limites cumulées de lignes/taxes, contrôles de solde et de concurrence, consultation FR/EN et mobile. Migration `20261024000000_credit_posting`.

## [0.4.0-alpha.4] - 2026-10-23

### Ajouté
- Brouillons d’avoirs partiels liés aux factures : montants par ligne, taux historiques, contrôle des révisions, consultation et suppression; parcours FR/EN, sombre et mobile. Aucun effet comptable avant une future validation.

## [0.4.0-alpha.3] - 2026-10-23

### Ajouté
- Annulation confirmée des factures avec motif, date de contre-passation, écriture inverse exacte et historique conservé. Contrôles des périodes, paiements/avoirs liés, permissions et doubles demandes; parcours FR/EN et mobile.

## [0.4.0-alpha.2] - 2026-10-23

### Corrigé
- Le sélecteur d’apparence conserve visuellement le thème enregistré après l’action serveur.

### Ajouté
- Validation atomique des factures : numéro définitif, journal équilibré, contrôle SQL des comptes de revenus et taxes, coordonnées figées, consultation FR/EN et mobile des factures verrouillées. Requêtes répétées sans double comptabilisation; annulations, avoirs, envoi et paiements non disponibles dans l’interface.

## [0.4.0-alpha.1] - 2026-10-22

### Ajouté
- Brouillons de factures FR/EN et mobile : clients, articles, lignes libres, calcul exact des taxes, recherche, modification et suppression confirmée, audit et protection contre les modifications périmées. Aucun effet comptable ni numéro définitif; validation et avoirs à venir.

## [0.3.0-alpha.2] - 2026-10-21

### Ajouté
- Fiche Entreprise FR/EN et mobile : identité, coordonnées, numéros fiscaux normalisés et réglages de documents; propriétaire seul en modification, consultation par les membres, audit et captures documentées. Reprise adaptée du travail de Claude dans la PR #4.

## [0.3.0-alpha.1] - 2026-10-21

### Ajouté
- Taxes et catalogue bilingues et adaptatifs : taux datés, codes fiscaux, simulation exacte, fiches produits/services, recherche et archivage, droits par rôle et audit.
- Migration de protection des prix et des types de comptes des articles et taxes; sauvegarder avant la mise à jour. Les anciennes données incompatibles doivent être corrigées explicitement.

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
