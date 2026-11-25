# Impression et PDF des budgets

Depuis un [[Budgets-annuels]] ou le [[Budgets-mensuels]], clique **Impression / PDF complet**, puis **Imprimer / PDF**. Dans la fenêtre du navigateur, choisis une imprimante ou **Enregistrer en PDF**. Sur téléphone, utilise les options d’impression ou de partage proposées par le navigateur.

## Contenu de la copie

La copie annuelle présente le nom de l’entreprise, la devise CAD, le scénario, les dates inclusives de l’exercice, la révision des objectifs et tous les comptes du rapport. Les revenus/charges, objectifs définis, réel comptabilisé, écarts et comptes inactifs restent visibles. Une valeur non définie reste distincte de zéro.

La copie mensuelle conserve **la période fiscale affichée** : numéro, dates exactes, objectif de la période, réel et écart. Chaque compte reprend aussi son objectif annuel et l’état d’allocation : nombre de périodes définies, montant restant à répartir et répartition complète lorsqu’elle l’est. Le rapport n’invente aucune répartition et ne calcule pas de cumul à ce jour.

Les avertissements des rapports d’origine sont repris. Les totaux d’objectifs comprennent seulement les montants définis; un compte ayant du réel sans objectif est signalé. **Écart = réel − objectif**; le même signe n’a pas la même signification pour un revenu et une charge. Les données et règles restent celles des rapports annuel/mensuel, sans calcul financier supplémentaire.

## Lecture, impression et limites

Les données sont **relues dans un nouvel instantané SQL à l’ouverture** de la copie. Le bouton d’impression utilise ensuite les valeurs déjà affichées. Une modification concurrente peut donc changer une nouvelle ouverture, mais ne modifie pas le document ouvert. La révision identifie les objectifs; elle ne fige pas l’activité comptabilisée. Aucun PDF n’est conservé sur le serveur.

La copie contient toutes les lignes autorisées, jusqu’au plafond de **1 000 comptes** des services de rapport. Au-delà, une erreur remplace le document : aucune copie partielle ni commande d’impression n’est proposée. Pour le mensuel, les douze périodes de l’exercice doivent être cohérentes; une période inconnue, vide ou répétée dans l’adresse est refusée sur la page, le CSV et la copie.

Les deux copies s’impriment en **paysage clair**, même depuis le thème sombre ou une fenêtre mobile. Les en-têtes du tableau se répètent sur les pages. La navigation, les formulaires et les commandes de modification sont retirés du papier. Les noms longs et les montants restent contenus dans leurs colonnes. Les captures ci-dessous montrent des extraits; le PDF comprend toutes les lignes du rapport.

**Retour au budget** revient à la page annuelle ou à la période mensuelle choisie. Le CSV reste disponible depuis le rapport d’origine. Ce parcours demande uniquement **Comptabilité en lecture**; aucun accès Ventes, Contacts, Taxes ou écriture budgétaire n’est nécessaire. Les accès sont revérifiés à chaque ouverture, les réponses sont privées et sans cache, et aucune écriture, affectation ou opération de budget n’est déclenchée. Les descriptions de comptes et notes privées des écritures ne sont pas reprises.

## Références visuelles

![Extrait de la copie annuelle en français](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/budget-annuel-impression-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/budget-annuel-impression-mobile.png" alt="Ouverture de la copie annuelle sur mobile" width="412">

![Excerpt of the monthly print copy opened from English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/budget-mensuel-impression-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/budget-mensuel-impression-en-dark-mobile.png" alt="Monthly print copy controls on mobile, English dark theme" width="412">
