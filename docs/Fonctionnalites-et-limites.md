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
| Taxes | Taux datés, codes, simulation et calcul exact : [[Taxes-et-catalogue]] | Déclarations : phase 6 |
| Ventes | Brouillons, validation comptable et encaissements : [[Brouillons-de-factures]], [[Validation-des-factures]], [[Encaissements]] | Brouillons et validation des avoirs disponibles; envoi à venir |
| Achats | Brouillons, validation et annulation des factures fournisseurs; charges avec taxes entièrement récupérables ou sans taxe | Paiements/crédits fournisseurs, dépenses immédiates, récupération partielle, ajustement des taxes et pièces jointes non disponibles |
| Paiements et fichiers | Encaissements de factures : [[Encaissements]] | Remboursements, dépôts, trop-perçus, paiements fournisseurs, pièces jointes : phase 4 |
| Banque | Import des transactions Stripe et PayPal ([[Integrations]]) et des relevés CSV et OFX ([[Import-de-releves]]) dans les transactions bancaires; appariement à des écritures existantes, écriture créée depuis une ligne et virement entre comptes ([[Appariement-bancaire]]); rapprochement de fin de période ([[Rapprochement-bancaire]]) | Flux bancaires directs, taxes réparties sur une ligne, règles automatiques : phase 5 |
| Rapports et exports | Balance de vérification, état des résultats, bilan ([[Etats-financiers]]), grand livre ([[Grand-livre]]) et âge des comptes clients ([[Age-des-comptes]]) à l’écran avec export CSV; sauvegardes PostgreSQL | Sommaire TPS/TVQ, âge des comptes fournisseurs, comparaisons et PDF : phase 6 |
| Mobilité | Navigateur connecté au serveur | Hors ligne et application native non livrés |

Les permissions et l’isolation par entreprise sont appliquées côté serveur et en base. La présence de tables pour une fonctionnalité ne signifie pas qu’un utilisateur peut déjà l’utiliser.

Voir [[Feuille-de-route]], [[Guide-utilisateur]] et [[Plan-de-tests]].

## Brouillons de factures

Création, modification, consultation et suppression sont disponibles : [[Brouillons-de-factures]]. Un brouillon n’a aucun effet comptable. La [[Validation-des-factures]] lui attribue un numéro et crée son écriture. Les [[Brouillons-d-avoirs]] préparent une correction sans effet comptable. La [[Validation-des-avoirs]] comptabilise et affecte un avoir intégralement à sa facture. Les encaissements et liens de paiement Stripe sont disponibles; l’envoi par courriel reste à venir.

Annulation des factures validées disponible avec contre-passation et historique conservé : [[Annulation-des-factures]].
