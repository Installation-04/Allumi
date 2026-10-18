# Piste d'audit

La piste d'audit répond à « qui a fait quoi, quand, et qu'est-ce qui a changé ». Écran : **Piste d'audit** (`/c/<entreprise>/audit`), visible du **propriétaire** et du **comptable** seulement.

## Ce qui est consigné
- **Chaque création, modification ou suppression** d'une ligne d'une table d'affaires (comptes, exercices, périodes, écritures, lignes…) : l'action (`row.insert`, `row.update`, `row.delete`), la table, l'identifiant, les valeurs **avant et après**, l'acteur et l'heure. La consignation est faite par des **déclencheurs de la base**, donc elle ne dépend pas du code de l'application et ne peut pas être oubliée.
- **Des événements** de plus haut niveau, écrits par l'application : réouverture d'une période (`period.reopen`) ou d'un exercice (`fiscal_year.reopen`) avec le motif, fermeture d'un exercice (`fiscal_year.close`).
- Les événements de **sécurité du compte** (connexion, échec de connexion, activation de la 2FA, code de récupération utilisé; voir [[Authentification]]) sont inscrits eux aussi, mais ils appartiennent à la personne et non à une entreprise : l'écran d'audit d'une entreprise ne les affiche pas.
- Jamais de **secret** : mots de passe, secrets 2FA et jetons n'y sont pas copiés.

## Garanties
- **Ajout seulement** : l'application ne peut ni modifier ni supprimer une ligne d'audit (privilèges et déclencheurs); la seule exception est le caviardage de la Loi 25, décrit plus bas.
- L'acteur est celui de la session de la base de données, pas une valeur envoyée par le navigateur.
- Le propriétaire de l'entreprise peut **caviarder** les renseignements personnels (courriel, téléphone) d'une personne qui exerce ses droits à la vie privée (Loi 25); l'opération est elle-même journalisée et ne touche jamais aux champs comptables ([[Securite-et-Loi-25]]).

## Consulter
L'écran liste les entrées de la plus récente à la plus ancienne, 50 à la fois, avec un lien « Plus anciens ». On peut filtrer par type d'objet ou par début d'action (`period.`, `row.insert`…). Pour une période rouverte, l'entrée `period.reopen` affiche le motif donné.

Voir aussi : [[Regles-comptables]] (piste d'audit), [[Schema-de-donnees]] (table `audit_log`).
