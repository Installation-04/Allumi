# Impression et PDF du carnet de kilométrage

Depuis [[Carnet-de-kilometrage]], applique les filtres puis ouvre **Impression / PDF complet**. La copie reprend l’entreprise, la période inclusive, le véhicule recherché et l’usage, les totaux professionnels/personnels/globaux et tous les trajets correspondants, même depuis la page 2 ou suivante.

## Imprimer une copie complète

1. Vérifie les filtres du carnet et ouvre la copie.
2. Vérifie les trajets et les totaux relus à cette ouverture. Une modification faite par un autre membre peut donc apparaître depuis la liste précédente.
3. Clique **Imprimer / PDF**, puis choisis l’imprimante ou l’enregistrement PDF dans la boîte du navigateur. Désactive les en-têtes/pieds de page du navigateur pour omettre l’adresse de la page.
4. **Retour au carnet** conserve les filtres et la page d’origine.

La copie est limitée à **1 000 trajets**. Au-delà, le lien du carnet disparaît et un accès direct affiche une demande de réduire les filtres, sans tableau ni commande d’impression. Aucune copie tronquée n’est produite. Le CSV conserve sa limite distincte de 5 000 trajets. Une recherche sans résultat peut être imprimée avec ses totaux à zéro; des filtres invalides ou répétés sont refusés.

Les distances restent en kilomètres avec **trois décimales exactes**, indépendamment des montants comptables. Date, véhicule, usage, départ, arrivée, motif et distance figurent dans le tableau. Le motif facultatif vide est indiqué par un tiret. Tous les totaux et les lignes proviennent du même instantané de lecture.

## Papier, accès et confidentialité

Le papier utilise une présentation **paysage claire**, même depuis le thème sombre ou le mobile. Les en-têtes du tableau se répètent sur les pages et les textes longs reviennent à la ligne. La navigation, les filtres, les commandes, les liens de modification et le pied de page applicatif sont retirés du papier.

La copie exige **Comptabilité en lecture**, sans accès Contacts, Ventes ou Taxes. Le rôle lecture seule peut l’utiliser même si une surcharge demande l’écriture; l’absence de Comptabilité refuse l’accès. L’appartenance à l’entreprise et les permissions sont revérifiées à chaque ouverture. Voir [[Utilisateurs-et-permissions]].

Comme le carnet, la copie est **partagée** avec les lecteurs autorisés : les trajets personnels et les motifs y sont inclus s’ils correspondent aux filtres. Vérifie le document avant de le partager. Les réponses sont privées et sans cache. Aucun PDF n’est conservé côté serveur : le navigateur imprime les valeurs affichées, sans nouvel enregistrement ni recalcul lors du clic. Une nouvelle ouverture relit les données.

Cette copie n’effectue aucun calcul d’indemnité, de déduction fiscale ou de mouvement comptable. Elle ne contient pas de commande de création, modification ou suppression.

## Références visuelles

![Copie française sur papier paysage](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-impression-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-impression-mobile.png" alt="Commandes d’impression du carnet sur téléphone" width="412">

![English print copy opened from dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-impression-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-impression-en-dark-mobile.png" alt="Mileage print controls on mobile in dark theme" width="412">
