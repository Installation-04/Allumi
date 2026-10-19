# Fonctionnalités et limites

Cette page distingue les parcours livrés du schéma et des fonctionnalités planifiées. La branche de refonte UI est une référence de développement tant que sa PR n’est pas intégrée; installer la branche principale ne garantit pas encore le même aspect.

| Domaine | Disponible actuellement | À venir |
|---|---|---|
| Installation | Docker Compose, configuration, migrations, santé, sauvegarde/restauration | Validation bêta et retours d’exploitation |
| Accès | Premier compte/entreprise, connexion, sessions, 2FA, récupération 2FA, FR/EN | Réinitialisation du mot de passe, invitations, administration des membres/entreprises |
| Comptabilité | Plan comptable, journal, soldes d’ouverture, contre-passation, périodes, balance, audit | Autres rapports détaillés |
| Interface | Web adaptatif; refonte du tableau de bord et navigation en revue | Essais supplémentaires sur Safari iOS et appareils physiques |
| Contacts et catalogue | Schéma prévu | Clients, fournisseurs, produits/services : phase 4 |
| Taxes | Schéma prévu | Moteur TPS/TVQ et taux datés : phase 4; déclarations : phase 6 |
| Ventes et achats | Contraintes de base préparées | Factures, avoirs, dépenses : phase 4 |
| Paiements et fichiers | Contraintes de base préparées | Paiements, dépôts, pièces jointes : phase 4 |
| Banque | Planification | Import CSV/OFX, appariement, rapprochement : phase 5 |
| Rapports et exports | Balance de vérification à l’écran; sauvegardes PostgreSQL | Bilan, résultats, grand livre, âges, sommaire TPS/TVQ et CSV/PDF : phase 6 |
| Mobilité | Navigateur connecté au serveur | Hors ligne et application native non livrés |

Les permissions et l’isolation par entreprise sont appliquées côté serveur et en base. La présence de tables pour une fonctionnalité ne signifie pas qu’un utilisateur peut déjà l’utiliser.

Voir [[Feuille-de-route]], [[Guide-utilisateur]] et [[Plan-de-tests]].
