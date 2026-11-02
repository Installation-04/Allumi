# Comparaison des bilans

Depuis **Rapports → Bilan**, choisis **Comparer deux dates**. La consultation et le CSV exigent l’accès Comptabilité en lecture. Aucun nouvel onglet de navigation ni aucune écriture comptable ne sont ajoutés.

## Choisir les dates

La date étudiée reprend celle du bilan. La référence proposée est le même jour de l’année précédente; le 29 février devient le 28 février lorsque nécessaire. Les deux dates restent modifiables, peuvent être identiques ou dans n’importe quel ordre. À la limite inférieure des dates supportées (1900), la référence reprend la date étudiée.

Les soldes sont cumulatifs, du début de l’historique jusqu’à chaque date incluse. Il ne s’agit pas des mouvements entre ces deux dates. Une date invalide dans l’adresse est remplacée par la valeur par défaut.

## Lire les montants

Le tableau reprend l’actif, le passif et les capitaux propres du bilan standard. Il aligne les comptes par identité, conserve les comptes inactifs et ceux présents à une seule date. Un solde nul aux deux dates est omis. Les codes et noms sont ceux de la configuration actuelle.

- **Écart** = solde étudié − solde de référence.
- **Variation (%)** = écart ÷ référence × 100, uniquement lorsque la référence est strictement positive.
- Une référence nulle ou négative produit un tiret dans l’interface et une cellule vide dans le CSV.
- Les pourcentages sont arrondis à deux décimales, les demis s’éloignant de zéro; les montants restent en cents entiers.

Une hausse du passif produit aussi un écart positif : le signe n’indique pas à lui seul une amélioration.

## Exercices et équilibre

Chaque colonne utilise l’exercice correspondant à sa propre date. Les résultats antérieurs précèdent le début de cet exercice; le résultat courant couvre son début jusqu’à la date choisie. Le début d’exercice est affiché pour chaque colonne. Sans exercice correspondant, les résultats cumulés restent dans le résultat courant, comme dans le bilan standard, avec une explication visible.

Au changement d’exercice sans mouvement, le résultat courant passe dans les résultats antérieurs sans modifier le total des capitaux propres. Les exercices clôturés restent consultables. Les contre-passations suivent leur date comptable; aucune période n’est rouverte.

Les deux colonnes, les exercices et les libellés sont lus dans un même instantané du grand livre. Chaque bilan possède son propre contrôle **actif = passif + capitaux propres**. La dernière ligne affiche l’écart d’équilibre aux deux dates; un écart ne provoque aucun ajustement automatique.

## Export et téléphone

Le CSV contient les deux dates, les débuts d’exercice, comptes, sous-totaux, résultats et contrôles. Les pourcentages sont des nombres en pour cent, sans symbole (50,00 signifie 50 %). Les textes pouvant devenir des formules sont neutralisés.

Le fichier utilise UTF-8 avec BOM, des points-virgules et virgules décimales en français, des virgules et points décimaux en anglais. Le téléchargement reste privé et sans cache. Sur téléphone, fais défiler le tableau horizontalement pour lire toutes les colonnes; le reste de la page reste à la largeur de l’écran.

Voir [[Etats-financiers]], [[Comparaison-des-resultats]], [[Exercices-et-periodes]] et [[Regles-comptables]].

## Captures

![Bilans comparatifs — ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/bilans-comparatifs-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/bilans-comparatifs-mobile.png" alt="Bilans comparatifs — téléphone" width="412">
