# Plan de tests

> Stratégie de tests du moteur comptable (phase 3) puis de chaque module. Les règles à protéger sont dans [[Regles-comptables]]; les objets de base testés sont dans [[Schema-de-donnees]].

## Principes
- **La base est testée pour de vrai.** Triggers, RLS et contraintes ne se simulent pas : les tests d'intégration roulent sur PostgreSQL (local via `scripts/cloud-setup.sh`, PostgreSQL 17 dans la CI).
- **Deux filets indépendants.** Chaque règle comptable est testée dans le domaine (TypeScript pur) **et** dans la base. Les deux doivent refuser le même cas.
- **Propriétés plutôt qu'exemples** pour le moteur : on génère des milliers de cas aléatoires et on vérifie des invariants.
- **Reproductible.** Toute graine (`seed`) d'un échec est affichée; on l'ajoute aux exemples fixes du test.

## Niveaux
| Niveau | Outil | Cible | Où |
|---|---|---|---|
| Unitaire | Vitest | `modules/*/domain` (pur), matrice des rôles, validation Zod | local, CI |
| Propriétés | Vitest + fast-check | moteur comptable, taxes, arrondi, imputation des documents | local, CI (court), nuit (long) |
| Intégration BD | Vitest + PostgreSQL | triggers, RLS, GRANT, services, concurrence | local, CI |
| Non-régression | Vitest + fichiers de référence | chaque rapport | local, CI |
| Bout en bout | Playwright | quelques parcours clés | CI |

## Environnement de test
- Une base gabarit `allumi_test_template` reçoit les migrations (`prisma migrate deploy`, rôle propriétaire) une fois par exécution. `ALLUMI_TEST_TEMPLATE=<nom>` change son nom : nécessaire pour lancer deux exécutions en même temps (deux terminaux, deux copies du dépôt), sinon elles se disputent le même gabarit.
- Chaque worker Vitest clone le gabarit (`CREATE DATABASE … TEMPLATE …`) : tests isolés et parallèles.
- Les tests se connectent avec le rôle **`allumi_app`**, comme l'application. Quelques tests se connectent en propriétaire pour vérifier que les triggers bloquent même lui.
- Les fixtures sont fictives (entreprise « Atelier Exemple inc. »), jamais de vraies données.
- fast-check : `FC_NUM_RUNS=200` par propriété en CI, `10000` la nuit; `FC_SEED` pour rejouer un échec.

