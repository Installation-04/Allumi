# Contacts

Les **contacts** sont les clients et les fournisseurs de l'entreprise. Écran : **Contacts** (`/c/<entreprise>/contacts`).

## Un contact
- **Rôle** : client, fournisseur ou les deux (au moins un).
- **Identité** : nom affiché (obligatoire), nom légal, courriel, téléphone.
- **Adresse** : adresse, ville, province ou territoire, code postal, pays (deux lettres, CA par défaut). Un code postal canadien est normalisé (`h2x1y4` devient `H2X 1Y4`) et refusé s'il est impossible (les lettres D, F, I, O, Q, U n'y figurent jamais).
- **Facturation** : langue des documents, délai de paiement en jours (30 par défaut, de 0 à 365), code de taxe par défaut ([[Taxes]]).
- **Numéros d'inscription** : TPS/TVH (`123456789 RT 0001`), TVQ (`1234567890 TQ 0001`) et numéro d'exemption. Ceux d'un fournisseur justifient les crédits de taxe sur les achats. On les tape avec ou sans espaces; ils sont rangés sans espaces et refusés s'ils n'ont pas la bonne forme.
- **Notes** libres.

## La liste
Recherche par nom, nom légal ou courriel (les caractères `%` et `_` sont du texte, pas des jokers), filtre clients / fournisseurs, pages de 25. Les contacts inactifs sont masqués, avec un lien pour les afficher.

## Désactiver, supprimer
- **Désactiver** retire le contact des listes de choix mais le garde dans les livres.
- **Supprimer** n'est possible que si aucun document ne s'y rapporte; sinon, désactive.

## Effacer les renseignements personnels (Loi 25)
Le **propriétaire** peut **anonymiser** un contact : le nom, les coordonnées, les numéros d'inscription et les notes sont effacés pour de bon, le contact est désactivé, et les mêmes renseignements sont **caviardés de la piste d'audit** de ce contact ([[Piste-d-audit]]). On ne peut pas annuler, et un contact anonymisé ne se modifie plus.

Les **documents comptables déjà émis** à ce contact restent tels quels (leur nom figé en fait partie) : la loi oblige à conserver les pièces comptables, ce que la Loi 25 prévoit. L'effacement concerne le dossier du contact, pas les écritures.

## Qui peut faire quoi
| Action | Propriétaire | Comptable | Lecture seule |
|---|---|---|---|
| Consulter | oui | oui | oui |
| Créer, modifier, désactiver, supprimer | oui | oui | non |
| Anonymiser | oui | non | non |

Voir aussi : [[Produits-et-services]], [[Taxes]], [[Securite-et-Loi-25]].
