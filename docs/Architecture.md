# Architecture

> Document vivant. Version issue de la **phase 1** (conception). Le schéma détaillé est dans [[Schema-de-donnees]] et la stratégie de tests dans [[Plan-de-tests]].

## Vue d'ensemble
```
Internet ─▶ Caddy (80/443, HTTPS auto, en-têtes de sécurité)
              └─▶ app (Next.js standalone, :3000, non-root, FS en lecture seule)
                     │  rôle PostgreSQL « allumi_app » (sans BYPASSRLS, pas propriétaire)
                     └─▶ db (PostgreSQL 17)
              migrate ─▶ db   rôle propriétaire : applique les migrations, puis s'arrête
Volumes : db_data · app_storage (pièces jointes) · app_cache · caddy_data (certificats)
```

## Stack
Versions stables visées pour la phase 2 (fixées dans `package.json`, mises à jour par PR).

| Élément | Choix | Pourquoi |
|---|---|---|
| Exécution | Node.js 22 | Image du `Dockerfile`; requis par Prisma 7 et Vitest 5 |
| Web | Next.js 16 (App Router, `output: "standalone"`) | Rendu serveur, Server Actions, image Docker compacte |
| Langage | TypeScript 6, mode strict | TypeScript 7 n'est pas encore pris en charge par typescript-eslint |
| Base de données | PostgreSQL 17 | Contraintes, triggers, RLS, `EXCLUDE` |
| ORM | Prisma 7.10 + `@prisma/adapter-pg` | Migrations versionnées, client typé; la version 8 est encore en RC |
| Validation | Zod 4 | Entrées, formulaires, environnement au démarrage |
| i18n | next-intl 4 | fr-CA par défaut, en; sans préfixe de langue dans l'URL |
| Style | Tailwind CSS 4 | Polices auto-hébergées, aucun CDN |
| Journaux | pino 10 | JSON sur stdout |
| Mots de passe | `@node-rs/argon2` (argon2id) | Recommandation OWASP |
| 2FA | `otpauth` (TOTP, RFC 6238) | Petite bibliothèque, sans dépendance réseau |
| Tests | Vitest 5, fast-check 4, Playwright | Unitaires, propriétés, parcours clés |

Toutes ces dépendances sont sous licence MIT ou Apache-2.0, compatibles avec la licence MIT d'Allumi.

## Organisation du code
```
prisma/
  schema.prisma          modèle de données (voir [[Schema-de-donnees]])
  migrations/            SQL généré + SQL complémentaire (CHECK, triggers, RLS, GRANT)
  seed.ts                données de démonstration fictives
prisma.config.ts
messages/                fr-CA.json, en.json (aucune chaîne en dur dans l'interface)
src/
  proxy.ts               session et en-têtes (remplace middleware.ts dans Next 16)
  app/                   routes et écrans : couche mince, sans règle d'affaires
    (public)/            /setup, /connexion, /invitation/[jeton]
    (app)/c/[companyId]/ écrans de chaque module
    api/health/          contrat d'infrastructure
  modules/<module>/
    domain/              fonctions pures (montants, taxes, règles d'imputation) : cible des tests de propriétés
    service/             cas d'utilisation : autorisation, transaction, appels au grand livre
    repo/                accès Prisma, toujours dans le contexte d'une entreprise
    index.ts             API publique du module (seul point d'import pour les autres modules)
  platform/              env (Zod), logger, db + contexte d'entreprise, i18n, stockage, courriel, erreurs
tests/                   intégration (base réelle), e2e (Playwright), fixtures
```

Règles de dépendance, vérifiées par ESLint (`no-restricted-imports`) :
- `app` appelle les services; jamais Prisma directement.
- Un module n'importe un autre module que par son `index.ts`.
- **Seul `ledger` écrit dans `journal_entry` et `journal_line`.** Les ventes, achats, paiements et la banque appellent `ledger.post()` et `ledger.reverse()`.
- `reports` ne fait que lire.

