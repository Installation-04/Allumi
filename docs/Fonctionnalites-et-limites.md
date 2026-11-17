# Fonctionnalités et limites

Cette page distingue les parcours livrés du schéma et des fonctionnalités planifiées. Les PR #5, #6 et #7 sont intégrées à `main`. Le lot contacts 4.1 est disponible dans la préversion v0.2.0-alpha.1.

| Domaine | Disponible actuellement | À venir |
|---|---|---|
| Installation | Docker Compose AMD64/ARM64, configuration, migrations, santé, sauvegarde/restauration; administration déléguée et agent de sauvegarde optionnel ([[Administration-serveur]]) | Validation bêta et retours d’exploitation |
| Accès | Premier compte/entreprise, connexion, sessions et appareils connectés, changement de mot de passe, 2FA, récupération 2FA, réinitialisation du mot de passe, invitations, rôles et permissions modulaires ([[Utilisateurs-et-permissions]]), FR/EN | Validation sur appareils physiques |
| Comptabilité | Plan comptable, journal, soldes d’ouverture, contre-passation, périodes, balance, audit | Autres rapports détaillés |
| Interface | Web adaptatif; tableau de bord et navigation intégrés | Essais supplémentaires sur Safari iOS et appareils physiques |
| Entreprise | Identité, coordonnées et numéros fiscaux : [[Entreprise]] | Formats vérifiés, sans consultation des registres fiscaux |
| Contacts et catalogue | Clients/fournisseurs et produits/services : [[Contacts]], [[Taxes-et-catalogue]] | Pas de suivi des stocks |
| Taxes | Taux datés, codes, simulation et calcul exact : [[Taxes-et-catalogue]]; consultation et import confirmé des taux officiels ARC/TVQ avec provenance : [[Sources-fiscales-officielles]]; comparaison en lecture des codes existants aux taux standards datés : [[Comparaison-des-codes-fiscaux]] | TVP séparées, règles de produits/services externes, synchronisation planifiée et déclarations non disponibles |
| Ventes | [[Devis]] avec suivi, impression et conversion en facture brouillon; brouillons, validation comptable et encaissements : [[Brouillons-de-factures]], [[Validation-des-factures]], [[Encaissements]], avoirs validés/appliqués; avoir disponible et remboursement comptabilisé ([[Avoirs-disponibles-et-remboursements]]); envoi manuel SMTP ([[Envoi-des-factures]]) | Scénarios avancés de trop-perçus et envoi d’argent automatique non disponibles |
| Achats | Brouillons, validation et annulation des factures fournisseurs, paiements partiels/complets et annulation des règlements, recherche filtrée et export CSV des paiements ([[Recherche-des-paiements-fournisseurs]]); crédits fournisseurs validés/appliqués ou conservés disponibles sur facture payée ([[Credits-fournisseurs-disponibles]]) et annulation; affectations à des factures du même fournisseur, retrait daté et historique paginé ([[Affectation-des-credits-fournisseurs]]); remboursements reçus avec contre-passation, historique et export CSV filtré ([[Remboursements-fournisseurs]], [[Export-des-remboursements-fournisseurs]]), copie comptable imprimable/PDF avec origines et contre-passation ([[Impression-des-remboursements-fournisseurs]]); dépenses immédiatement payées avec fournisseur; charges avec taxes entièrement récupérables ou sans taxe; copies comptables imprimables des factures et crédits validés/annulés ([[Impression-des-achats]]) | Compensations fournisseurs, récupération partielle et ajustement des taxes non disponibles |
| Paiements et fichiers | Encaissements de factures ([[Encaissements]]), dépôts groupés des fonds non déposés ([[Depots-bancaires]]) et justificatifs privés sur les ventes et achats | Remboursements et trop-perçus restent à venir |
| Banque | Import des transactions Stripe et PayPal ([[Integrations]]) et des relevés CSV et OFX ([[Import-de-releves]]) dans les transactions bancaires; appariement à des écritures existantes, écriture créée depuis une ligne et virement entre comptes ([[Appariement-bancaire]]); rapprochement de fin de période ([[Rapprochement-bancaire]]); règles de catégorisation avec aperçu et confirmation explicite ([[Regles-bancaires]]); dépôts groupés ([[Depots-bancaires]]) | Flux bancaires directs, taxes réparties sur une ligne et comptabilisation automatique en arrière-plan non disponibles |
| Rapports et exports | Balance de vérification, état des résultats, bilan ([[Etats-financiers]]), grand livre ([[Grand-livre]]) et âge des comptes clients ([[Age-des-comptes]]) et fournisseurs ([[Age-des-comptes-fournisseurs]]) à l’écran avec export CSV; [[Sommaire-des-taxes]] comptabilisées par mois, trimestre, année ou plage personnalisée avec détail/contrôle et CSV, comparaison de deux périodes avec CSV et impression ([[Comparaison-des-taxes]]); comparatifs des résultats et bilans ([[Comparaison-des-resultats]], [[Comparaison-des-bilans]]), filtre du grand livre par contact ([[Grand-livre-par-contact]]), impression/PDF navigateur des états ([[Impression-des-etats-financiers]]) et suivi de trésorerie comptabilisée ([[Suivi-de-tresorerie]]); relevé de compte client avec CSV et impression complète ([[Releve-de-compte-client]]); sauvegardes PostgreSQL | Génération PDF serveur, état des flux par activité, prévisions et dépôt des déclarations à venir |
| Mobilité | Navigateur connecté au serveur | Hors ligne et application native non livrés |

