# Exercices et périodes

Un **exercice financier** couvre douze mois consécutifs et se divise en **périodes mensuelles**. Une écriture ([[Journal-et-ecritures]]) doit être datée dans une période **ouverte**. Écran : **Exercices** (`/c/<entreprise>/exercices`).

## Création
- Le premier exercice se crée à l'initialisation de la comptabilité : celui qui contient la date du jour, selon le **premier mois de l'exercice** choisi à `/setup` (avril pour un exercice du 1er avril au 31 mars). Il est découpé en douze périodes.
- **Créer l'exercice suivant** crée l'exercice qui suit le dernier. Les exercices ne se chevauchent jamais (la base le refuse).
- Pour des soldes d'ouverture dans le passé, crée l'exercice qui contient la date voulue.

> Fuseau horaire : « aujourd'hui » se calcule à l'heure de Montréal (`America/Toronto`) pour toutes les entreprises. Un réglage par entreprise viendra plus tard.

## Verrouiller une période
**Verrouiller** une période refuse toute nouvelle écriture datée dans ses limites, y compris une contre-passation. Le propriétaire et le comptable peuvent verrouiller (et le font à la fin d'un mois, une fois les rapports transmis ou vérifiés).

## Fermer un exercice
**Fermer l'exercice** (propriétaire seulement) exige que ses douze périodes soient verrouillées et couvrent exactement l'exercice : la base de données le vérifie. Le résultat de l'exercice n'est pas viré automatiquement aux bénéfices non répartis à cette étape; il le sera avec les rapports financiers.

## Rouvrir : un geste privilégié
Rouvrir une période, ou un exercice fermé, rend le passé modifiable : il est donc protégé par quatre conditions cumulatives, vérifiées par l'application :

1. le rôle **propriétaire** (le comptable ne peut pas rouvrir);
2. la **vérification en deux étapes** activée sur le compte du propriétaire ([[Authentification]]);
3. un **motif écrit** d'au moins 10 caractères;
4. un événement dans la [[Piste-d-audit]] (`period.reopen` ou `fiscal_year.reopen`) qui consigne le motif, en plus de l'audit automatique du changement.

Un exercice fermé se rouvre avant ses périodes : tant qu'il est fermé, la base refuse de changer l'état d'une de ses périodes. Ces conditions sont appliquées par le service et testées; la base de données impose, elle, les règles structurelles (périodes d'un exercice fermé verrouillées, pas de chevauchement). Si tu accèdes à la base directement, c'est ta responsabilité de respecter les mêmes conditions : l'audit en gardera la trace.

## Qui peut faire quoi
| Action | Propriétaire | Comptable | Lecture seule |
|---|---|---|---|
| Consulter | oui | oui | oui |
| Créer un exercice, verrouiller une période | oui | oui | non |
| Fermer un exercice | oui | non | non |
| Rouvrir une période ou un exercice | oui (2FA + motif) | non | non |

Voir aussi : [[Regles-comptables]] (périodes), [[Schema-de-donnees]] (tables `fiscal_year` et `fiscal_period`).