## Modules
| Module | Responsabilité | Tables | Phase |
|---|---|---|---|
| platform | Configuration, journaux, accès BD et contexte d'entreprise, i18n, stockage, courriel | — | 2 |
| auth | `/setup`, connexion, sessions, 2FA, réinitialisation du mot de passe, limitation de débit | `instance`, `app_user`, `user_credential`, `user_recovery_code`, `session`, `password_reset_token`, `rate_limit` | 2 |
| companies | Entreprises, membres, rôles, invitations, paramètres | `company`, `membership`, `invitation` | 2 |
| ledger | Plan comptable et gabarit canadien, exercices et périodes, journal, contre-passation, numérotation | `account`, `fiscal_year`, `fiscal_period`, `journal_entry`, `journal_line`, `number_sequence` | 3 |
| audit | Consultation de la piste d'audit, événements applicatifs | `audit_log` | 3 |
| contacts | Clients, fournisseurs, produits et services | `contact`, `item` | 4 |
| taxes | Taxes, taux datés, codes de taxe, moteur de calcul, déclarations | `tax`, `tax_rate`, `tax_code`, `tax_code_component`, `tax_return` | 4 (déclarations : 6) |
| sales | Factures, avoirs, application des avoirs | `sales_document`, `sales_document_line`, `sales_document_tax`, `sales_credit_application` | 4 |
| purchases | Factures fournisseurs, crédits fournisseurs, dépenses | `purchase_document`, `purchase_document_line`, `purchase_document_tax`, `purchase_credit_application` | 4 |
| payments | Encaissements, décaissements, affectations, compensations, dépôts | `payment`, `payment_allocation`, `payment_offset`, `bank_deposit`, `bank_deposit_item` | 4 |
| attachments | Pièces jointes derrière une interface de stockage | `attachment`, `attachment_link` | 4 |
| banking | Import CSV/OFX, appariement, rapprochement | `bank_account_profile`, `bank_import`, `bank_transaction`, `bank_match`, `bank_reconciliation`, `reconciled_line` | 5 |
| reports | Balance de vérification, bilan, état des résultats, grand livre, âge des comptes, sommaire des taxes | (lecture) | 6 |
| exports | CSV et PDF de chaque rapport et document | (lecture) | 6 |

Le moteur de taxes passe en phase 4, car les factures en ont besoin. Les rapports de taxes restent en phase 6.

## Parcours d'une requête
1. `proxy.ts` lit le cookie de session et ajoute un identifiant de requête.
2. La page ou la Server Action appelle un **service**. Le service vérifie la session, l'appartenance à l'entreprise de l'URL et le rôle.
3. Le service ouvre une transaction avec `withCompany(companyId, userId)`. Celle-ci exécute d'abord `set_config('app.user_id', …, true)`, `set_config('app.company_id', …, true)` et `set_config('app.request_id', …, true)`. Avant l'ouverture de session, `withAnonymous()` n'appelle que les fonctions étroites d'accès (connexion, session, invitation).
4. Prisma exécute les requêtes. PostgreSQL applique les politiques RLS, les contraintes et les triggers. **L'entreprise effective n'est retenue que si l'utilisateur en est membre**.
5. Une erreur SQL `ALxxx` est traduite en message i18n (voir [[Schema-de-donnees]]).

## Multi-entreprise et isolation
Quatre couches indépendantes :
1. **Application** : chaque repo reçoit le contexte d'entreprise; aucune requête sans `company_id`; le service vérifie l'appartenance et le rôle.
2. **Clés étrangères composites** `(company_id, id)` : une ligne ne peut référencer qu'une donnée de la même entreprise.
3. **Row Level Security, fail-closed** : l'app se connecte avec le rôle `allumi_app` (NOSUPERUSER, NOBYPASSRLS, pas propriétaire des tables). Toutes les tables qui portent `company_id` ont RLS `ENABLE` + `FORCE`. Sans contexte valide, aucune ligne n'est visible. **Le contexte est lié à l'adhésion** : `app_tenant_id()` ne retourne l'entreprise de la requête que si l'utilisateur en est membre actif. Un `company_id` pris dans une URL sans vérification (IDOR) ne donne donc accès à rien.
4. **Rôles appliqués par la base** : tout membre lit; `OWNER` et `ACCOUNTANT` écrivent; seul `OWNER` modifie l'entreprise et ses membres. Un membre en lecture seule ne peut rien modifier, même par erreur de code.

Les tables d'identité (`app_user`, `user_credential`, `session`, `user_recovery_code`, `password_reset_token`) sont aussi sous RLS : chacun ne voit que soi, plus les profils de ses collègues de l'entreprise courante. Avant le contexte (connexion, session, invitation, `/setup`), l'app passe par de **petites fonctions `SECURITY DEFINER`** qui ne retournent que le nécessaire. Toutes les fonctions de validation sont `SECURITY INVOKER`, donc soumises à RLS : elles ne peuvent rien révéler d'une autre entreprise. Un test de catalogue vérifie que seules `instance` et `rate_limit` échappent à RLS.

