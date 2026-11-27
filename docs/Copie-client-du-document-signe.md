# Conserver une copie client du document signé

Après la signature d’un contrat ou d’une copie de soumission dans le portail, clique **Télécharger la copie signée**. À une visite suivante, ouvre le même lien privé puis **Consulter le document** pour retrouver la commande. Aucun compte Allumi n’est nécessaire : toute personne possédant le lien actif peut accéder au document.

Le téléchargement fournit un fichier **HTML autonome UTF-8**, lisible sans connexion dans un navigateur. Il contient le contenu publié, les parties, la signature déclarée, son consentement, les dates UTC, la référence Allumi et l’empreinte du contenu. Utilise **Imprimer → Enregistrer en PDF** dans le navigateur pour obtenir un PDF. Allumi ne génère pas de PDF côté serveur.

## Disponibilité et confidentialité

La commande apparaît seulement après une signature enregistrée. Les factures, brouillons et documents non signés ne disposent pas de cette copie client. Le serveur vérifie le lien à chaque téléchargement : un lien expiré ou révoqué, une soumission source annulée ou un contenu dont l’empreinte est invalide sont refusés. Une soumission signée reste téléchargeable lorsque sa source est envoyée, acceptée ou convertie, tant que le lien est actif.

Le fichier n’ajoute aucun jeton, lien privé, donnée de relais SMTP ou contenu canonique brut. La réponse n’est pas mise en cache et n’envoie pas de referrer. Le téléchargement partage la limite de lecture du portail; si trop de demandes sont effectuées, attendre avant de réessayer.

Le fichier contient des données confidentielles du client. Conserve-le dans un emplacement approprié. Un fichier déjà téléchargé reste lisible après révocation ou expiration du lien : ces actions empêchent de nouveaux téléchargements et ne retirent pas les copies déjà conservées.

## Effets et limites

Télécharger ne marque pas une nouvelle consultation, ne signe pas à nouveau, n’accepte pas une soumission et ne crée aucune facture, écriture, paiement ou notification. L’ouverture explicite du document dans le portail conserve son suivi habituel; il n’existe pas de compteur de téléchargements métier ajouté par cette fonctionnalité.

La signature est **déclarative** : l’identité et le pouvoir de signature ne sont pas vérifiés. Le fichier exporté est modifiable et n’est pas scellé numériquement. L’empreinte couvre le contenu publié, pas la signature, les événements ni le fichier complet. Aucun horodatage externe n’est fourni. Voir [[Contrats-et-signatures]] et [[Dossier-de-preuve-des-documents]].

Les employés autorisés conservent leur téléchargement privé [[Copie-imprimable-des-documents]], disponible même après révocation ou expiration sous les permissions Ventes. Le téléchargement client n’ouvre pas cet accès interne.

## Références visuelles

![Copie client après signature](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-client-signee-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-client-signee-mobile.png" alt="Téléchargement client sur téléphone" width="412">

![Signed client copy in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-client-signee-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-client-signee-en-dark-mobile.png" alt="Signed client copy on mobile in English" width="412">

Toutes les captures utilisent des données fictives.
