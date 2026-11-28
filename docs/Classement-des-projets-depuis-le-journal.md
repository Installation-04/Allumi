# Classer une écriture par projet depuis le journal

Ouvre **Comptabilité → Journal**, puis une écriture. Si son originale contient au moins une ligne de revenu ou de charge, une section **Projet de l’écriture** indique le projet courant ou **Sans projet**. Le lien **Voir le projet** ouvre sa fiche.

## Choisir ou changer un projet

Avec **Comptabilité en écriture**, choisis **Classer par projet** ou **Modifier le classement**. Le numéro interne est repris automatiquement depuis l’écriture; aucune recopie n’est nécessaire.

1. Vérifie l’écriture, sa date, le classement actuel et les revenus/charges affichés.
2. Saisis **Code du projet destinataire**, par exemple `CHANTIER-01`. Il doit s’agir du code exact d’un projet actif de la même entreprise; les minuscules et espaces autour sont normalisés. Tu peux ouvrir le registre pour retrouver le code.
3. Clique **Revoir le projet**. La destination et le classement courant sont présentés séparément.
4. Vérifie le code et le nom de destination, coche la confirmation puis choisis **Confirmer le classement**.

Le retour au journal affiche le nouveau projet. Si l’écriture était déjà classée, le changement déplace son classement analytique entier; il ne répartit pas les lignes entre plusieurs projets. Une destination identique est signalée sans proposer une mutation inutile. Les codes invalides, inconnus ou archivés sont refusés; le code saisi reste visible.

## Détacher et gérer les actions simultanées

Depuis **Classement actuel**, coche la confirmation puis **Détacher cette écriture**. Le retour affiche **Sans projet**. Le projet et l’écriture sont conservés; la révision et l’audit du classement restent en base. Un classement existant dans un projet archivé peut encore être retiré.

Si une autre personne a modifié le classement depuis ton aperçu, la confirmation est refusée. Le code de destination reste dans le formulaire; recharge la page, revois le classement actuel et renouvelle la confirmation. La destination et la révision revues sont liées à l’action : modifier seulement le champ sans demander un nouvel aperçu ne change pas silencieusement le projet confirmé.

Après une modification réussie, les vues de l’entreprise sont invalidées pour relire le classement lors de la navigation. Une autre page déjà ouverte ne se rafraîchit pas en continu : recharge-la pour voir les changements récents.

## Contre-passations et droits

Une contre-passation affiche le projet actuel de son originale. **Voir l’écriture originale** et **Classer l’originale** ramènent à cette source; appeler directement l’écran de classement d’une contre-passation redirige aussi vers l’originale. Aucun classement indépendant de contre-passation n’est créé.

**Comptabilité lecture** permet de consulter le projet courant et l’héritage. **Comptabilité écriture** permet d’ouvrir le formulaire et de confirmer les changements. Le rôle lecture seule reste plafonné même avec une surcharge écriture. Aucun droit Contacts, Ventes, Taxes ou Audit supplémentaire n’est nécessaire. L’écran de classement ne renvoie pas de mémo, description de ligne ou coordonnée client; la fiche journal conserve son contenu et ses permissions habituels.

Les écritures uniquement de bilan n’affichent pas ce raccourci et leur écran de classement est indisponible. Les accès interentreprises et sans Comptabilité sont refusés.

## Effets et limites

Le classement est analytique et courant. Aucun montant, date, ligne, pièce validée ou état de période comptable n’est modifié. Les contre-passations suivent leur propre date dans la [[Contribution-financiere-des-projets]]. Un reclassement peut modifier un ancien rapport de gestion, même en période verrouillée, sans rouvrir celle-ci. Les avoirs distincts restent à classer séparément.

Le rapport conserve ses dates inclusives, ses totaux exacts, le CSV complet jusqu’à 5 000 écritures et l’impression jusqu’à 1 000. Il ne valorise pas les heures et ne calcule pas une marge complète. Voir aussi [[Projets-et-heures-liees]].

Cette amélioration réutilise le registre, les révisions, la RLS et les gardes existants. Aucune migration, dépendance ou variable nouvelle. Utilise la [[Mise-a-jour]] serveur habituelle; la publication ne modifie pas ton serveur. Les essais sur matériel Windows, Safari/iPhone et Proxmox restent distincts des parcours Chromium automatisés.

## Références visuelles

![Classement depuis le journal](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/classement-journal-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/classement-journal-mobile.png" alt="Classement depuis le journal sur téléphone" width="412">

![Journal project classification in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/classement-journal-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/classement-journal-en-dark-mobile.png" alt="Journal project classification on mobile in English" width="412">

Captures réelles de l’interface sur données fictives, avec le projet courant et une autre destination en cours de confirmation.