### Rôles PostgreSQL
| Rôle | Utilisé par | Droits |
|---|---|---|
| `allumi` (`POSTGRES_USER`) | service `migrate`, sauvegardes | Propriétaire des tables (superuser dans l'image `postgres`) |
| `allumi_app` | application | Privilèges explicites table par table (et par colonne); **aucun** `UPDATE`/`DELETE`/`TRUNCATE` sur le journal et l'audit; ne peut pas écrire dans l'audit directement |
| `allumi_redactor` | personne (`NOLOGIN`) | Propriétaire de `audit_redact`, seule voie de caviardage Loi 25 |

Le rôle `allumi_app` est créé par la migration sans droit de connexion; l'étape `migrate` lui donne `LOGIN` et `APP_DB_PASSWORD` à chaque démarrage (script idempotent). Au démarrage, l'app refuse de tourner si son rôle est superuser, `BYPASSRLS`, ou si `APP_DATABASE_URL` égale `DATABASE_URL`.

## Moteur comptable
- **Journal en ajout seulement.** Une écriture est validée dès son insertion : pas de brouillon dans le grand livre. Les brouillons vivent dans les documents (factures, dépenses). Une correction passe par une **contre-passation** (écriture miroir liée par `reverses_entry_id`, unique), puis une nouvelle écriture.
- **Partie double, vérifiée deux fois.** Le domaine refuse une écriture déséquilibrée avant l'envoi. Un trigger différé (`DEFERRABLE INITIALLY DEFERRED`) la refuse aussi au `COMMIT` : au moins deux lignes, Σ débits = Σ crédits, un seul côté non nul par ligne.
- **Immuabilité, trois couches** : privilèges du rôle applicatif, triggers qui refusent `UPDATE`/`DELETE`/`TRUNCATE` (même pour le propriétaire), et lignes acceptées seulement dans la transaction qui a créé l'écriture (estampille `created_txid`, posée par trigger, exacte même dans un savepoint).
- **Périodes.** Chaque exercice est découpé en périodes (mensuelles par défaut). Toute écriture doit tomber dans une période ouverte (verrou `FOR SHARE`, donc pas de course avec une fermeture). Rouvrir une période est une action privilégiée : 2FA active, motif obligatoire, audit. Pour fermer un exercice, toutes ses périodes doivent être verrouillées.
- **Comptes de contrôle et imputation exacte.** Les comptes clients et fournisseurs n'acceptent que les écritures issues de documents, de paiements et de contre-passations, toujours avec un contact. De plus, au `COMMIT`, la base vérifie que l'écriture existe pour sa pièce et que ses montants sur les comptes de contrôle et de paiement égalent le total de la pièce. L'âge des comptes concilie donc toujours avec le grand livre.
- **Deux dates.** Un document a la date de la pièce (échéance, âge des comptes) et une date comptable (l'écriture), ce qui permet les factures reçues après la fermeture d'une période et les documents d'ouverture.
- **Affectations datées.** Un paiement affecté à une facture, un avoir appliqué, une compensation : jamais supprimés, retirés à une date dans une période ouverte. L'âge des comptes à une date passée reste reproductible. Les remboursements de trop-perçu passent par `payment_offset`, les dépôts de fonds par `bank_deposit`.
- **Annulation d'un document ou d'un paiement** : contre-passation de son écriture et statut `VOID`, dans la même transaction. On retire d'abord les affectations.
- **Bénéfices non répartis** : calculés par les rapports (cumul des résultats des exercices antérieurs). Pas d'écriture de clôture.
- **Numérotation sans trou** par entreprise et par type (`number_sequence`, verrou de ligne).
- **Soldes d'ouverture** : écriture `OPENING_BALANCE` contre « Capitaux propres – soldes d'ouverture ». Les comptes clients et fournisseurs d'ouverture passent par des factures d'ouverture.

## Argent, quantités et arrondi
- Montants en `BIGINT` (cents) dans le grand livre et les totaux; `bigint` en TypeScript. Jamais de `number` pour l'argent : une règle ESLint interdit `parseFloat` et `Number()` dans `domain/`.
- Quantités `NUMERIC(19,4)`, prix unitaires `NUMERIC(19,6)`, taux `NUMERIC(9,6)`. L'arithmétique se fait en entiers mis à l'échelle.
- **Une seule fonction d'arrondi** : au cent, demi s'éloignant de zéro. C'est aussi le comportement de `round(numeric)` dans PostgreSQL : la base vérifie `montant de ligne = round(quantité × prix × 100)`.
- Taxes calculées par ligne ou par document, selon le paramètre de l'entreprise (figé sur chaque document).

## Taxes (TPS, TVQ, TVH)
- `tax` : une taxe et ses comptes (à payer; récupérable pour les CTI/RTI).
- `tax_rate` : taux par date d'effet, sans chevauchement (contrainte `EXCLUDE`). Le taux appliqué est figé sur chaque document.
- `tax_code` : combinaison appliquée à une ligne (« TPS+TVQ », « TVH ON », « Détaxé », « Exonéré », « Hors champ »), avec un traitement qui sert aux déclarations.
- Les déclarations se calculent **depuis le grand livre** : chaque ligne d'un compte de taxes porte sa taxe et sa case (`COLLECTED`, `RECOVERABLE`, `ADJUSTMENT`, `SETTLEMENT`). Une déclaration produite (`tax_return`) est figée.
- À la validation d'une facture, la base recalcule les taxes (lignes, codes, taux en vigueur à la date du document, mode d'arrondi) et refuse tout écart. Un avoir reprend les taux de la facture qu'il corrige.
- Hors MVP : méthode rapide, restrictions de CTI (ex. repas à 50 %), multidevise. Le schéma les laisse ajoutables sans refonte.

## Authentification et sessions
- `/setup` crée l'administrateur d'instance, propriétaire de la première entreprise, si `instance.setup_completed_at` est nul. L'opération (`app_setup_instance`) est sérialisée par un verrou sur la ligne `instance`, puis la page se désactive. Seul un administrateur d'instance crée ensuite d'autres entreprises.
- Mots de passe hachés en argon2id. Sessions en base : on ne stocke que le SHA-256 du jeton. Cookie `__Host-` httpOnly, Secure, SameSite=Lax, avec expiration glissante et absolue.
- TOTP (RFC 6238). Le secret est chiffré en AES-256-GCM avec `ENCRYPTION_KEY`; un code déjà accepté ne l'est jamais deux fois (`totp_last_step`); les codes de récupération sont hachés et à usage unique. Réinitialisation du mot de passe par courriel (jeton haché, à usage unique).
- Limitation de débit dans PostgreSQL (pas de Redis), par IP et par courriel. L'IP vient de `X-Forwarded-For`, posé par Caddy seulement.
- Server Actions : vérification d'origine de Next. Route handlers qui modifient des données : vérification de l'en-tête `Origin`.

### Rôles
| Action | Propriétaire | Comptable | Lecture seule |
|---|:-:|:-:|:-:|
| Consulter données, rapports, exports | ✓ | ✓ | ✓ |
| Saisir et valider écritures, documents, paiements, opérations bancaires | ✓ | ✓ | — |
| Plan comptable, taxes, rapprochements | ✓ | ✓ | — |
| Verrouiller une période | ✓ | ✓ | — |
| Rouvrir une période, un exercice ou un rapprochement (2FA + motif) | ✓ | ✓ | — |
| Consulter la piste d'audit | ✓ | ✓ | — |
| Paramètres de l'entreprise, membres, invitations | ✓ | — | — |

La matrice est du code (`can(role, action)`), testée unitairement; le service l'applique à chaque appel.

## Piste d'audit
- Triggers SQL génériques sur toutes les tables d'affaires : qui (`app.user_id`, obligatoire pour l'application), quoi (table, id, action), quand, avant/après en JSONB. On garde la ligne complète à la création et à la suppression, et seulement les colonnes changées lors d'une modification. Les secrets ne sont jamais copiés (leur changement est signalé). L'audit ne dépend donc pas de la discipline du code applicatif.
- Événements applicatifs (connexion, échec, 2FA, export, réouverture) : l'app **ne peut pas écrire dans `audit_log`**; elle appelle `app_audit_event(...)`, qui impose l'acteur, l'entreprise validée et l'horodatage.
- `audit_log` est en ajout seulement (privilèges + triggers). Exception unique : `audit_redact`, réservée au propriétaire, retire des renseignements personnels (Loi 25) sans toucher aux champs comptables, et se journalise.

