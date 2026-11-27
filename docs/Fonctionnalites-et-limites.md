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
| Rapports et exports | Balance de vérification, état des résultats, bilan ([[Etats-financiers]]), grand livre ([[Grand-livre]]) et âge des comptes clients ([[Age-des-comptes]]) et fournisseurs ([[Age-des-comptes-fournisseurs]]) à l’écran avec export CSV; [[Sommaire-des-taxes]] comptabilisées par mois, trimestre, année ou plage personnalisée avec détail/contrôle et CSV, comparaison de deux périodes avec CSV et impression ([[Comparaison-des-taxes]]); comparatifs des résultats et bilans ([[Comparaison-des-resultats]], [[Comparaison-des-bilans]]), filtre du grand livre par contact ([[Grand-livre-par-contact]]), impression/PDF navigateur des états ([[Impression-des-etats-financiers]]) et suivi de trésorerie comptabilisée ([[Suivi-de-tresorerie]]), projection par échéances avec délais clients/fournisseurs simulés, comparaison et exclusions explicites, CSV et impression/PDF navigateur complets ([[Previsions-de-tresorerie]]); relevé de compte client avec CSV et impression complète ([[Releve-de-compte-client]]); sauvegardes PostgreSQL | Génération PDF serveur, état des flux par activité, scénarios manuels de trésorerie et dépôt des déclarations à venir |
| Migration QuickBooks | [[Migration-QuickBooks]] : listes clients/fournisseurs/produits hors inventaire/comptes par CSV Online/Desktop; balance cible avec ajustements ordinaires, aperçu et confirmation | Reprise automatique des postes ouverts clients/fournisseurs/taxes, historique et fichiers natifs non disponibles; contrôles déjà rapprochés requis |
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

[[Budgets-annuels]] : scénarios annuels par exercice et compte de revenu/charge, comparaison au réel inclusif, objectifs absents signalés, CSV exact et droits Comptabilité. Limite de 1 000 comptes, avec répartition dans [[Budgets-mensuels]]; projection de trésorerie séparée par échéances dans [[Previsions-de-tresorerie]], sans scénarios manuels. La [[Duplication-des-budgets-mensuels]] reprend aussi les répartitions définies après correspondance des périodes; l’[[Import-CSV-des-budgets-mensuels]] remplace aussi les répartitions des seuls comptes listés dans un budget existant, après aperçu actuel/proposé.

[[Duplication-des-budgets]] : reprise des objectifs vers un scénario/exercice de la même entreprise, aperçu, exclusions explicites des comptes inactifs et refus des aperçus périmés. Aucune écriture financière.

[[Import-CSV-des-budgets]] : objectifs annuels importés dans un nouveau scénario depuis un CSV UTF-8 français/anglais, aperçu local, confirmation, comptes locaux actifs et création atomique auditée. Aucun budget existant écrasé ni mouvement financier importé.

Les [[Configurations-de-prevision]] partagent jusqu’à 20 réglages nommés d’horizon et de délais par entreprise, avec création/suppression auditées. Elles ne conservent aucun montant ni instantané; les scénarios avec nouveaux mouvements manuels restent hors périmètre.

[[Impression-des-budgets]] : copies paysage annuelles/mensuelles, période fiscale conservée, objectifs/réel/écarts, couverture et état d’allocation, toutes les lignes jusqu’à 1 000 comptes; lecture comptable sans accès aux autres modules, aucune modification.

## Kilométrage manuel

Le [[Carnet-de-kilometrage]] partagé est disponible : trajets professionnels/personnels, véhicule, motif et distance précise au mètre; filtres, totaux, pagination et CSV complet, modification protégée par révision et suppression confirmée auditée. Droits du module Comptabilité. GPS, itinéraires, indemnités, déductions fiscales et comptabilisation automatique restent hors de ce lot.

La copie [[Impression-du-kilometrage]] reprend tous les résultats du carnet jusqu’à 1 000 trajets, avec filtres, totaux et droits identiques. Papier paysage clair, retour aux filtres/page; PDF via le navigateur uniquement. CSV inchangé jusqu’à 5 000; aucun calcul d’indemnité ou de déduction fiscale.

[[Contrats-et-signatures]] : modèle jusqu’à 50 000 caractères, tarif horaire réutilisable, contrats immuables après publication, liens clients pour contrats/soumissions/factures, ouverture explicite et signature par nom saisi/consentement avec empreinte et audit externe. Factures consultables seulement. Pas de vérification d’identité, certificat qualifié, signature dessinée, acceptation/conversion automatique du devis ni suivi de lecture des anciens courriels sans lien.

[[Suivi-des-contrats]] : recherche littérale, filtres combinés et dates; les preuves signées restent visibles après expiration/révocation. Les nouveaux envois sont bloqués lorsque la source est annulée. Un message déjà réservé ou transmis ne peut pas être rappelé.

Disponible : [[Duplication-des-contrats]] en nouveau brouillon indépendant après revue; aucun lien privé, signature ou envoi repris, aucune synchronisation automatique avec l’original.

Disponible : [[Export-et-nettoyage-des-contrats]], CSV complet jusqu’à 5 000 résultats filtrés sans données de lien/preuve, et suppression confirmée des seuls brouillons avec audit et révision. Aucun document publié supprimé ni mouvement financier.

Disponible : [[Dossier-de-preuve-des-documents]], contenu publié et informations de signature déclarées en JSON privé, vérification de l’empreinte du contenu et conservation après expiration/révocation. Aucun scellement numérique du fichier ni contrôle d’identité.

Disponible : [[Choisir-un-client-pour-un-contrat]], recherche privée de clients actifs et sélection du nom/courriel pour revue, avec Ventes écriture et Contacts lecture. Saisie manuelle conservée et aucune synchronisation permanente avec le répertoire.

Disponible : [[Recherche-des-contrats]], recherche globale par titre/client/référence complète, étapes de consultation/signature, date de création à Toronto et suggestions internes. Ventes lecture, sans contenu ni donnée de lien et sans montant financier associé aux copies.

La [[Copie-imprimable-des-documents]] télécharge le contenu publié et la signature déclarée en HTML autonome, sous Ventes lecture et contrôle d’intégrité. Lecture hors ligne et impression en PDF via le navigateur, sans PDF généré côté serveur ni scellement numérique du fichier.

[[Acceptation-des-soumissions-signees]] : un gestionnaire Ventes peut revoir une copie de soumission signée et confirmer l’acceptation de sa source encore envoyée et valide. Révision/empreinte vérifiées et référence d’audit atomique; aucune acceptation publique automatique ni facture/écriture créée.
