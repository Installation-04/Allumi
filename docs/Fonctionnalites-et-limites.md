# Fonctionnalités et limites

Cette page distingue les parcours livrés du schéma et des fonctionnalités planifiées. Les PR #5, #6 et #7 sont intégrées à `main`. Le lot contacts 4.1 est disponible dans la préversion v0.2.0-alpha.1.

| Domaine | Disponible actuellement | À venir |
|---|---|---|
| Installation | Docker Compose, configuration, migrations, santé, sauvegarde/restauration | Validation bêta et retours d’exploitation |
| Accès | Premier compte/entreprise, connexion, sessions et appareils connectés, changement de mot de passe, 2FA, récupération 2FA, FR/EN | Réinitialisation du mot de passe, invitations, administration des membres/entreprises |
| Comptabilité | Plan comptable, journal, soldes d’ouverture, contre-passation, périodes, balance, audit | Autres rapports détaillés |
| Interface | Web adaptatif; tableau de bord et navigation intégrés | Essais supplémentaires sur Safari iOS et appareils physiques |
| Entreprise | Identité, coordonnées et numéros fiscaux : [[Entreprise]] | Formats vérifiés, sans consultation des registres fiscaux |
| Contacts et catalogue | Clients/fournisseurs et produits/services : [[Contacts]], [[Taxes-et-catalogue]] | Pas de suivi des stocks |
| Taxes | Taux datés, codes, simulation et calcul exact : [[Taxes-et-catalogue]] | Déclarations : phase 6 |
| Ventes | Brouillons, validation comptable et encaissements : [[Brouillons-de-factures]], [[Validation-des-factures]], [[Encaissements]] | Brouillons et validation des avoirs disponibles; envoi à venir |
| Achats | Contraintes de base préparées | Factures fournisseurs et dépenses : phase 4 |
| Paiements et fichiers | Encaissements de factures : [[Encaissements]] | Remboursements, dépôts, trop-perçus, paiements fournisseurs, pièces jointes : phase 4 |
| Banque | Import des transactions Stripe et PayPal dans une boîte de réception, sans écriture comptable : [[Integrations]] | Import CSV/OFX, flux bancaires, appariement, rapprochement : phase 5 |
| Rapports et exports | Balance de vérification à l’écran; sauvegardes PostgreSQL | Bilan, résultats, grand livre, âges, sommaire TPS/TVQ et CSV/PDF : phase 6 |
| Mobilité | Navigateur connecté au serveur | Hors ligne et application native non livrés |

Les permissions et l’isolation par entreprise sont appliquées côté serveur et en base. La présence de tables pour une fonctionnalité ne signifie pas qu’un utilisateur peut déjà l’utiliser.

Voir [[Feuille-de-route]], [[Guide-utilisateur]] et [[Plan-de-tests]].

## Brouillons de factures

Création, modification, consultation et suppression sont disponibles : [[Brouillons-de-factures]]. Un brouillon n’a aucun effet comptable. La [[Validation-des-factures]] lui attribue un numéro et crée son écriture. Les [[Brouillons-d-avoirs]] préparent une correction sans effet comptable. La [[Validation-des-avoirs]] comptabilise et affecte un avoir intégralement à sa facture. Envoi et paiements restent à venir.

Annulation des factures validées disponible avec contre-passation et historique conservé : [[Annulation-des-factures]].
