# Fonctionnalités et limites

Cette page distingue les parcours livrés du schéma et des fonctionnalités planifiées. Les PR #5, #6 et #7 sont intégrées à `main`. Le lot contacts 4.1 est disponible dans la préversion v0.2.0-alpha.1.

| Domaine | Disponible actuellement | À venir |
|---|---|---|
| Installation | Docker Compose, configuration, migrations, santé, sauvegarde/restauration | Validation bêta et retours d’exploitation |
| Accès | Premier compte/entreprise, connexion, sessions, 2FA, récupération 2FA, FR/EN | Réinitialisation du mot de passe, invitations, administration des membres/entreprises |
| Comptabilité | Plan comptable, journal, soldes d’ouverture, contre-passation, périodes, balance, audit | Autres rapports détaillés |
| Interface | Web adaptatif; tableau de bord et navigation intégrés | Essais supplémentaires sur Safari iOS et appareils physiques |
| Entreprise | Identité, coordonnées et numéros fiscaux : [[Entreprise]] | Formats vérifiés, sans consultation des registres fiscaux |
| Contacts et catalogue | Clients/fournisseurs et produits/services : [[Contacts]], [[Taxes-et-catalogue]] | Pas de suivi des stocks |
| Taxes | Taux datés, codes, simulation et calcul exact : [[Taxes-et-catalogue]] | Validation des factures à venir; déclarations : phase 6 |
| Ventes | Brouillons avec calcul exact : [[Brouillons-de-factures]] | Validation comptable, envoi et avoirs : phase 4 |
| Achats | Contraintes de base préparées | Factures fournisseurs et dépenses : phase 4 |
| Paiements et fichiers | Contraintes de base préparées | Paiements, dépôts, pièces jointes : phase 4 |
| Banque | Planification | Import CSV/OFX, appariement, rapprochement : phase 5 |
| Rapports et exports | Balance de vérification à l’écran; sauvegardes PostgreSQL | Bilan, résultats, grand livre, âges, sommaire TPS/TVQ et CSV/PDF : phase 6 |
| Mobilité | Navigateur connecté au serveur | Hors ligne et application native non livrés |

Les permissions et l’isolation par entreprise sont appliquées côté serveur et en base. La présence de tables pour une fonctionnalité ne signifie pas qu’un utilisateur peut déjà l’utiliser.

Voir [[Feuille-de-route]], [[Guide-utilisateur]] et [[Plan-de-tests]].

## Brouillons de factures

Création, modification, consultation et suppression sont disponibles : [[Brouillons-de-factures]]. Aucun numéro définitif, aucune écriture comptable, aucun envoi. Validation, avoirs et paiements restent à venir.
