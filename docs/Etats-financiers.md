# États financiers : état des résultats et bilan

Deux rapports calculés **à chaque ouverture** depuis le journal, sans copie ni cache : ils reflètent toujours les écritures validées. Tous les membres de l'entreprise qui peuvent lire le journal (propriétaires, comptables, lecture seule) les consultent et les exportent. Ils se trouvent sous **Rapports** (et sous **Comptabilité**) : `/c/<entreprise>/resultats` et `/c/<entreprise>/bilan`.

Ils s'ajoutent à la **balance de vérification** ([[Journal-et-ecritures]]). Le grand livre ([[Grand-livre]]) et l'âge des comptes clients ([[Age-des-comptes]]) sont disponibles; le sommaire des taxes et les PDF suivent ([[Feuille-de-route]]).

## État des résultats

Les **revenus moins les charges** d'une **période** : du jour au jour **inclus**. Par défaut, l'exercice en cours jusqu'à aujourd'hui; les **exercices** de l'entreprise sont proposés en un clic, et on peut choisir deux dates.

Les sections suivent le **sous-type** des comptes ([[Plan-comptable]]) :

| Ligne | Comptes |
|---|---|
| Revenus d'exploitation | revenus d'exploitation |
| − Coût des marchandises vendues | coût des ventes |
| **= Bénéfice brut** | |
| − Charges d'exploitation | charges d'exploitation |
| **= Bénéfice d'exploitation** | |
| + Autres revenus | autres revenus (intérêts reçus…) |
| − Autres charges | autres charges (intérêts payés…) |
| **= Résultat net** | |

Chaque compte est affiché dans **son sens normal** (un revenu est positif quand il est crédité); un remboursement plus grand que les ventes, ou une perte, donne un montant **négatif**. Les comptes dont le total sur la période est nul n'y figurent pas.

## Bilan

La **situation** de l'entreprise à un jour, d'après tout le journal jusqu'à ce jour :

- **Actif** : à court terme (banque, caisse, comptes clients, autres actifs courants, taxes à recevoir), immobilisations, autres actifs;
- **Passif** : à court terme (carte de crédit, comptes fournisseurs, taxes à payer, autres passifs courants), à long terme;
- **Capitaux propres** : les comptes de capitaux propres, **plus les résultats**.

Allumi ne passe **pas d'écriture de clôture** à la fin d'un exercice : les revenus et les charges s'accumulent d'une année à l'autre. Le bilan ajoute donc aux capitaux propres ce qu'ils ont rapporté, en deux lignes : le **résultat des exercices précédents** (le résultat net cumulé jusqu'à la veille du début de l'exercice où tombe le jour choisi) et le **résultat de l'exercice en cours** (depuis son début). Si le jour choisi tombe dans aucun exercice, une seule ligne : **résultats cumulés**.

La page confirme que **l'actif égale le passif plus les capitaux propres**. C'est vrai pour tout grand livre sain (les écritures sont équilibrées, validées par le domaine et la base); si ce message disparaissait, ce serait un **incident à signaler**.

## Exporter en CSV

Chaque rapport s'exporte avec **Exporter en CSV** :

- **UTF-8 avec marque d'ordre des octets** : Excel affiche correctement les accents;
- le **séparateur et la virgule décimale suivent la langue** de l'interface : français = point-virgule et `1234,56`, anglais = virgule et `1234.56`. Les montants sont **exacts**, sans séparateur de milliers ni signe de dollar, donc lus comme des nombres;
- fins de ligne `CRLF` (RFC 4180), cellules entre guillemets au besoin;
- **protection contre l'injection de formule** : un nom de compte qui commencerait par `=`, `+`, `-`, `@` ou une tabulation est précédé d'une apostrophe, pour qu'un tableur ne l'exécute jamais comme une commande;
- le nom du fichier porte la période : `etat-des-resultats_2026-01-01_2026-12-31.csv`, `bilan_2026-12-31.csv`. Rien n'est mis en cache (`no-store`).

## Ce qui n'est pas inclus

Ventilation par projet ou par contact, notes aux états et PDF généré par le serveur : à venir. L’impression et l’enregistrement PDF via le navigateur sont disponibles : [[Impression-des-etats-financiers]]. La comparaison de deux périodes de résultats est disponible : [[Comparaison-des-resultats]]. Une adresse avec des dates invalides n'est pas une erreur : la page revient à la période ou au jour par défaut.

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![État des résultats](images/rapport-resultats-desktop.png)
![Bilan](images/rapport-bilan-desktop.png)
![État des résultats sur téléphone](images/rapport-resultats-mobile.png)

## Comparer les rapports

Depuis l’état des résultats, le lien **Comparer des périodes** ouvre les montants des deux plages, leurs écarts et un CSV bilingue. Voir [[Comparaison-des-resultats]] pour les règles de pourcentage et de dates. Depuis le bilan, **Comparer deux dates** ouvre les soldes, écarts et contrôles aux deux dates : [[Comparaison-des-bilans]].
