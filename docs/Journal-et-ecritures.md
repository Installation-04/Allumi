# Journal et écritures

Le **journal** est la liste de toutes les écritures de l'entreprise, la balance de vérification en est le résumé par compte. Écrans : **Journal** (`/c/<entreprise>/journal`) et **Balance de vérification** (`/c/<entreprise>/balance`).

## Sur téléphone

Ouvre la même adresse HTTPS que sur ordinateur dans le navigateur du téléphone. Les lignes de saisie s’empilent sur un petit écran, avec leurs libellés et le clavier décimal pour les montants. Les totaux et les erreurs restent visibles sous les lignes. Les tableaux de consultation se font défiler horizontalement si nécessaire. Une connexion au serveur est requise; la saisie hors ligne n’est pas prise en charge.

## Une écriture
Une écriture a une **date**, une description facultative et **au moins deux lignes**. Chaque ligne porte sur un compte ([[Plan-comptable]]) et inscrit un montant au **débit** ou au **crédit**, jamais aux deux. La somme des débits doit égaler la somme des crédits : l'écran affiche l'écart en direct et n'enregistre pas une écriture déséquilibrée.

Limites : 500 lignes par écriture, deux décimales au plus, 1 000 000 000 000,00 $ par ligne. Les montants sont gardés en cents entiers, jamais en nombres à virgule.

À l'enregistrement, l'écriture reçoit le prochain numéro de la suite de l'entreprise (`J-00001`, `J-00002`…). La suite n'a **aucun trou** : si deux personnes enregistrent en même temps, elles reçoivent deux numéros distincts qui se suivent, et une écriture refusée ne consomme aucun numéro.

## Écritures manuelles et soldes d'ouverture
Le formulaire **Nouvelle écriture** crée deux sortes d'écritures :
- l'**écriture manuelle** (ajustement, amortissement, correction…);
- les **soldes d'ouverture** : à la reprise d'une comptabilité commencée ailleurs, saisis le solde de chaque compte à la date de départ et équilibre avec « Capitaux propres – soldes d'ouverture ». Les clients et fournisseurs ouverts passent par des factures d'ouverture (phase 4), car leurs comptes sont des comptes de contrôle.

Une écriture manuelle ne peut pas utiliser les comptes **clients**, **fournisseurs** ni de **taxes de vente**, ni un compte désactivé : ces comptes ne s'alimentent que par les documents et les paiements, avec leur contact ([[Regles-comptables]]).

Sa date doit tomber dans une **période ouverte** ([[Exercices-et-periodes]]). Sinon, l'écriture est refusée (`AL003`).

## Une écriture enregistrée ne se modifie pas
Ni la date, ni les lignes, ni les montants : l'application ne propose aucun bouton « Modifier », et la base de données refuse même le propriétaire de la base (`AL004`). On **contre-passe** :

1. Depuis la page de l'écriture, **Contre-passer**. Allumi crée une nouvelle écriture qui inscrit les mêmes montants du côté opposé, liée à l'originale.
2. La date de la contre-passation est celle du jour, mais jamais avant la date de l'écriture corrigée; tu peux en choisir une autre, dans une période ouverte.
3. Saisis ensuite l'écriture correcte.

Une écriture ne se contre-passe qu'une seule fois, et on ne contre-passe pas une contre-passation (`AL008`). Les écritures qui viennent d'un document ou d'un paiement (phase 4) se corrigent en **annulant la pièce**, pas à la main.

## Balance de vérification
La balance de vérification affiche, pour chaque compte, son **solde net** jusqu'à une date (par défaut, toutes les dates) : dans la colonne des débits si le compte est débiteur, dans celle des crédits s'il est créditeur. Un compte débité de 1 000,00 $ et crédité de 250,00 $ affiche donc 750,00 $ au débit. Elle confirme à l'écran que le total des débits égale celui des crédits et que l'équation comptable tient :

> Actif = Passif + Capitaux propres + (Produits − Charges)

Si l'un de ces deux voyants passait au rouge, ce serait un incident, pas un réglage : les contrôles de la base rendent l'état déséquilibré impossible. Le test à états de [[Plan-de-tests]] le vérifie sur des séquences aléatoires.

## Qui peut faire quoi
| Action | Propriétaire | Comptable | Lecture seule |
|---|---|---|---|
| Consulter le journal et la balance | oui | oui | oui |
| Enregistrer une écriture | oui | oui | non |
| Contre-passer | oui | oui | non |

Tout est consigné dans la [[Piste-d-audit]].

## Messages d'erreur de la base
Les règles comptables de la base portent un code stable (`AL001` écriture déséquilibrée, `AL002` moins de deux lignes, `AL003` période verrouillée, `AL004` écriture figée, `AL005` compte ou ligne non permis, `AL008` correction par annulation). L'interface les affiche en message clair; la liste complète est dans [[Schema-de-donnees]].

## Captures de référence

Voir [[References-visuelles]] pour les écrans sur ordinateur et téléphone, réalisés avec une entreprise fictive.
