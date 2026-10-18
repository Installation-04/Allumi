# Taxes

Allumi traite les taxes de vente (TPS, TVQ, TVH…) comme des **données datées**, pas comme des constantes. Écran : **Taxes** (`/c/<entreprise>/taxes`).

> Vérifie toujours les taux et les règles auprès de Revenu Québec et de l'Agence du revenu du Canada : Allumi ne remplace pas un comptable.

## Installer les taxes du Québec
Sur une entreprise sans taxe, le bouton **Installer la TPS et la TVQ** crée :
- la **TPS** à 5 % (en vigueur depuis le 1er janvier 2008) et la **TVQ** à 9,975 % (depuis le 1er janvier 2013, calculée sur le prix avant TPS : il n'y a plus de taxe sur la taxe);
- leurs comptes dans le plan comptable de départ (TPS à payer 2100, TPS à recevoir 1200, TVQ à payer 2110, TVQ à recevoir 1210), ou de nouveaux comptes sur le code suivant si ces codes ont été changés;
- les codes **TPS-TVQ**, **TPS** (seulement), **DETAXE**, **EXONERE** et **HORS-CHAMP**.

L'opération ne fait qu'ajouter ce qui manque : on peut la relancer sans risque. Les taux antérieurs à ces dates ne sont pas installés; les documents datés avant n'auront donc pas de taux.

## Une taxe
Une taxe a un **code** (lettres majuscules, chiffres, tiret), un nom français et anglais, un **compte à payer** (passif) et, si elle est récupérable sur les achats, un **compte à recevoir** (actif : crédits de taxe sur les intrants et remboursements de taxe sur les intrants). Quand on la crée, ses comptes se créent avec elle. Son numéro d'inscription (facultatif) peut s'imprimer sur les documents.

### Les taux
Chaque taxe a un **historique de taux**, chacun avec une date de début; le taux en vigueur un jour donné est unique (la base de données refuse deux taux qui se chevauchent). **Ajouter un taux** le fait commencer à une date : le taux en vigueur se termine la veille. L'historique ne s'étend que par la fin : on ne récrit pas le passé. Un taux s'écrit en pourcentage, jusqu'à quatre décimales (9,975).

Le taux appliqué est **copié sur chaque document** à sa validation : changer un taux ne change aucun document déjà écrit, ni les rapports des périodes passées.

## Les codes de taxe
Un **code de taxe** se met sur une ligne de facture ou de dépense et dit ce qui s'applique :

| Traitement | Taxes | Sens |
|---|---|---|
| Taxable | une ou plusieurs | la taxe s'ajoute (ex. TPS + TVQ) |
| Détaxé | aucune | taux de 0 %, mais déclaré |
| Exonéré | aucune | ni taxe ni crédit |
| Hors champ | aucune | en dehors du régime |

La base de données impose la règle : un code taxable a au moins une taxe, les autres n'en ont aucune. Un code ne change pas de sens après sa création (son nom et sa disponibilité, oui) : pour une autre combinaison, crée un autre code.

## Comment les taxes se calculent
Les montants sont des cents entiers; le taux a six décimales. Une seule fonction d'arrondi, au cent, **demi s'éloignant de zéro**, la même que celle de PostgreSQL (`round(numeric)`), ce qui permet à la base de **recalculer et vérifier** les taxes d'une facture à sa validation.

Deux modes, au choix de l'entreprise ([[Entreprise]]) et copiés sur chaque document :
- **par ligne** : chaque ligne est taxée et arrondie, puis on additionne;
- **sur le total** : on additionne les lignes taxables de chaque taxe, puis on arrondit une fois.

Exemple, 100,00 $ à TPS 5 % et TVQ 9,975 % : TPS 5,00 $, TVQ 9,975 → **9,98 $**. Trois lignes de 0,10 $ à 5 % : 0,01 $ par ligne (total 0,03 $) ou 0,015 → 0,02 $ sur le total. L'écart entre les deux modes ne dépasse jamais (n + 1) / 2 cents pour n lignes (propriété P6 de [[Plan-de-tests]]).

Voir aussi : [[Regles-comptables]] (taxes), [[Contacts]], [[Produits-et-services]], [[Schema-de-donnees]] (tables `tax`, `tax_rate`, `tax_code`).