Les permissions et l’isolation par entreprise sont appliquées côté serveur et en base. La présence de tables pour une fonctionnalité ne signifie pas qu’un utilisateur peut déjà l’utiliser.

Voir [[Feuille-de-route]], [[Guide-utilisateur]] et [[Plan-de-tests]].

## Brouillons de factures

Création, modification, consultation et suppression sont disponibles : [[Brouillons-de-factures]]. Un brouillon n’a aucun effet comptable. La [[Validation-des-factures]] lui attribue un numéro et crée son écriture. Les [[Brouillons-d-avoirs]] préparent une correction sans effet comptable. La [[Validation-des-avoirs]] comptabilise un avoir avec affectation à sa facture ou conservation du disponible pour remboursement. Le [[Releve-de-compte-client]] propose les mouvements datés, CSV et impression complète. Les encaissements et liens de paiement Stripe sont disponibles; l’[[Envoi-des-factures]] manuel par SMTP est disponible.

Annulation des factures validées disponible avec contre-passation et historique conservé : [[Annulation-des-factures]].

Les [[Justificatifs]] sont disponibles sur les documents de ventes et d’achats, selon les droits du module : PDF/PNG/JPEG privés, 4 Mo, 20 fichiers par pièce; retrait sur les brouillons, conservation après comptabilisation. Les autres cibles, la purge physique et l’analyse antivirus ne sont pas proposées dans ce lot.

## Devis

Cycle commercial livré : [[Devis]]. Finalisation et réponse consignées manuellement, [[Envoi-des-devis]] SMTP confirmé avec aperçu, facture créée en brouillon et validation séparée. Signature électronique et facturation progressive restent à venir. Les récurrences sont décrites ci-dessous.

## Factures récurrentes

[[Factures-recurrentes]] : modèles mensuels/trimestriels/annuels issus de factures validées, génération confirmée de brouillons dus, recalcul fiscal daté, pause/annulation et historique conservé. Exécution de fond et envoi automatique restent à venir. Les [[Relances-clients]] permettent un aperçu et un envoi individuel confirmé sur les factures échues; aucun échéancier ni traitement groupé.

[[Recherche-comptable]] étend la recherche globale aux comptes actifs/inactifs et aux écritures manuelles/d’ouverture et contre-passations associées. Les comptes ouvrent leur grand livre en lecture, y compris inactifs; les montants des écritures sont les totaux des débits, sans recherche dans les notes privées. Les autres sources de journal et les imports bancaires restent hors de cette extension.

[[Recherche-bancaire]] étend la recherche globale aux transactions CAD importées, selon le module Comptabilité existant; dates, montants nets et états actuels sont filtrables sans créer d’écriture.

[[Recherche-des-rapports]] ajoute 13 destinations de rapports existants à la recherche globale, selon leurs permissions, avec noms bilingues et synonymes; aucun rapport enregistré ou contenu financier n’est recherché.

[[Suggestions-de-recherche]] ajoute huit propositions maximum dans l’en-tête, selon les droits courants, sans historique applicatif ni action financière automatique.

[[Budgets-annuels]] : scénarios annuels par exercice et compte de revenu/charge, comparaison au réel inclusif, objectifs absents signalés, CSV exact et droits Comptabilité. Limite de 1 000 comptes, avec répartition dans [[Budgets-mensuels]]; sans prévisions de trésorerie. La copie et l’import restent annuels uniquement.

[[Duplication-des-budgets]] : reprise des objectifs vers un scénario/exercice de la même entreprise, aperçu, exclusions explicites des comptes inactifs et refus des aperçus périmés. Aucune écriture financière.

[[Import-CSV-des-budgets]] : objectifs annuels importés dans un nouveau scénario depuis un CSV UTF-8 français/anglais, aperçu local, confirmation, comptes locaux actifs et création atomique auditée. Aucun budget existant écrasé ni mouvement financier importé.
