# Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 0 | Infrastructure Docker, scripts, wiki | Fait |
| 1 | Architecture finale, schéma de base de données, plan de tests ([[Architecture]], [[Schema-de-donnees]], [[Plan-de-tests]]) | Fait |
| 2 | Squelette : auth, i18n, `/api/health`, `/setup`, build Docker ([[Premier-demarrage]], [[Authentification]]) | Fait |
| 3 | Moteur comptable : plan comptable, journal, périodes, audit ([[Plan-comptable]], [[Journal-et-ecritures]], [[Exercices-et-periodes]], [[Piste-d-audit]]) | Fait (PR #2 intégrée) |
| 4 | Contacts, taxes (moteur de calcul), factures, paiements, dépenses, pièces jointes | Contacts, taxes/catalogue et brouillons disponibles; validation des factures disponible; brouillons d’avoirs disponibles; validation, affectation et annulation des avoirs disponibles; avoirs disponibles sur factures payées et remboursements comptabilisés ([[Avoirs-disponibles-et-remboursements]]) |
| 5 | Banque (CSV/OFX), rapprochement | Import des transactions Stripe et PayPal ([[Integrations]]) et des relevés CSV et OFX ([[Import-de-releves]]) disponibles; appariement aux écritures, enregistrement d’une ligne et virements entre comptes disponibles ([[Appariement-bancaire]]); rapprochement de fin de période disponible ([[Rapprochement-bancaire]]); règles avec aperçu et confirmation explicite disponibles ([[Regles-bancaires]]); dépôts groupés des fonds non déposés disponibles ([[Depots-bancaires]]) |
| 6 | Rapports (dont le sommaire TPS/TVQ), exports CSV/PDF | État des résultats et bilan ([[Etats-financiers]]), grand livre avec filtre par contact ([[Grand-livre]], [[Grand-livre-par-contact]]) et âge des comptes clients ([[Age-des-comptes]]) avec export CSV disponibles; âge des comptes fournisseurs également disponible ([[Age-des-comptes-fournisseurs]]); sommaire des taxes comptabilisées avec contrôle et CSV disponible ([[Sommaire-des-taxes]]); comparaison des résultats disponible ([[Comparaison-des-resultats]]) et des bilans ([[Comparaison-des-bilans]]); relevés de compte client et fournisseur datés, CSV et impression complète disponibles ([[Releve-de-compte-client]], [[Releve-de-compte-fournisseur]]); suivi de trésorerie comptabilisée disponible ([[Suivi-de-tresorerie]]); impression/PDF navigateur des états et comparatifs disponible ([[Impression-des-etats-financiers]]); formulaires/dépôt des déclarations et génération PDF serveur à faire |
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

Lot 4.3a : brouillons de factures disponibles, guide [[Brouillons-de-factures]]. Validation comptable et numérotation définitive disponibles : [[Validation-des-factures]]. Brouillons d’avoirs disponibles : [[Brouillons-d-avoirs]]. Validation et annulation des avoirs disponibles : [[Validation-des-avoirs]]. Encaissements de factures disponibles : [[Encaissements]]. Envoi manuel SMTP des factures validées disponible : [[Envoi-des-factures]].

Annulation des factures validées disponible avec contre-passation et historique conservé : [[Annulation-des-factures]].


Lot 4.5 : encaissements sur facture et [[Encaissements-au-compte]] disponibles, avec affectations partielles sur plusieurs factures du même client et désaffectations datées. Dépôts groupés disponibles : [[Depots-bancaires]]. Remboursements liés aux avoirs disponibles : [[Avoirs-disponibles-et-remboursements]]. Paiements fournisseurs disponibles : [[Factures-fournisseurs]]. Ces parcours comptabilisent les fonds reçus ou envoyés séparément; ils ne transmettent aucun ordre bancaire.

Budgets annuels par exercice et compte, comparaison au réel et CSV disponibles : [[Budgets-annuels]]. La répartition sur douze périodes fiscales et le rapport mensuel sont disponibles : [[Budgets-mensuels]]. La [[Duplication-des-budgets-mensuels]] reprend aussi les répartitions définies selon les douze périodes vérifiées. L’[[Import-CSV-des-budgets-mensuels]] remplace les répartitions des comptes listés après aperçu, en conservant les annuels et les autres comptes. La [[Previsions-de-tresorerie]] propose une lecture sur 7/30/60/90 jours des échéances ouvertes avec exclusions explicites; les hypothèses de délai clients/fournisseurs de 0/7/14/30 jours sont disponibles, avec comparaison et exports. Les [[Configurations-de-prevision]] conservent les réglages d’horizon/délais sans montants. Les copies comptables annuelles/mensuelles avec période conservée sont disponibles : [[Impression-des-budgets]]. Les scénarios de montants et autres mouvements manuels restent à faire.

[[Duplication-des-budgets]] : reprise des objectifs vers un scénario/exercice de la même entreprise, aperçu, exclusions explicites des comptes inactifs et refus des aperçus périmés. Aucune écriture financière.

[[Import-CSV-des-budgets]] : objectifs annuels importés dans un nouveau scénario depuis un CSV UTF-8 français/anglais, aperçu local, confirmation, comptes locaux actifs et création atomique auditée. Aucun budget existant écrasé ni mouvement financier importé.


[[Migration-QuickBooks]] : reprise CSV des listes Online/Desktop et balance de bascule avec ajustements des comptes ordinaires. Les contrôles clients/fournisseurs/taxes doivent déjà être rapprochés via les parcours natifs; reprise automatique des postes ouverts, historique et fichiers natifs restent hors périmètre.


Des modèles CSV/TSV vierges des cinq types de lots, dans les deux langues et trois séparateurs, complètent la préparation de [[Migration-QuickBooks]]. Ils ne contiennent aucune donnée d’entreprise et ne créent aucun import lors du téléchargement.

## Carnet manuel de kilométrage

Le [[Carnet-de-kilometrage]] remplace la rubrique de prévision : saisie partagée, usages professionnel/personnel, précision au mètre, historique audité, filtres et CSV. Les trajets ne créent pas d’écriture. Le GPS, les itinéraires, indemnités et déductions automatiques restent à définir; la paie reste non livrée.

Disponible : copie dédiée [[Impression-du-kilometrage]] du carnet partagé, complète jusqu’à 1 000 trajets, avec les mêmes filtres, totaux et droits. PDF dans le navigateur; GPS, indemnités et paie restent hors de ce lot.

Disponible : [[Contrats-et-signatures]] avec conditions longues et tarif variable, partage privé et suivi d’ouverture, signature déclarée avec preuve figée. Les intégrations de signature qualifiée, l’identité vérifiée et les signatures dessinées ne font pas partie de cette livraison.

Disponible : [[Suivi-des-contrats]] avec filtres par type/étape/disponibilité, dates et contrôles d’envoi liés à l’état de la source. Aucun suivi automatique de lecture du courriel ni signature supplémentaire.

Disponible : [[Duplication-des-contrats]] en nouveau brouillon indépendant après revue; aucun lien privé, signature ou envoi repris, aucune synchronisation automatique avec l’original.

Disponible : [[Export-et-nettoyage-des-contrats]], CSV complet jusqu’à 5 000 résultats filtrés sans données de lien/preuve, et suppression confirmée des seuls brouillons avec audit et révision. Aucun document publié supprimé ni mouvement financier.

Disponible : [[Dossier-de-preuve-des-documents]], contenu publié et informations de signature déclarées en JSON privé, vérification de l’empreinte du contenu et conservation après expiration/révocation. Aucun scellement numérique du fichier ni contrôle d’identité.

Disponible : [[Choisir-un-client-pour-un-contrat]], recherche privée de clients actifs et sélection du nom/courriel pour revue, avec Ventes écriture et Contacts lecture. Saisie manuelle conservée et aucune synchronisation permanente avec le répertoire.

Disponible : [[Recherche-des-contrats]], recherche globale par titre/client/référence complète, étapes de consultation/signature, date de création à Toronto et suggestions internes. Ventes lecture, sans contenu ni donnée de lien et sans montant financier associé aux copies.

Copie imprimable des contrats et partages publiés : téléchargement HTML autonome, lecture hors ligne et impression PDF via le navigateur, contenu et signature déclarée, contrôle d’intégrité et permissions Ventes. Voir [[Copie-imprimable-des-documents]].

Revue des soumissions signées : acceptation interne confirmée, contrôle d’intégrité et de révision, audit lié à la preuve, permissions Ventes modulaires. Conversion en facture et identité du signataire restent distinctes. Voir [[Acceptation-des-soumissions-signees]].
