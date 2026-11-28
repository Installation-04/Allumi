# Contribution comptabilisée des projets

Depuis **Projets → Registre de projets**, ouvre une fiche puis **Contribution comptabilisée**. Le rapport additionne les lignes de revenus et de charges réellement comptabilisées des écritures classées dans ce projet. La contribution nette est la différence revenus moins charges, en cents exacts. Il s’agit d’une lecture de gestion selon le classement actuel.

## Classer une écriture

Avec **Comptabilité en écriture**, choisis **Préparer un classement**. Saisis le numéro interne numérique de l’écriture : par exemple `42` pour `J-00042`, sans préfixe; les zéros initiaux sont acceptés. Clique **Revoir l’écriture**, vérifie la date, les revenus, les charges et le classement actuel, puis coche la confirmation et valide.

Une écriture originale entière appartient à un seul projet. Elle doit contenir au moins une ligne de revenu ou de charge. Les écritures de bilan seules ne peuvent pas être classées. Le classement ne modifie ni le montant, ni la date, ni les lignes, ni la pièce validée. Il ne génère aucune facture, taxe, paie ou écriture.

Pour déplacer une écriture déjà classée, prépare son classement depuis la fiche du projet destinataire : l’aperçu indique le projet actuel avant confirmation. Depuis le projet courant, **Revoir le classement** propose **Détacher cette écriture**, avec confirmation. Le détachement conserve la révision et la piste d’audit; il ne supprime pas l’historique. Un aperçu périmé est refusé : recharge-le avant de confirmer.

Seuls les projets actifs acceptent de nouveaux classements. Un projet archivé conserve sa contribution et peut encore être détaché; réactive-le pour lui attribuer d’autres écritures. L’archivage et le rattachement sont sérialisés en base. Aucune association n’est déduite des noms, des clients ou des anciennes heures.

## Dates et corrections

Les dates **Du / Au**, inclusives, portent sur la date comptable de chaque écriture. La période ne peut pas dépasser 366 jours ni finir après aujourd’hui à Toronto. La première ouverture montre l’année courante; sélectionne une autre période si nécessaire.

Une contre-passation hérite du classement actuel de son originale, mais compte à sa propre date. Exemple : une vente de février contre-passée en mars contribue négativement au rapport de mars, même si l’originale est hors période. On classe l’originale, jamais sa contre-passation directement. Les avoirs/crédits émis comme pièces distinctes restent des originales à classer séparément; ils ne suivent pas automatiquement une facture.

Le classement est **courant**, pas reconstitué à une date historique. Reclasser une ancienne écriture peut donc changer un ancien rapport de projet, y compris pour une période comptable fermée. Cela ne rouvre pas cette période et ne change pas le grand livre, les taxes ou les états financiers. L’audit conserve les changements; il ne constitue pas une fonction de rapport analytique « tel qu’à la date ».

## Consulter, exporter et imprimer

La liste affiche 50 écritures par page. Les totaux portent sur toute la période, avec les mêmes données que les lignes dans un instantané SQL. Chaque ligne donne sa date, son numéro, son originale, ses revenus/charges et sa contribution; les contre-passations sont identifiées. Le lien d’écriture ouvre le journal selon ses permissions habituelles.

- **Exporter le CSV complet** : toutes les lignes filtrées, jusqu’à 5 000 écritures, métadonnées du projet/période et totaux. CSV privé sans cache, UTF-8 avec BOM, montants signés exacts; séparateur point-virgule et virgule décimale en français, virgule et point décimal en anglais. Les noms sont protégés contre l’interprétation comme formules.
- **Impression / PDF complet** : toutes les lignes filtrées jusqu’à 1 000 écritures, papier paysage clair, en-têtes répétés et commandes masquées. Utilise l’impression ou l’enregistrement PDF du navigateur. Le retour conserve les dates et la page d’origine.

Au-delà d’un plafond, aucune copie partielle n’est présentée comme complète : réduis la période. L’ouverture/rechargement relit les données; une page déjà ouverte n’est pas actualisée en continu.

## Accès et limites

**Comptabilité en lecture** suffit pour consulter, exporter et imprimer. Les changements demandent Comptabilité en écriture; le rôle lecture seule reste plafonné même avec une surcharge. Aucune permission Contacts, Ventes, Taxes ou Audit supplémentaire n’est nécessaire pour ce rapport. Les noms/coordonnées clients, mémos, descriptions des lignes et contenus des pièces n’y sont pas renvoyés. L’isolation par entreprise reste vérifiée en service et par RLS.

La contribution ne valorise pas les heures et ne représente pas une rentabilité complète : pas de tarifs/coûts de main-d’œuvre, budget de projet, ventilation d’une écriture entre projets, encaissements prévisionnels ou attribution automatique. Seuls les revenus et charges des écritures explicitement classées sont inclus. Voir [[Projets-et-heures-liees]] et [[Carnet-de-temps]].

La mise à jour ajoute une table de classement analytique et ses gardes, sans modification des écritures existantes, sans reprise automatique, dépendance ou variable nouvelle. Utilise la [[Mise-a-jour]] serveur habituelle. Aucun déploiement sur ton serveur n’est effectué par la publication; les essais physiques Windows, Safari/iPhone et Proxmox restent distincts.

## Références visuelles

![Contribution comptabilisée du projet](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contribution-projets-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contribution-projets-mobile.png" alt="Contribution du projet sur téléphone" width="412">

![Posted project contribution in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contribution-projets-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contribution-projets-en-dark-mobile.png" alt="Project contribution on mobile in English" width="412">

Captures réelles de l’interface, centrées sur le rapport et utilisant uniquement des données fictives.
