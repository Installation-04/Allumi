# Règles comptables

Ces règles sont non négociables : toute contribution qui les contourne est refusée.

## Montants
- Entiers (cents) ou `Decimal`. **Jamais de float.**
- Arrondi explicite et documenté (une seule fonction centrale).
- Taxes : calcul par ligne ou par document selon une règle configurable, jamais implicite.

## Partie double
- Chaque écriture a au moins deux lignes; la somme des débits = la somme des crédits.
- Validé dans l'application **et** en base (contrainte/trigger).

## Immuabilité
- Une écriture validée ne se modifie ni ne se supprime.
- Correction par **contre-passation** (écriture inverse) puis nouvelle écriture.

## Piste d'audit
- Qui, quoi, quand, valeurs avant/après pour toute création ou modification.
- Les journaux d'audit eux-mêmes sont en ajout seulement.

## Périodes
- Une période fermée refuse toute nouvelle écriture.
- La réouverture est une action privilégiée et auditée.

## Isolation
- Toute table de données comptables porte `company_id`.
- Aucune requête sans filtre d'entreprise; tests automatisés d'isolation.

## Taxes (TPS/TVQ)
- Taux configurables avec date d'effet (jamais codés en dur).
- Les rapports de taxes se calculent depuis le grand livre.

## Tests exigés
- Tests de propriétés : écritures aléatoires ⇒ la balance de vérification reste à zéro.
- Tests de non-régression pour chaque rapport.
- Tests d'isolation entre entreprises.

Voir [[Architecture]].
