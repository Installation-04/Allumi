# Projets clients et heures liées

Ouvre **Projets → Registre de projets**. La liste propose une recherche littérale par code/nom, un état **Actif / Archivé / Tous les projets** et 50 projets par page. Les droits **Comptabilité** contrôlent lecture et écriture; le rôle lecture seule reste plafonné même avec une surcharge en écriture.

## Créer un projet

Choisis **Créer un projet**, puis renseigne :

- **Code du projet** : 1 à 30 lettres A–Z, chiffres, points, tirets ou traits de soulignement; les minuscules sont converties. Le code est unique dans l’entreprise et ne peut plus être modifié.
- **Nom du projet** : une ligne, jusqu’à 120 caractères.
- **Description courte** : facultative, une ligne, jusqu’à 500 caractères.
- **Client lié** : facultatif. Avec les droits Contacts en lecture, recherche un client actif par nom, puis sélectionne-le. Les résultats sont limités à 20; précise la recherche lorsque d’autres correspondent.

Le client doit appartenir à la même entreprise et ne pas être anonymisé. Son nom reste lu depuis Contacts : aucune copie de ses coordonnées n’est ajoutée au projet. Sans accès Contacts, ces données et la recherche sont masquées; tu peux gérer les autres champs et conserver une association existante, mais pas la changer. Un client devenu inactif reste une référence existante; il ne peut être choisi pour une nouvelle association.

Après un refus d’enregistrement, les champs et la sélection du client sont conservés. Deux modifications concurrentes ne s’écrasent pas : recharge une fiche périmée avant de réessayer.

## Rattacher les heures explicitement

Depuis la fiche, **Saisir des heures pour ce projet** préremplit le code. Dans le carnet, tu peux aussi renseigner **Code du projet enregistré** avec un code exact du registre. Aucun rapprochement approximatif par nom n’est effectué.

Au premier rattachement, le nom courant du projet est copié dans le libellé de la saisie. Un renommage ultérieur ne change pas les anciens libellés. De nouvelles heures utilisent le nouveau nom. Le code reste une référence stable pour retrouver toutes les heures liées, même après renommage ou archivage.

Sans code, **Projet ou dossier** reste un libellé libre obligatoire. Les anciennes saisies restent libres après la mise à jour; créer un projet de même nom ne les rattache pas. Pour détacher une saisie liée, vide son code et coche la confirmation : le libellé libre est conservé. Le remplacement par un autre code effectue un nouveau rattachement contrôlé.

**Consulter les heures liées** ouvre le carnet pour l’année courante avec le code filtré. Ajuste les dates pour consulter une autre période. Les filtres par code et par libellé se combinent; les totaux, CSV privé complet jusqu’à 5 000 saisies et [[Impression-du-temps]] jusqu’à 1 000 reprennent les mêmes critères. Dans les lignes liées, le code accompagne le libellé historique; les durées restent des minutes exactes / h:mm. Voir aussi [[Carnet-de-temps]].

## Archiver et réactiver

L’archivage exige une confirmation et une révision à jour. Il conserve les projets et leurs heures : aucune suppression de projet n’est proposée. Les heures déjà liées restent consultables et modifiables. Aucune nouvelle saisie ou nouvelle association d’heures ne peut viser un projet archivé; réactive-le explicitement d’abord. L’archivage est sérialisé avec le rattachement pour couvrir les actions simultanées.

Un projet archivé ne peut être renommé ou changer de client avant sa réactivation. Chaque création, modification, archivage, réactivation et changement des heures est audité. La consultation, les recherches et les exports ne créent pas de modification métier.

## Périmètre

Le registre organise les dossiers et leurs durées déclarées. Il ne crée ni facture, paiement, salaire ou écriture. Les personnes restent des libellés déclarés; chronomètre, contrôle des chevauchements ou du total quotidien par personne, approbation des heures, tarifs, coûts et rentabilité restent distincts. La relation client du projet est courante; elle ne constitue pas un historique de facturation.

La mise à jour ajoute le registre et une référence facultative aux heures. Aucune dépendance ou variable nouvelle, aucune conversion automatique des anciennes saisies. Les essais physiques Windows, Safari/iPhone et Proxmox restent à effectuer séparément.

## Références visuelles

![Projet lié à un client et aux heures](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/projets-lies-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/projets-lies-mobile.png" alt="Projet sur téléphone" width="412">

![Customer-linked project in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/projets-lies-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/projets-lies-en-dark-mobile.png" alt="Project on mobile in English" width="412">

Toutes les captures sont centrées sur la fiche et utilisent des données fictives, sur les formats ordinateur et mobile.
