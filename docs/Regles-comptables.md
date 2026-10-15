# Règles comptables

Ces règles sont non négociables : toute contribution qui les contourne est refusée.

## Montants
- Entiers (cents) ou `Decimal`. **Jamais de float.**
- Arrondi explicite et documenté (une seule fonction centrale) : au cent, **demi s'éloignant de zéro** (0,005 → 0,01; −0,005 → −0,01). C'est aussi le comportement de `round(numeric)` dans PostgreSQL, ce qui permet à la base de vérifier les montants de ligne.
- Taxes : calcul par ligne ou par document selon une règle configurable, jamais implicite.

## Partie double
- Chaque écriture a au moins deux lignes; la somme des débits = la somme des crédits.
- Validé dans l'application **et** en base (contrainte/trigger).
- Les comptes clients et fournisseurs (comptes de contrôle) ne reçoivent que des écritures issues de documents et de paiements, toujours avec un contact : l'âge des comptes concilie avec le grand livre.

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

Le détail de l'application de ces règles en base (contraintes, triggers, codes d'erreur) est dans [[Schema-de-donnees]]; les tests qui les protègent sont dans [[Plan-de-tests]].

Voir [[Architecture]].
