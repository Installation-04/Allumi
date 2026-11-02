# Comparaison de l’état des résultats

Depuis **Rapports → État des résultats**, choisis **Comparer des périodes**. Ce parcours reste dans l’état des résultats, sans nouvel onglet de navigation. La consultation et le CSV exigent l’accès Comptabilité en lecture; les droits Ventes, Contacts et Taxes ne sont pas requis.

## Choisir les dates

La période étudiée reprend celle de l’état des résultats. Par défaut, la référence est la fenêtre immédiatement précédente avec le même nombre de jours. Ce n’est pas nécessairement le mois ou l’exercice précédent : une période de 31 jours peut commencer au milieu d’un mois pour sa référence.

Les quatre dates sont modifiables. Les jours de début et de fin sont inclus. Les périodes peuvent se chevaucher ou être identiques. Les durées ne sont pas normalisées : compare des plages pertinentes pour ton analyse. Des dates invalides ou inversées dans l’adresse sont remplacées par les valeurs par défaut. À la limite inférieure des dates supportées (1900), la référence reprend la période étudiée si aucune fenêtre antérieure valide n’est possible; choisis alors les dates manuellement.

## Lire les montants

Le tableau aligne les comptes par leur identité, y compris un compte présent dans une seule période ou devenu inactif. Les comptes dont le solde net est nul dans les deux périodes sont omis. Les noms et codes sont ceux de la configuration actuelle.

Les sections et sous-totaux sont ceux de l’état des résultats : produits d’exploitation, coût des ventes, bénéfice brut, charges d’exploitation, résultat d’exploitation, autres produits/charges et résultat net.

- **Écart** = montant de la période étudiée − montant de référence.
- **Variation (%)** = écart ÷ référence × 100, uniquement lorsque la référence est strictement positive.
- Un tiret apparaît si la référence est nulle ou négative. Le CSV laisse alors cette cellule vide.
- Le pourcentage est arrondi à deux décimales, les demis s’éloignant de zéro. Les montants restent en cents entiers.

Un écart positif n’est pas automatiquement favorable : une hausse des charges est aussi un écart positif. Les valeurs négatives, pertes et comptes de correction gardent leur signe.

Exemple fictif : résultat étudié 580,00 $, référence 975,00 $ → écart −395,00 $, variation −40,51 %.

## Source comptable

Les deux périodes et les libellés des comptes sont lus dans un même instantané du grand livre. Les écritures et contre-passations suivent leur date comptable. Un exercice clôturé reste consultable; cette page ne rouvre ni ne modifie aucune période et ne crée aucune écriture. Elle utilise le même calcul de résultat que l’état standard.

## CSV et téléphone

L’export contient les deux plages de dates, les comptes des deux périodes, les sous-totaux, écarts et pourcentages. Il conserve les montants exacts, neutralise les caractères de formule dans les textes et ne met pas le téléchargement en cache. Les pourcentages sont des nombres en pour cent (50,00 signifie 50 %), sans symbole; une référence non positive laisse une cellule vide.

Le fichier utilise UTF-8 avec BOM, des points-virgules et virgules décimales en français, des virgules et points décimaux en anglais. Sur téléphone, fais défiler le tableau horizontalement pour lire toutes les colonnes.

Voir [[Etats-financiers]], [[Grand-livre]], [[Exercices-et-periodes]] et [[Regles-comptables]].

## Captures

![Résultats comparatifs — ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/resultats-comparatifs-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/resultats-comparatifs-mobile.png" alt="Résultats comparatifs — téléphone" width="412">

La commande **Imprimer / PDF** conserve les colonnes en paysage sur papier : [[Impression-des-etats-financiers]].
