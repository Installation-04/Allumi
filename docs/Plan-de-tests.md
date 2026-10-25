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

- `tests/unit` : en plus de ceux de la phase 2, argent et arrondi (P5, P7), validation d'écriture (P1, P2, P3, P8), périodes (P11), plan de départ canadien, matrice des rôles, soldes nets de la balance (P1 telle qu'imprimée), lecture des paramètres d'URL et frontière des modules client (aucune constante exportée d'un fichier "use client").
- `tests/integration` (base clonée par fichier, rôle `allumi_app`) :
  - `ledger-service` : initialisation, écritures, refus, rôles, isolation et IDOR, numérotation sans trou (P13), contre-passation, réouverture protégée (2FA, motif, audit), exercices, comptes, audit, P1, P3, P5 et P8 sur la vraie base;
  - `engine-agreement` : le domaine et la base refusent et acceptent les mêmes écritures (P2) et la contre-passation est le miroir exact;
  - `ledger-stateful` : le test à états (modèle en mémoire contre les vrais services; écriture, contre-passation, verrouillage, réouverture) vérifie mêmes réponses, mêmes numéros, mêmes soldes, balance à zéro (P1, P8, P11);
  - `ledger-rules`, `documents-rules`, `access-rules`, `concurrency` : les cas SQL de la phase 1.
- `tests/e2e` : `/setup`, tableau de bord, 2FA, bascule en anglais, puis le parcours du moteur : plan de départ, formulaire de compte (type et sous-types, compte refusé, renommage), écriture déséquilibrée refusée avec conservation de ce qui a été saisi, écriture enregistrée, contre-passation, balance, verrouillage d'une période et refus dans celle-ci, réouverture avec un code d'authentification (refusé puis accepté), piste d'audit.
- Les tests d'intégration qui rouvrent le passé activent la 2FA pour de vrai (`enableTotp` dans `tests/integration/helpers.ts`) et fournissent un code par étape de 30 secondes, comme un propriétaire.

Propriétés du tableau ci-dessus déjà implémentées : P1, P2, P3, P5, P7, P8, P11, P13 (et l'isolation, P12, par des cas d'`isolation.test.ts`). Restent : P4, P6, P14 (domaine des taxes et des imputations), P9, P10, P15 à P17 (documents, taxes, déclarations) : phases 4 et 6.

Le portage a trouvé un trou dans la base : un dépôt sans élément n'était pas comparé à son total. Il est corrigé par la migration `20261018000000_deposit_needs_items` ([[Schema-de-donnees]]).

## Critères de réussite
- Domaine : ≥ 95 % de couverture des lignes et des branches. Services : ≥ 85 %.
- Toutes les propriétés passent avec `FC_NUM_RUNS=200` en CI et `10000` la nuit.
- Aucune PR ne touche le moteur comptable sans test (règle de [[Regles-comptables]]).

## Navigateurs mobiles

Après `npm run build`, lancer `E2E_MOBILE=1 npm run test:e2e` pour rejouer le parcours complet en émulation Chromium tactile (Pixel 7). Lancer séparément le parcours ordinateur : chaque exécution recrée sa base. La saisie est aussi vérifiée aux largeurs 320, 390 et 768 px : aucun débordement de page, champs entièrement visibles, cibles de 44 px et gestion du focus lors de l’ajout/retrait d’une ligne. Une vérification sur Safari iOS et appareils physiques reste recommandée avant publication.

Le parcours vérifie aussi les cartes du tableau de bord : actif nul à l’initialisation, actif de 1 000,00 $ après l’écriture d’ouverture fictive, puis retour à zéro après contre-passation. L’absence de débordement de page est vérifiée sur le tableau de bord, le plan comptable, le journal, la balance, les exercices et l’audit. Les captures de référence sont facultatives (`ALLUMI_SCREENSHOTS=1`) et documentées dans [[Publication-du-wiki]].

## Encaissements (lot 4.5)

