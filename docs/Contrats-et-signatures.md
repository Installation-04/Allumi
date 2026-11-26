# Contrats, liens clients et signatures

Dans **Ventes → Contrats et liens clients**, prépare des contrats avec tes conditions, partage des soumissions et factures existantes et consulte l’ouverture des documents et leurs signatures déclarées. Windows reste un client connecté au serveur; les données, modèles et preuves sont conservés sur le serveur Allumi.

## Conditions longues et tarif réutilisable

Ouvre **Modèle de conditions** et colle ton texte (jusqu’à **50 000 caractères**, avec paragraphes et sauts de ligne). Le texte est traité comme du texte simple, sans exécuter de HTML; la mise en forme Word n’est pas importée. Ce modèle partagé préremplit les nouveaux contrats. Le modifier ne change pas les contrats déjà créés ou publiés.

Les boutons d’insertion remplacent la sélection à l’endroit du curseur :

| Champ | Variable dans le texte | Résultat |
|---|---|---|
| Tarif horaire | `{{hourly_rate}}` | Montant à deux décimales avec CAD/h |
| Client | `{{client_name}}` | Nom saisi pour le contrat |
| Entreprise | `{{company_name}}` | Nom de l’entreprise |

Exemple de modèle :

```text
Contrat entre {{company_name}} et {{client_name}}.
Tarif horaire : {{hourly_rate}}.
Le même tarif de {{hourly_rate}} s’applique aux heures supplémentaires autorisées.
```

Remplace une première fois les anciens tarifs écrits en dur par la variable. Ensuite, modifier **Tarif horaire (CAD/h)** répercute le montant à **chaque occurrence de la variable** dans le document. La variable comprend déjà l’unité CAD/h. Les valeurs littérales du texte ne sont pas recherchées/remplacées arbitrairement.

Un tarif positif accepte la virgule ou le point, avec au plus deux décimales et sans séparateur de milliers; les cents restent exacts. Le tarif est facultatif si sa variable n’est pas utilisée. Les variables inconnues ou un tarif manquant sont refusés. Les champs restent saisis après une erreur.

Dans **Nouveau contrat**, indique le titre, le nom et le courriel du client, la langue du document et les conditions. L’aperçu se met à jour lors de la saisie. Enregistre le brouillon, vérifie le contenu, puis modifie-le au besoin avant publication. La langue contrôle les libellés, le tarif et le consentement; elle ne traduit pas automatiquement tes conditions.

Les [[Devis]] disposent aussi d’une zone de conditions longues et d’un tarif horaire pour ces variables. Les **prix des lignes comptables restent indépendants** : modifier le tarif des conditions ne change pas silencieusement les quantités, prix, taxes ou totaux. La modification d’un devis reste réservée au brouillon.

## Publier et envoyer un lien

1. Vérifie le contenu et le destinataire du brouillon.
2. Confirme **Publier le lien client**. Cette étape fige le texte, les parties et le tarif, ou copie les champs publics du document source. Elle crée un lien privé valable **90 jours**.
3. Copie le lien affiché pour le transmettre, ou confirme **Envoyer le lien par courriel** si le relais SMTP est configuré. Publier seul n’envoie aucun message.
4. Consulte le résultat du relais et actualise le suivi du document.

Le lien est une capacité d’accès : toute personne qui le possède peut consulter le document et, si autorisé, déclarer une signature. Le jeton est aléatoire, son empreinte sert à la recherche et sa copie récupérable est chiffrée en base pour les gestionnaires autorisés. Il n’est pas ajouté à la piste d’audit.

Le serveur doit être accessible au client à l’adresse **APP_URL** configurée. Une IP locale sur Proxmox fonctionne sur le réseau local ou via VPN. Pour des clients sur Internet, utilise une adresse HTTPS accessible et un certificat reconnu par leurs appareils; voir [[Configuration]] et [[Securite-et-Loi-25]]. Ce module n’expose pas automatiquement ton serveur sur Internet.

L’envoi utilise le SMTP déjà configuré, avec confirmation, historique des 20 tentatives récentes, identifiant de tentative contre les doubles clics, délai d’une minute entre renvois et maximum de 20 envois par jour pour le même lien. **Accepté par le relais** ne prouve ni la livraison dans la boîte du client ni la lecture. Un résultat incertain peut entraîner un doublon lors d’un renvoi confirmé. Voir [[Envoi-des-factures]] et [[Envoi-des-devis]].

## Soumissions et factures existantes

Depuis une soumission finalisée encore valide ou une facture validée non annulée, ouvre le panneau **Contrats et liens clients → Préparer un lien client**, vérifie le courriel et la langue, puis prépare et publie le partage.

La copie reprend en base les champs publics du document validé : parties, numéro, référence, dates, lignes, taxes et totaux. Elle inclut les conditions de la soumission et la **note publique imprimée de la facture**. Les notes internes de la soumission/réponse, notes du répertoire Contacts, descriptions privées des comptes et pièces jointes ne sont pas copiées. Les valeurs ne sont pas recalculées depuis les taux courants.