## Tests unitaires du domaine
- **Argent** : analyse et affichage fr-CA (`1 234,56 $`) et en (`$1,234.56`), négatifs, zéro, grands montants; refus de plus de 2 décimales.
- **Arrondi** : table de cas (0,005 → 0,01; −0,005 → −0,01; 0,0049 → 0,00), produit quantité × prix à 4 et 6 décimales.
- **Taxes** : 100,00 $ → TPS 5,00 $ + TVQ 9,98 $ (9,975 arrondi); TVH 13 %; détaxé (0 $, mais déclaré); exonéré (non déclaré); taxe composée (historique); veille, jour et lendemain d'un changement de taux; arrondi par ligne vs par document sur des cas connus.
- **Imputation** (document → lignes d'écriture) : facture, avoir, facture fournisseur avec CTI/RTI, crédit fournisseur, dépense payée par carte, encaissement, décaissement, remboursement, annulation.
- **Rôles** : chaque action × chaque rôle (`can(role, action)`).
- **Validation** : schémas Zod des formulaires et de l'environnement (message clair si une variable manque).

## Tests de propriétés (fast-check)
Générateurs : montants (1 ¢ à 10⁹ ¢, avec les bornes), écritures équilibrées (on tire un total puis on le partage entre 1 à 10 débits et 1 à 10 crédits), écritures déséquilibrées (équilibrée + δ ≠ 0), documents (1 à 30 lignes, quantités à 4 décimales, prix à 6 décimales, lignes d'escompte négatives, codes de taxe, mode d'arrondi), dates dans l'exercice, suites d'opérations.

| # | Propriété | Niveau |
|---|---|---|
| P1 | Pour toute suite d'écritures valides, la balance de vérification est à zéro : Σ débits = Σ crédits | domaine + BD |
| P2 | Toute écriture déséquilibrée, à une seule ligne ou sans ligne est refusée par le validateur **et** par la base (`AL001`/`AL002`) | domaine + BD |
| P3 | Écriture + contre-passation laisse tous les soldes (par compte et par contact) inchangés | domaine + BD |
| P4 | L'imputation de tout document valide est équilibrée; le compte de contrôle reçoit le total, les taxes vont à leurs comptes | domaine |
| P5 | L'arrondi est symétrique (`round(−x) = −round(x)`), à moins d'un demi-cent, et identique à `round(numeric)` de PostgreSQL | domaine + BD |
| P6 | Écart entre taxe par ligne et par document ≤ (n + 1)/2 ¢ pour n lignes; taxe ≥ 0 et croissante pour une base positive | domaine |
| P7 | `parse(format(x)) = x` en fr-CA et en | domaine |
| P8 | Équation comptable : Actif = Passif + Capitaux propres + (Produits − Charges), à toute date | BD |
| P9 | Le bilan balance et le résultat net égale la variation des capitaux propres liée aux résultats | BD |
| P10 | Sous-grand livre : Σ soldes ouverts des factures et avoirs d'un client = solde du compte clients pour ce client (idem fournisseurs) | BD |
| P11 | Pour toute suite de verrouillages et réouvertures, une écriture est acceptée ⇔ sa date tombe dans une période ouverte | BD |
| P12 | Isolation : pour toute suite d'opérations dans deux entreprises, aucune requête dans le contexte A ne voit ou ne modifie une donnée de B | BD |
| P13 | Numérotation : N validations concurrentes reçoivent exactement les numéros 1…N | BD |
| P14 | Pour toute date, un seul taux de taxe s'applique, celui dont la plage contient la date | domaine + BD |
| P15 | Affectations : pour toute suite d'affectations et de retraits, Σ affectations ≤ montant du paiement et solde ouvert ≥ 0, y compris en concurrence | BD |
| P16 | Taxes recalculées : pour toute facture valide, la base de données refuse tout écart avec le calcul du domaine (rate × base, arrondi par ligne ou par document) | domaine + BD |
| P17 | Déclarations : Σ des lignes étiquetées d'une taxe sur une période = montants de la déclaration; aucune ligne ne s'ajoute à une période produite | BD |

### Test à états (fast-check `commands`)
Un **modèle en mémoire** (soldes par compte et par contact, statuts des périodes et des documents) est comparé au **service réel sur la vraie base**. Commandes aléatoires : écriture manuelle, contre-passation, facture, avoir, paiement, dépôt, affectation, retrait d'affectation, annulation, verrouillage, réouverture, rapprochement. Après chaque commande : mêmes soldes, mêmes refus (avec le même code `ALxxx`), et P1, P8 et P10 vérifiées.

## Tests d'intégration de la base
La phase 1 a validé le schéma avec 58 cas SQL exécutés **connecté en `allumi_app`** (comme l'application) et 4 cas propriétaire, tous réussis. La phase 3 les porte en Vitest (`ledger-rules.test.ts`, `documents-rules.test.ts`, `access-rules.test.ts`, `concurrency.test.ts`, qui partagent les données de `world.sql` et les aides de `world.ts`) et y ajoute les règles qui n'avaient pas encore de cas. Les familles couvertes :
- partie double (déséquilibre, une ligne, aucune ligne, débit et crédit sur la même ligne);
- immuabilité : `UPDATE`/`DELETE` refusés au rôle applicatif (privilèges) **et** au propriétaire (triggers), `TRUNCATE` refusé, lignes ajoutées après coup refusées;
- périodes : verrouillée, date hors période, exercice fermé avec périodes ouvertes, chevauchements (`EXCLUDE`);
- contre-passation : miroir accepté, non-miroir refusé, double contre-passation refusée, contre-passation d'une contre-passation refusée, écriture de document contre-passée sans annulation refusée;
- comptes de contrôle : écriture manuelle refusée, contact obligatoire;
- documents : montant de ligne = arrondi(quantité × prix), document validé figé (entête, lignes, taxes), suppression d'un brouillon en cascade;
- paiements : affectation au-delà du solde ou du paiement refusée, annulation avec affectations refusée;
- isolation : lecture et écriture inter-entreprises refusées, **IDOR** (un non-membre qui désigne une autre entreprise ne voit ni n'écrit rien), aucune ligne sans contexte, sélecteur d'entreprise limité aux adhésions, identités et secrets des autres utilisateurs invisibles;
- rôles : un membre en lecture seule lit mais n'écrit pas et ne voit pas l'audit; un comptable écrit mais ne gère pas les membres; l'application ne peut pas se donner le rôle d'administrateur d'instance;
- estampille de transaction : une ligne ne s'ajoute pas à une écriture d'une transaction antérieure, même avec une variable de session falsifiée;
- imputation : écriture de facture qui débite un autre client, écriture de paiement qui crédite un compte de produits, document sans écriture : tous refusés; taxes d'une facture recalculées (mauvais taux refusé); compte de contrôle refusé comme compte de ligne;
- dépôts : un paiement déposé une seule fois, annulation d'un paiement déposé refusée;
- affectations : jamais supprimées (privilège), retrait daté dans une période ouverte seulement, solde « au jour J » reproductible;
- audit : l'application ne peut pas y écrire, le caviardage Loi 25 retire les renseignements personnels (propriétaire seulement) et se journalise;
- accès avant contexte : invitation lue par son jeton, recherche de connexion, `/setup` refusé après le premier passage;
- audit : chaque changement journalisé avec l'acteur, sans secret, en ajout seulement;
- dernier propriétaire protégé; type d'un compte utilisé figé.

**Test de catalogue** : toute table avec `company_id` a RLS `ENABLE` + `FORCE` et une politique; chaque table d'affaires a son trigger d'audit; `allumi_app` n'a ni `UPDATE`/`DELETE` sur le journal et l'audit, ni `TRUNCATE` nulle part. Ce test attrape une migration future qui oublierait une table.

**Concurrence** (deux connexions), vérifiée en phase 1 : verrouiller une période pendant qu'une écriture y est en cours (le verrou attend le `COMMIT`, l'écriture suivante est refusée); deux affectations simultanées sur la même facture (la seconde est refusée); deux rétrogradations simultanées de propriétaires (la seconde est refusée); suppression d'une ligne de brouillon pendant la validation du document (la validation échoue et le brouillon reste intact). La numérotation de deux validations simultanées est vérifiée par P13.

**Dérive Prisma** : `prisma migrate diff --from-migrations … --to-schema … --exit-code` en CI.

**Restauration** : un `pg_dump` restauré sur une grappe neuve (avec création préalable des rôles) retrouve `allumi_app` et ses privilèges; l'application démarre et `/api/health` répond.

**Performance** : une écriture de 2 lignes insérée 8 000 fois dans une transaction se valide en moins de 5 s (index commençant par `company_id`).

## Non-régression des rapports
Un scénario fictif figé (une année d'activité d'« Atelier Exemple inc. ») produit la balance de vérification, le bilan, l'état des résultats, le grand livre, l'âge des comptes et le sommaire des taxes. Les sorties CSV sont comparées à des fichiers de référence versionnés. Tout changement de rapport doit être voulu et visible dans le diff.

## Parcours bout en bout (Playwright)
1. `/setup` : création de l'entreprise et du propriétaire, puis la page est désactivée.
2. Connexion avec 2FA, limitation de débit après plusieurs échecs.
3. Facture avec TPS/TVQ → encaissement → rapport « âge des comptes » à zéro.
4. Import d'un relevé CSV fictif → appariement → rapprochement complété.
5. Interface en anglais : aucune chaîne manquante.

## État d'avancement
Phase 3 (moteur comptable) : `npm test` roule les tests unitaires et d'intégration; `npm run test:e2e` le parcours Playwright.

- `tests/unit` : en plus de ceux de la phase 2, argent et arrondi (P5, P7), validation d'écriture (P1, P2, P3, P8), périodes (P11), plan de départ canadien, matrice des rôles.
- `tests/integration` (base clonée par fichier, rôle `allumi_app`) :
  - `ledger-service` : initialisation, écritures, refus, rôles, isolation et IDOR, numérotation sans trou (P13), contre-passation, réouverture protégée (2FA, motif, audit), exercices, comptes, audit, P1, P3, P5 et P8 sur la vraie base;
  - `engine-agreement` : le domaine et la base refusent et acceptent les mêmes écritures (P2) et la contre-passation est le miroir exact;
  - `ledger-stateful` : le test à états (modèle en mémoire contre les vrais services; écriture, contre-passation, verrouillage, réouverture) vérifie mêmes réponses, mêmes numéros, mêmes soldes, balance à zéro (P1, P8, P11);
  - `ledger-rules`, `documents-rules`, `access-rules`, `concurrency` : les cas SQL de la phase 1.
- `tests/e2e` : `/setup`, tableau de bord, 2FA, bascule en anglais, puis le parcours du moteur : plan de départ, écriture déséquilibrée refusée, écriture enregistrée, contre-passation, balance, verrouillage d'une période et refus dans celle-ci, piste d'audit.

Propriétés du tableau ci-dessus déjà implémentées : P1, P2, P3, P5, P7, P8, P11, P13 (et l'isolation, P12, par des cas d'`isolation.test.ts`). Restent : P4, P6, P14 (domaine des taxes et des imputations), P9, P10, P15 à P17 (documents, taxes, déclarations) : phases 4 et 6.

Le portage a trouvé un trou dans la base : un dépôt sans élément n'était pas comparé à son total. Il est corrigé par la migration `20261018000000_deposit_needs_items` ([[Schema-de-donnees]]).

## Critères de réussite
- Domaine : ≥ 95 % de couverture des lignes et des branches. Services : ≥ 85 %.
- Toutes les propriétés passent avec `FC_NUM_RUNS=200` en CI et `10000` la nuit.
- Aucune PR ne touche le moteur comptable sans test (règle de [[Regles-comptables]]).
