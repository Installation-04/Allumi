# Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 0 | Infrastructure Docker, scripts, wiki | Fait |
| 1 | Architecture finale, schéma de base de données, plan de tests ([[Architecture]], [[Schema-de-donnees]], [[Plan-de-tests]]) | Fait |
| 2 | Squelette : auth, i18n, `/api/health`, `/setup`, build Docker ([[Premier-demarrage]], [[Authentification]]) | Fait |
| 3 | Moteur comptable : plan comptable, journal, périodes, audit ([[Plan-comptable]], [[Journal-et-ecritures]], [[Exercices-et-periodes]], [[Piste-d-audit]]) | Fait (PR #2 intégrée) |
| 4 | Contacts, taxes (moteur de calcul), factures, paiements, dépenses, pièces jointes | Contacts, taxes/catalogue et brouillons disponibles; validation des factures disponible; brouillons d’avoirs disponibles; validation, affectation et annulation des avoirs disponibles |
| 5 | Banque (CSV/OFX), rapprochement | Import des transactions Stripe et PayPal ([[Integrations]]) et des relevés CSV et OFX ([[Import-de-releves]]) disponibles; appariement aux écritures, enregistrement d’une ligne et virements entre comptes disponibles ([[Appariement-bancaire]]); rapprochement de fin de période disponible ([[Rapprochement-bancaire]]) |
| 6 | Rapports (dont le sommaire TPS/TVQ), exports CSV/PDF | État des résultats et bilan avec export CSV disponibles ([[Etats-financiers]]); grand livre, âges, sommaire TPS/TVQ et PDF à faire |
| 7 | Version bêta publique | À faire |

## Idées pour plus tard
Stockage S3, API publique, paie, inventaire, multidevise, import depuis d'autres logiciels (formats ouverts), application mobile native (le web adaptatif est une priorité actuelle).

Les priorités changent selon les contributions : ouvre une discussion.

## Reprise du mandat et priorité interface

Codex reprend le mandat de développement décrit dans `CLAUDE_CODE_PROMPT.md`. Les règles de [[Architecture]], [[Regles-comptables]] et `CLAUDE.md` restent le contrat technique. Le travail continue par module, avec tests, documentation bilingue dans l’interface, changelog et revue par PR.

Avant les fonctionnalités de phase 4 :

1. **Web mobile** : PR #5, parcours tactile et saisie adaptative validés; intégrée à `main`.
2. **Espace comptable** : PR #6 intégrée à `main`; refonte de l’interface, navigation latérale sur ordinateur, navigation inférieure sur téléphone, palette verte et neutre, tableau de bord alimenté par le grand livre. Voir [[Interface-et-navigation]]. Cette refonte conserve les contrôles et permissions du moteur existant.

La référence produit est l’ergonomie familière d’un logiciel de comptabilité en ligne comme QuickBooks Online. Allumi conserve une identité, des composants, des icônes et des textes originaux.

## Phase 4 — ordre de livraison

| Lot | Résultat utilisable | Dépendances et critères spécifiques |
|---|---|---|
| 4.1 Contacts | Clients et fournisseurs : liste, recherche, création, modification, archivage | Isolation par entreprise, permissions, audit; pas de suppression de contacts référencés |
| 4.2 Taxes et catalogue | TPS/TVQ, taux datés, codes de taxe, produits et services | Calcul en cents/Decimal; arrondis, dates d’effet, exonérations et tests de propriétés avant facturation |
| 4.3 Ventes | Brouillons de factures, validation, avoirs | Contacts et taxes; écritures via `ledger` seulement, pièces validées immuables, numérotation et contre-passation |
| 4.4 Achats | Factures fournisseurs, crédits et dépenses | Même contrat de calcul, validation comptable et audit que les ventes |
| 4.5 Paiements | Encaissements, décaissements, affectations et dépôts | Factures et achats; affectations partielles, trop-perçus, annulations, fonds non déposés |
| 4.6 Pièces jointes | Ajout et consultation sur les pièces | Stockage abstrait, validation de taille/type, contrôle d’accès et chemins sûrs |

Chaque lot doit livrer un parcours réel complet sur ordinateur et téléphone. Pas de boutons factices ni de montants de démonstration dans les écrans de production. La validation comprend lint, types, tests métier et d’isolation, parcours navigateur, documentation et CI Docker verte.

Les phases 5 (imports et rapprochement), 6 (rapports et exports) et 7 (bêta) suivent ces lots. Les invitations, permissions modulaires et la récupération de mot de passe sont disponibles. Avant la bêta, compléter les essais d’administration multi-entreprise sur appareils physiques et Safari iOS. Le schéma existant ne constitue pas à lui seul une fonctionnalité livrée.

Lot 4.1 : implémentation intégrée à `main`, guide [[Contacts]].

Lot 4.2 : taxes configurables, moteur de calcul exact et catalogue, guide [[Taxes-et-catalogue]].

Lot 4.3a : brouillons de factures disponibles, guide [[Brouillons-de-factures]]. Validation comptable et numérotation définitive disponibles : [[Validation-des-factures]]. Brouillons d’avoirs disponibles : [[Brouillons-d-avoirs]]. Validation et annulation des avoirs disponibles : [[Validation-des-avoirs]]. Encaissements de factures disponibles : [[Encaissements]]. L’envoi reste à venir.

Annulation des factures validées disponible avec contre-passation et historique conservé : [[Annulation-des-factures]].
