# Choisir un client existant pour un contrat

Dans **Ventes → Contrats et liens clients**, ouvre **Nouveau contrat**, une copie ou la modification d’un brouillon de contrat. Le bloc **Choisir un client existant** permet de reprendre le nom et le courriel d’un client du répertoire avant de les vérifier et d’enregistrer.

## Rechercher puis choisir

1. Saisis entre **2 et 100 caractères** dans **Nom ou courriel à rechercher**. La recherche couvre le nom affiché, le nom légal et le courriel des clients actifs de l’entreprise.
2. Clique **Rechercher un client**, ou appuie sur **Entrée** dans ce champ. Cette touche lance la recherche sans enregistrer le contrat.
3. Relis les résultats et clique **Utiliser NOM** pour remplacer le nom et le courriel du contrat.
4. Vérifie ou modifie ces deux champs, puis termine les autres champs et clique **Enregistrer**.

La recherche est insensible à la casse. `%`, `_` et `\` restent des caractères littéraux, pas des jokers. Les caractères de contrôle et les paramètres de recherche invalides sont refusés.

Seuls les **clients actifs** sont proposés, y compris les contacts à la fois clients et fournisseurs. Les fournisseurs seuls, contacts archivés et contacts anonymisés sont exclus. Au-delà de **20 résultats**, un message demande de préciser la recherche pour retrouver les autres; les résultats ont un ordre stable par nom puis référence.

Un client sans courriel peut être choisi. Le champ Courriel du client est alors vidé et doit être complété avant l’enregistrement. L’ancienne adresse d’un autre destinataire n’est pas conservée silencieusement.

## Ce qui est prérempli

La sélection remplace **uniquement le nom et le courriel**. Elle conserve le titre, les conditions et leurs variables, le tarif horaire et la langue du contrat. La langue du contact ne change pas automatiquement celle du contrat et les conditions ne sont pas traduites. L’aperçu suit le nouveau nom aux occurrences de `{{client_name}}`; les noms écrits littéralement dans le texte restent à revoir manuellement.

Les champs restent modifiables. Les validations habituelles de nom, courriel, variables et tarif s’appliquent à Enregistrer; une erreur ne doit pas effacer les valeurs saisies. Aucune adresse, note interne, inscription fiscale ou pièce jointe du contact n’est reprise par le sélecteur.

Il s’agit d’une **copie de valeurs pour revue**, sans liaison permanente au répertoire. Modifier, archiver ou anonymiser le contact plus tard ne synchronise pas automatiquement le contrat. Modifier les champs du contrat ne change pas la fiche Contact. Un texte déjà publié reste immuable; utilise [[Duplication-des-contrats]] pour préparer un nouveau contrat indépendant.

## Saisie manuelle et permissions

Le sélecteur est facultatif. Avec **Ventes en écriture** et **Contacts en lecture**, il apparaît dans les éditeurs de contrat. Sans Contacts en lecture, le bloc est absent et la recherche serveur est refusée; la création manuelle d’un contrat reste possible avec Ventes en écriture. Le rôle lecture seule ne peut pas utiliser les éditeurs, même avec une surcharge demandant l’écriture.

Le modèle partagé de conditions ne choisit pas de destinataire et ne contient pas ce sélecteur. La recherche ne crée ni ne modifie aucun contact ou document, ne publie pas de lien et n’envoie aucun courriel. Seule l’action Enregistrer crée ou modifie un brouillon. La publication et l’envoi restent séparés; voir [[Contrats-et-signatures]].

Une recherche ne remplace rien avant un choix explicite. Changer la recherche efface ses anciens résultats et annule la demande précédente; une réponse périmée ne doit pas remplacer les résultats actuels. En cas d’erreur réseau ou de perte d’accès, réessaie ou utilise les champs manuels. La recherche reste privée et sans cache, limitée à ton entreprise et à tes droits.

## Références visuelles

![Choisir un client du répertoire](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-client-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-client-mobile.png" alt="Choix d’un client sur téléphone" width="412">

![Existing client selection in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-client-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-client-en-dark-mobile.png" alt="Client selection on mobile in English" width="412">

Toutes les captures utilisent des données fictives.