## Pièces jointes, exports, journaux
- Pièces jointes : interface `Storage` (implémentation disque dans `/app/storage`, S3 plus tard). Clé `<company_id>/<aaaa>/<mm>/<uuid>`, jamais le nom fourni. Taille max 25 Mo (limite de Caddy), type MIME vérifié sur le contenu, empreinte SHA-256.
- Exports CSV en flux; PDF générés côté serveur, sans navigateur sans tête, avec polices embarquées. La bibliothèque sera choisie en phase 6.
- Journaux pino en JSON sur stdout, niveau `LOG_LEVEL`, identifiant de requête; jamais de secret ni de renseignement personnel (liste de champs masqués).

## Contrat d'infrastructure
Ce que l'application garantit à l'infrastructure :
- `GET /api/health` → 200 `{"status":"ok","version":"x.y.z"}` si la base répond (version = variable `APP_VERSION` de l'image, sinon `package.json`)
- Configuration par variables d'environnement validées au démarrage
- Migrations appliquées par `migrate`, jamais par l'app
- Écritures disque seulement dans `/tmp`, `/app/.next/cache`, `/app/storage`
- Aucun appel Internet obligatoire au démarrage
- Page `/setup` au premier démarrage, désactivée ensuite

### Changements prévus en phase 2 (avec le code qui les exige)
- Nouvelles variables `APP_DB_PASSWORD` (générée par `install.sh` et `cloud-setup.sh`) et `APP_DATABASE_URL` (rôle `allumi_app`), dans `.env.example` et [[Configuration]].
- `migrate` : après `prisma migrate deploy`, donne `LOGIN` et le mot de passe au rôle `allumi_app`. Script placé dans `prisma/`, car `.dockerignore` exclut `scripts/`. L'étape copie aussi `prisma.config.ts` (Prisma 7).
- `app` : reçoit seulement les variables dont il a besoin (plus `env_file: .env` au complet), donc ni `DATABASE_URL` propriétaire ni `POSTGRES_PASSWORD`.
- CI : migrations avec `DATABASE_URL`, tests avec `APP_DATABASE_URL`, plus une vérification de dérive Prisma et l'application de toutes les migrations sur une base vide.
- `restore.sh` : crée les rôles `allumi_app` et `allumi_redactor` avant `pg_restore` (les rôles sont globaux à la grappe et absents du `pg_dump`, mais les `GRANT` y sont), restaure avec `--exit-on-error --single-transaction`, relance l'étape `migrate`, puis `ANALYZE` (PostgreSQL ne restaure pas les statistiques).

## Décisions
| # | Décision | Raison |
|---|---|---|
| D1 | Montants en `BIGINT` cents | Exact, rapide, sans dépendance décimale côté JS |
| D2 | Journal en ajout seulement, sans brouillon | Immuabilité garantie par la base, triggers simples |
| D3 | RLS avec un rôle dédié, fail-closed et lié à l'adhésion | Un oubli de filtre ne fuit pas, et une entreprise désignée à tort ne donne rien |
| D4 | FK composites `(company_id, id)` | Références inter-entreprises impossibles |
| D5 | Audit par triggers SQL, l'app n'écrit pas dans l'audit | Complet même si le code applicatif oublie, non falsifiable |
| D6 | Bénéfices non répartis calculés | Pas d'écriture de clôture à défaire en cas de réouverture |
| D7 | CAD seulement au MVP | Multidevise reportée; colonnes `currency` déjà présentes |
| D8 | Authentification maison (argon2id, sessions en base, TOTP) | Petite surface, auditable, sans service externe |
| D9 | Limitation de débit dans PostgreSQL | Pas de Redis à exploiter |
| D10 | Logique dans des services hors Next.js | Testable sans le framework |
| D11 | Dates comptables en `DATE` locale | Pas de décalage de fuseau horaire |
| D12 | UUIDv7 générés par Prisma | Ordonnés dans le temps (index compacts), sans aller-retour |
| D13 | Validations en `SECURITY INVOKER` | Aucune fuite entre entreprises par les messages d'erreur ou les verrous |
| D14 | Estampille de transaction plutôt qu'une variable de session | Une variable de session est modifiable par n'importe quel rôle |
| D15 | Imputation vérifiée par la base (écriture ⇔ pièce) | L'âge des comptes concilie toujours avec le grand livre |
| D16 | Affectations datées, jamais supprimées | Âge des comptes reproductible à une date passée |
| D17 | Taxes recalculées par la base à la validation | Un taux ou un montant erroné ne peut pas être comptabilisé |

## Risques
| Risque | Impact | Atténuation |
|---|---|---|
| Prisma ne modélise ni triggers, ni RLS, ni `EXCLUDE`, ni `CHECK` | Objets oubliés dans une migration | SQL complémentaire versionné; test de catalogue (RLS, triggers, GRANT); `prisma migrate diff` en CI (vérifié : Prisma ne tente pas de les supprimer) |
| Contexte RLS mal posé (pool de connexions) ou entreprise désignée à tort | Données invisibles, ou accès à une autre entreprise | `set_config(…, true)` limité à la transaction; tout accès passe par `withCompany`; contexte lié à l'adhésion dans la base; tests d'isolation et d'IDOR |
| L'image `postgres` crée un superuser qui contourne RLS | Isolation inopérante si l'app l'utilise | Rôle `allumi_app` dédié; l'app ne reçoit pas les identifiants propriétaires et refuse de démarrer avec un rôle superuser ou `BYPASSRLS` |
| Les rôles ne sont pas dans `pg_dump` | Restauration sur une grappe neuve : `GRANT` en échec, l'app ne se connecte plus | `restore.sh` crée les rôles avant `pg_restore`; test de restauration en CI |
| Changement d'un enum par Prisma | Migration en échec (CHECK, index partiels, fonctions qui dépendent du type) | `CHECK` écrits sur `::text`; recette dans [[Schema-de-donnees]]; toutes les migrations appliquées sur une base vide en CI |
| Vérifications différées proportionnelles aux lignes | Lenteur d'un gros import sans statistiques | Index commençant par `company_id`; `ANALYZE` après import et restauration; test de performance (8 000 écritures sous 5 s) |
| Prisma 7 (configuration, adaptateur, ESM) et étape `migrate` du Dockerfile | Build ou migration en échec | Ajustés en phase 2, validés par le job `docker` de la CI |
| `bigint` non sérialisable en JSON | Erreurs entre serveur et client | Conversion en chaîne à la frontière, types dédiés |
| Complexité fiscale (lieu de fourniture, TVH, méthode rapide, CTI partiels) | Déclarations erronées | Codes de taxe configurables, taux datés, avertissements, revue par un comptable; méthode rapide hors MVP |
| Différences d'arrondi par ligne ou par document | Écarts de quelques cents | Règle choisie par entreprise et figée par document; tests de propriétés sur les bornes d'écart |
| Immuabilité vs Loi 25 (droit à l'effacement) | Conflit entre conservation légale et effacement | Anonymisation des contacts (`anonymized_at`), pièces conservées selon la durée légale; politique de rétention de l'audit |
| Données personnelles dans l'audit | Exposition de renseignements personnels | Secrets exclus; accès réservé aux propriétaires et comptables; purge planifiée après la durée légale |
| Performance des rapports sur de gros volumes | Lenteur | Index `(company_id, account_id, entry_date)`; soldes par période fermée en cache si nécessaire |
| Vérification différée ligne par ligne | Coût en O(n²) sur une très grosse écriture | Négligeable pour une PME; surveillé dans les tests de charge |
| Formats bancaires CSV/OFX variés | Imports ratés ou en double | Profils de colonnes, FITID, clé de dédoublonnage, SHA-256 du fichier |
| Module natif argon2 dans l'image standalone | Échec au démarrage | `serverExternalPackages`, vérifié par le healthcheck de la CI |
| Clean-room (gabarit de plan comptable, libellés) | Contenu protégé copié par mégarde | Gabarit original fondé sur la numérotation usuelle et l'IGRF public de l'ARC; revue à chaque PR |
| Perte d'`ENCRYPTION_KEY` | Secrets 2FA illisibles | Documenté dans [[Configuration]]; codes de récupération; rotation de clé prévue plus tard |
| Fuseaux horaires | Écriture datée du mauvais jour | Dates comptables en `DATE`, saisie en date locale |
| Multidevise reportée | Refonte partielle plus tard | Colonnes `currency` présentes, contraintes `CAD` à relâcher par migration |
| PostgreSQL 16 en session cloud, 17 en production | Écart de comportement | Aucune fonction propre à PG 17; la CI teste sur PG 17 |

Voir aussi [[Regles-comptables]], [[Schema-de-donnees]], [[Plan-de-tests]].