La signature d’une copie de soumission est conservée dans le suivi du lien. **Elle ne change pas automatiquement l’état comptable de la soumission source** : enregistre son acceptation dans le parcours habituel avant de la convertir en brouillon de facture. Aucun paiement ni écriture comptable n’est créé par le partage ou la signature. Une facture partagée reste consultable sans commande de signature ou de paiement.

Une soumission devenue non signable affiche un message sans formulaire de signature. L’annulation du document source rend son lien indisponible; les preuves historiques restent consultables dans l’entreprise. Les 20 liens récents sont affichés sur la fiche source; la liste des contrats/liens permet de retrouver les autres.

## Consultation et signature du client

L’ouverture du lien affiche une entrée privée. Le client clique **Consulter le document** pour voir le contenu; cette action enregistre la première ouverture. Les aperçus automatiques qui chargent seulement cette entrée ne sont pas comptés comme lecture du document.

Le statut **Ouvert via le lien** indique cette utilisation du lien, pas une identité vérifiée ni une preuve de lecture intégrale. Les anciens courriels envoyés sans lien ne fournissent pas ce suivi; aucun pixel de suivi du courriel n’est utilisé.

Pour signer un contrat ou une soumission éligible, le client saisit son nom, confirme le courriel destinataire et coche le consentement explicite avant de cliquer **Signer le document**. Le document affiché et son empreinte sont revérifiés côté serveur. Deux signatures concurrentes ne remplacent pas la première; un renvoi identique ne crée pas une nouvelle preuve.

La preuve conserve le **nom et le courriel déclarés**, la date serveur, le consentement et l’empreinte SHA-256 du contenu enregistré. Le lien ne vérifie pas l’identité ou le pouvoir de signature du porteur. Il s’agit d’une signature par nom saisi et consentement, sans certificat qualifié ni prestataire externe d’identification. Une signature dessinée n’est pas fournie dans ce lot.

Le texte publié et la preuve sont immuables. Un changement de tarif ou de conditions exige un nouveau document; le modèle n’altère jamais un texte déjà signé. Les événements externes sont audités comme actions du porteur du lien, sans les attribuer à un employé connecté.

## PDF, révocation et accès

Le client peut imprimer le document et sa preuve ou enregistrer un PDF avec **Imprimer / PDF**. Le navigateur imprime les valeurs affichées, sans conserver un PDF côté serveur. Désactive les en-têtes/pieds de page du navigateur pour omettre l’adresse privée du lien. L’interface, les formulaires de signature et les commandes ne figurent pas sur le papier; le contenu et la preuve y restent.

**Révoquer le lien** exige une confirmation et bloque les nouvelles ouvertures/signatures. La révocation et l’expiration ne suppriment pas la preuve conservée; elles ne retirent pas une copie déjà téléchargée par le client. Une fiche devenue périmée depuis son affichage doit être rechargée avant une action de gestion.

**Ventes en lecture** permet de consulter les documents et leur suivi. **Ventes en écriture** permet de gérer les modèles et contrats, préparer/publier les liens et les envoyer/révoquer. Un rôle lecture seule reste plafonné à la consultation, même avec une surcharge demandant l’écriture; le lien récupérable et les commandes de partage ne lui sont pas fournis. Créer un contrat autonome ne demande pas Contacts, Comptabilité ou Taxes. Les soumissions/factures conservent leurs droits de création et validation des références; voir [[Utilisateurs-et-permissions]].

Les recherches de titre/client et les listes paginées sont propres à l’entreprise. Les réponses du portail sont privées, sans cache, sans referrer et non indexables; aucun accès anonyme direct aux tables n’est accordé. Les données et clés existantes doivent être sauvegardées ensemble : [[Sauvegardes]].

## Retrouver les documents et suivre les accès

[[Suivi-des-contrats]] décrit les filtres par type, consultation/signature et disponibilité, les dates visibles et le blocage des nouveaux envois après annulation de la source. Une signature reste visible même si le lien expire ou est révoqué.

## Réutiliser un contrat

[[Duplication-des-contrats]] reprend les champs et variables pour revue dans un nouveau brouillon indépendant. La signature, le lien privé et les envois de l’original ne sont pas copiés.

## Export et brouillons inutiles

[[Export-et-nettoyage-des-contrats]] décrit le suivi CSV complet sous les mêmes filtres et la suppression confirmée des seuls brouillons. Les documents publiés et leurs preuves restent conservés.

## Références visuelles

![Éditeur français avec tarif réutilisable](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-editeur-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-editeur-mobile.png" alt="Conditions longues et tarif sur téléphone" width="412">

![English contract editor in dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-editeur-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-editeur-en-dark-mobile.png" alt="English contract editor on mobile in dark theme" width="412">

![Formulaire client de signature](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-portail-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-portail-mobile.png" alt="Consultation et signature depuis le téléphone du client" width="412">

![Recorded signature evidence in English](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-signature-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-signature-en-dark-mobile.png" alt="Recorded signature evidence on mobile" width="412">

Toutes les références utilisent des données fictives.
