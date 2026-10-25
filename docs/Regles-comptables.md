# Règles comptables

Ces règles sont non négociables : toute contribution qui les contourne est refusée.

## Montants
- Entiers (cents) ou `Decimal`. **Jamais de float.**
- Arrondi explicite et documenté (une seule fonction centrale) : au cent, **demi s'éloignant de zéro** (0,005 → 0,01; −0,005 → −0,01). C'est aussi le comportement de `round(numeric)` dans PostgreSQL, ce qui permet à la base de vérifier les montants de ligne.
- Taxes : calcul par ligne ou par document selon une règle configurable, jamais implicite.

## Partie double
- Chaque écriture a au moins deux lignes; la somme des débits = la somme des crédits.
- Validé dans l'application **et** en base (contrainte/trigger).
- Une écriture **manuelle** ([[Journal-et-ecritures]]) refuse aussi les comptes de taxes de vente et les comptes désactivés; elle porte la source `MANUAL` ou `OPENING_BALANCE`, et seules ces écritures se contre-passent à la main (les autres s'annulent avec leur pièce).
- Les comptes clients et fournisseurs (comptes de contrôle) ne reçoivent que des écritures issues de documents et de paiements, toujours avec un contact. La base vérifie que l'écriture d'une pièce existe pour cette pièce et que ses montants sur les comptes de contrôle égalent le total de la pièce : l'âge des comptes concilie toujours avec le grand livre.

## Immuabilité
- Une écriture validée ne se modifie ni ne se supprime.
- Correction par **contre-passation** (écriture inverse) puis nouvelle écriture.

## Piste d'audit
- Qui, quoi, quand, valeurs avant/après pour toute création ou modification.
- Les journaux d'audit eux-mêmes sont en ajout seulement.

## Dates
- Un document a deux dates : celle de la pièce (échéance, âge des comptes) et sa **date comptable** (celle de l'écriture). Une facture fournisseur reçue après la fermeture de sa période se comptabilise à la date d'aujourd'hui, sans fausser la date inscrite sur la pièce.
- Les affectations de paiements et d'avoirs portent une date d'effet et ne s'effacent jamais : on les retire à une date, dans une période ouverte. L'âge des comptes à une date passée reste reproductible.

- Les transactions importées d'un service externe ([[Integrations]]) ne créent **aucune écriture** : elles alimentent seulement la boîte de réception bancaire. Leur montant est l'effet net sur le solde du service (`brut − frais`), dans leur devise, sans conversion de change; une ligne importée ne change plus que de statut.

## Périodes
- Une période fermée refuse toute nouvelle écriture.
- La réouverture est une action privilégiée et auditée : propriétaire seulement, avec la vérification en deux étapes active et un code saisi à ce moment, un motif écrit d'au moins 10 caractères et un événement d'audit ([[Exercices-et-periodes]]). Ces conditions sont appliquées par l'application (la base garantit l'audit du changement, pas le 2FA).
- Un exercice se ferme quand toutes ses périodes sont verrouillées; tant qu'il est fermé, ses périodes ne changent pas d'état.

## Vie privée (Loi 25)
- La piste d'audit est en ajout seulement. Les renseignements personnels (courriel, téléphone, nom d'un contact anonymisé) peuvent en être caviardés par le propriétaire de l'entreprise; l'opération est elle-même journalisée et ne touche jamais aux champs comptables.
- Les secrets (mot de passe, secret 2FA) ne sont jamais copiés dans l'audit.

## Isolation
- Toute table de données comptables porte `company_id`.
- Aucune requête sans filtre d'entreprise; tests automatisés d'isolation.
- Le contexte d'entreprise est lié à l'adhésion de l'utilisateur dans la base de données : désigner une entreprise dont on n'est pas membre ne donne accès à rien.
- Un membre en lecture seule ne peut rien modifier, même par erreur de code.

## Taxes (TPS/TVQ)
- Taux configurables avec date d'effet (jamais codés en dur).
- Les rapports de taxes se calculent depuis le grand livre : chaque ligne d'un compte de taxes porte sa taxe et sa case de déclaration (perçue, récupérable, redressement, versement).
- Une déclaration produite est figée : aucune écriture ne peut plus être datée dans sa période.
- La base de données recalcule les taxes des ventes à la validation (lignes, codes, taux en vigueur à la date du document, mode d'arrondi figé).

## Tests exigés
- Tests de propriétés : écritures aléatoires ⇒ la balance de vérification reste à zéro.
- Tests de non-régression pour chaque rapport.
- Tests d'isolation entre entreprises.

Le détail de l'application de ces règles en base (contraintes, triggers, codes d'erreur) est dans [[Schema-de-donnees]]; les tests qui les protègent sont dans [[Plan-de-tests]].

Voir [[Architecture]].