`tests/integration/payments.test.ts` (service sur la vraie base, horloge fixée) vérifie : l'écriture (débit du compte de réception, crédit des comptes clients avec le contact), l'encaissement, l'affectation et le solde; les encaissements partiels successifs; la numérotation sans trou malgré les refus; chaque refus (montant nul, négatif, décimal ou au-delà du solde; mode ou date invalide; date avant la facture ou future; compte de revenus, de clients ou d'une autre entreprise; facture inconnue, brouillon, annulée ou d'une autre entreprise; période verrouillée); les rôles et l'isolation; une référence ou une note vide enregistrée comme NULL; le solde réduit par un avoir appliqué; le **double envoi simultané** (un seul encaissement) et deux encaissements concurrents (jamais au-delà du solde); l'audit; l'annulation (écriture inverse, affectation retirée sans suppression, solde rétabli, deuxième annulation sans effet, date avant l'encaissement, motif obligatoire, période verrouillée, course avec un nouvel encaissement); l'annulation de la facture refusée tant qu'un encaissement est appliqué. Les protections du service ont été éprouvées une à une en les retirant (la suite échoue chaque fois). Tests unitaires : schéma de saisie, comptes acceptés, état de règlement, notation du montant dans un champ. Le parcours navigateur (ordinateur et téléphone) refuse un trop-perçu en gardant la saisie, enregistre deux encaissements partiels, constate la facture payée, refuse une annulation antidatée puis annule, et affiche la liste en français et en anglais.

## Intégrations (Stripe et PayPal)

Le **paiement en ligne** (liens Stripe) a ses propres tests, décrits à la fin de cette section.

Aucun test n'appelle un vrai service : `tests/integration/providers.ts` simule Stripe et PayPal d'après leur documentation (authentification, filtre `created` et pagination par curseur de Stripe, fenêtre de 31 jours et pages de PayPal). Les écarts avec un compte réel restent à confirmer avec des clés d'essai ([[Integrations]]).

- **Unitaires** (`integrations-domain`, `secrets`) : cents exacts à partir des chaînes décimales (propriété), devises sans cents ignorées, dates (été, hiver, formats PayPal), convertisseurs Stripe et PayPal sur des exemples documentés (paiement, remboursement, frais rendus, virement, devise étrangère, enregistrement refusé, `brut − frais = net` en propriété), fenêtres de 31 jours et chevauchement, validation des clés (une clé publique est refusée), chiffrement lié à la connexion (une autre ligne, une autre entreprise, un autre usage ou une autre clé ne déchiffre pas).
- **Base** (`integrations-rules`, `catalog`) : la clé chiffrée n'est lisible que du propriétaire, une connexion ne se supprime ni ne change de service, de compte ou d'environnement, l'audit ne contient jamais le secret (sous aucun encodage) et ignore le bruit de synchronisation, une transaction importée arrive sur le compte de sa connexion et seulement par une connexion active, `brut − frais = net`, identifiant externe unique par compte, le dernier message d'erreur ne peut être qu'un code.
- **Service** (`integrations`) : connexion (clés vérifiées avant d'être gardées, chiffrées et liées, rôles, refus sans appel au service, messages sans texte du service), import complet par fenêtres et par pages, import répété sans doublon (y compris un enregistrement dans le chevauchement), enregistrement tardif, fenêtre enregistrée avec son point d'arrivée ou pas du tout puis reprise, verrou et verrou périmé, rôles et isolation, déconnexion et reconnexion, blob déplacé refusé, longs historiques sur plusieurs passages, fenêtre trop chargée coupée en deux, PayPal (une seule demande de jeton, `transaction_info` seulement, bac à sable) et boîte de réception (pagination, filtres, mise de côté). Quinze bris volontaires du code (verrou, chevauchement, doublons, liaison du chiffrement, pagination, validation des dates, rôles…) sont chacun détectés.
- **Navigateur** (ordinateur et téléphone) : la connexion et ses transactions sont insérées directement dans la base d'essai (le serveur, pas le navigateur, appelle le service); le parcours vérifie les listes, les refus de formulaire (clé publique, date future, secret jamais renvoyé), le message de clés illisibles avant tout appel, la boîte de réception (net, brut, frais, signalement), la mise de côté et le retour, la déconnexion, et les deux langues.

### Paiement en ligne (liens Stripe)

Comme pour l'import, aucun test n'appelle Stripe : `tests/integration/providers.ts` simule ses points d'accès d'après la documentation (prix, liens de paiement avec leur limite de sessions complétées, `Idempotency-Key` rejouée ou refusée si les paramètres changent, sessions Checkout d'un lien, PaymentIntent avec `expand[]`, un client qui paie, un paiement qui se règle plus tard). Écarts avec un vrai compte à confirmer en mode test : voir [[Integrations]].

- **Unitaires** (`online-payment-domain`) : bornes du solde d'un lien (0,50 $ à 999 999,99 $, dollars canadiens), libellé dans la langue de la facture, écriture des frais équilibrée, lecture d'un paiement Stripe en cents exacts (attente d'un paiement non réglé, autre devise de règlement, refus de toute forme inattendue ou de chiffres qui ne concordent pas), accord d'un paiement avec son lien, jour comptable en été et en hiver (minuit à Toronto), code gardé comme raison.
- **Base** (`online-payments-rules`, `catalog`) : qui crée et voit un lien et un paiement en ligne (propriétaire seul pour écrire, tous les membres pour lire, rien d'une autre entreprise), ce qu'un lien exige à sa naissance (facture validée, solde, devise, connexion Stripe active avec compte de frais), un seul lien en cours par facture, chemin des états (aucun saut ni retour, un lien payé ou annulé ne bouge plus, ce qui le lie au service ne change qu'une fois, payé seulement par un paiement en ligne), codes de texte et adresse https, jamais de suppression; un paiement en ligne n'arrive que sur un lien actif, au montant du lien, avec un encaissement brut sur le compte de la connexion appliqué à la facture du lien et, s'il y a des frais, une écriture de ces deux lignes exactement; jamais modifié ni supprimé, même par le propriétaire de la table; compte des frais (charges seulement) et audit. Dix bris volontaires du SQL sont chacun détectés.
- **Service** (`online-payments`) : compte des frais; création d'un lien (un prix puis une page, clés d'idempotence, rien du client envoyé, libellé en anglais pour une facture en anglais, un seul lien même si le bouton est pressé deux fois en même temps, même lien rendu sans appel, refus sans appel pour un brouillon, une facture annulée ou payée, un solde trop petit, des rôles non autorisés ou une connexion sans compte de frais); reprise après une panne à mi-chemin (le prix n'est pas refait, le texte du service n'est gardé nulle part); remplacement d'un lien en attente périmé; encaissement au brut et frais à part (comptes, montants, solde égal au net, date, référence); **un seul enregistrement** même avec trois vérifications simultanées; frais nuls; paiement en cours puis réglé; refus des livres (solde changé, facture annulée, période verrouillée, compte de frais retiré, montant ou devise de règlement différents) : rien d'écrit, lien à vérifier avec sa raison; deuxième paiement signalé et non enregistré; un lien illisible n'arrête pas les autres, une clé refusée arrête tout; annulation (page fermée, paiement arrivé entre-temps enregistré, signalement fermé sans appel, lien jamais créé, connexion déconnectée). Quinze bris volontaires du code sont chacun détectés.
- **Navigateur** (ordinateur et téléphone) : choix du compte des frais, vérification sans lien, création refusée faute de clés lisibles (le lien reste en préparation avec sa raison, reprise possible), annulation, lien prêt avec son adresse et ses boutons, paiement à vérifier avec sa raison, fermeture du signalement, les deux langues. Le serveur, pas le navigateur, appelle Stripe : les liens sont insérés dans la base d'essai.

## Import de relevés (phase 5, lot 5a)

Aucun test n'appelle une banque : les relevés sont des textes construits dans les tests (CSV français et anglais, OFX SGML et XML, UTF-8, Windows-1252).

- **Unitaires** (`banking-domain`) : lecture des octets (UTF-8, marque d'ordre des octets, Windows-1252, vide, trop gros), format OFX ou CSV, CSV de la RFC 4180 (guillemets, séparateurs, sauts de ligne dans une cellule, limites), montants en cents exacts (notations des banques, refus de tout ce qui n'est pas exactement un montant, **propriété** : tout montant écrit dans l'une des notations est relu à l'identique), dates réelles seulement, application d'un mapping (une colonne ou deux, signe inversé, descriptions jointes, lignes illisibles par numéro de ligne, lignes vides ou à zéro ignorées), première hypothèse de mapping (en-tête français ou anglais, sans en-tête, aucune), OFX (SGML, XML, carte, identifiants répétés, lignes illisibles, solde de clôture), clés de déduplication (rang des lignes identiques, relevés qui se chevauchent).
- **Service** (`bank-import`, vraie base) : lignes enregistrées en cents exacts avec leur clé, fichier (nom nettoyé, SHA-256, nombre de lignes ajoutées), colonnes retenues pour le compte et masque du compte OFX; CSV français à deux colonnes, carte avec signes inversés, Windows-1252 et marque d'ordre des octets, long relevé en plusieurs lots; OFX (identifiant de la banque, signes, devise refusée); relevés qui se chevauchent (lignes connues laissées telles quelles, deux lignes identiques d'un même jour, OFX reconnu par l'identifiant), même fichier refusé sur un compte et accepté sur un autre, **huit imports simultanés qui se chevauchent sans jamais échouer ni dupliquer**, même fichier envoyé deux fois en même temps (un seul passe); chaque refus (fichier vide, trop gros, guillemet non fermé, colonnes à choisir, que des zéros, OFX vide, lignes illisibles, mapping invalide, comptes de revenus, clients, d'une autre entreprise, inactif ou inconnu, rôles) sans rien laisser derrière; audit; liste (origine fichier ou service, filtres, recherche littérale, pagination, comptes avec le nombre de lignes à traiter), mise de côté et retour. Dix-neuf bris volontaires du code sont chacun détectés.
- **Navigateur** (ordinateur et téléphone) : import d'un CSV français à deux colonnes avec son aperçu, choix erroné du séparateur décimal (lignes illisibles par numéro, import refusé), import et lignes en montants exacts, même fichier refusé, fichier qui se chevauche, OFX (devise étrangère refusée, puis acceptée avec le solde déclaré), mise de côté, recherche, français et anglais.

## Appariement bancaire (phase 5, lot 5b)

- **Unitaires** (`banking-domain`) : somme des lignes appariées (une ligne, plusieurs, signes mêlés, au cent près et au-delà de la précision d'un flottant), aucune ligne, trop de lignes, ligne en double; écriture d'une transaction (sens selon le signe, toujours équilibrée, **propriété** sur des montants quelconques); virement (comptes différents, montants opposés, une ligne par compte).
- **Service** (`bank-matching`, vraie base) : apparier une ligne ou plusieurs (paiement brut et frais), refus d'un total faux, d'une liste vide, d'une ligne en double, inexistante, d'un autre compte ou d'une autre entreprise, de plus de 20 lignes, d'une transaction déjà appariée, mise de côté ou en autre devise, des rôles; **une ligne du journal ne s'apparie qu'à une transaction, même quand deux demandes la veulent en même temps**, et une transaction ne s'apparie qu'une fois quand deux demandes arrivent ensemble; défaire (la ligne redevient libre), refus tant qu'un rapprochement compte une ligne, dans le service et dans la base; enregistrer une transaction (écriture de source Banque, sens, date, note, ligne appariée), refus du même compte, d'un compte qui n'accepte pas les écritures, d'une transaction qui n'attend plus, d'une période verrouillée; **une seule écriture quand deux demandes arrivent ensemble**; refus d'une deuxième écriture tant que la première n'est pas contre-passée, puis acceptée; virement (une écriture, deux lignes, date la plus ancienne, appariements), ses candidats (autre compte, montant opposé, sept jours, le plus proche d'abord), ses refus, un virement unique quand deux demandes arrivent ensemble; écriture probable (même compte, montant exact et de même sens, sept jours, la plus proche; ni ligne appariée, ni contre-passation); candidats triés et fenêtre élargie; règles de la base contournant le service (somme fausse, compte étranger, état sans appariement, écriture Banque sans transaction). Vingt-sept bris volontaires du code sont chacun détectés.
- **Navigateur** (ordinateur et téléphone) : écriture probable offerte et appariée en un clic, défaite, appariée de nouveau; un dépôt en deux écritures avec le total courant, l'écart, le refus qui garde les cases cochées, puis l'appariement; une dépense enregistrée contre un compte (lien vers l'écriture Banque, qui se contre-passe); un virement entre la banque et la caisse; la balance reste équilibrée; français et anglais; aucun débordement.

## Rapprochement bancaire (phase 5, lot 5c)

- **Unitaires** (`banking-domain`) : signe d'un solde de carte, écart (cas limites et **propriété** sur des montants quelconques), date d'un relevé après le dernier terminé, ligne comptée au plus le jour du relevé et sur le bon compte.
- **Service** (`bank-reconciliation`, vraie base) : début d'un rapprochement (solde tel que lu, carte à signe inversé, refus d'une date inexistante, d'un solde hors limites, d'un compte qui n'est pas de relevé, inactif, d'une autre entreprise, des rôles; un seul à la fois, **même quand deux demandes arrivent ensemble**; date après le dernier terminé); feuille (lignes du compte jusqu'au jour du relevé, jamais celles d'un autre compte, d'un jour plus tard ou comptées par un autre rapprochement, ligne appariée et contre-passations signalées, totaux des relevés précédents sans les suivants); pointage enregistré **en bloc** (remplace, ne s'ajoute pas; **deux enregistrements simultanés ne se mélangent jamais**), refus d'une ligne d'un autre compte, trop tardive, inconnue ou déjà comptée, de trop de lignes; lignes appariées cochées une fois; fin refusée tant que l'écart n'est pas nul puis figée (service **et** base : ajout, retrait, suppression, solde); soldes qui se suivent d'un relevé à l'autre, ligne oubliée reprise par le suivant; carte (solde dû); réouverture du seul dernier rapprochement avec un motif consigné à l'audit, refusée si un autre est en cours, si le motif est court ou si le rapprochement n'est pas terminé, puis modifié et terminé de nouveau; abandon (coches retirées, lignes libres) jamais d'un terminé; règles de la base contournant le service. Vingt-huit bris volontaires du code du service et du domaine (et un du garde SQL) sont chacun détectés.
- **Navigateur** (ordinateur et téléphone) : début refusé pour un solde illisible (la saisie reste), feuille, lignes appariées cochées d'un clic, écart en direct et avertissement tant que le pointage n'est pas enregistré, fin possible seulement à zéro, rapprochement terminé figé (appariement non défaisable depuis la liste), réouverture refusée sans motif puis acceptée, appariement de nouveau défaisable, français et anglais, aucun débordement.

## Contacts (lot 4.1)

Les tests du service vérifient les rôles, l’isolation interentreprises, le refus de réactiver une fiche anonymisée, l’audit, la conservation des références lors de l’archivage, la recherche littérale et la pagination. La validation couvre les bornes du délai de paiement et les coordonnées. Le parcours navigateur crée, modifie, archive, retrouve et restaure un contact; il s’exécute séparément sur ordinateur et téléphone et produit les captures du wiki.
