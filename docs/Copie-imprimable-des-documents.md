# Télécharger une copie imprimable d’un document client

Dans **Ventes → Contrats et liens clients**, ouvre un document publié puis **Dossier de preuve → Télécharger la copie imprimable (HTML)**. Le téléchargement contient un fichier autonome UTF-8, nommé `allumi-document-<référence>.html`, lisible hors ligne dans un navigateur.

Le fichier reprend le texte publié du contrat ou les champs publics figés de la soumission/facture partagée, les parties, le destinataire, la référence Allumi et l’empreinte SHA-256. Il conserve les paragraphes et les caractères Unicode. La signature déclarée comprend le nom, le courriel, le consentement et sa date lorsqu’elle existe; sinon la copie indique l’absence de signature enregistrée.

Les événements connus au moment de l’export figurent dans le pied du document : publication, expiration, première ouverture, signature et révocation selon les valeurs présentes. Les horodatages sont en **UTC**, au format ISO, avec la date de génération de la copie. Leur présence ne garantit pas la disponibilité actuelle du lien; vérifie celle-ci sur la fiche Allumi.

## Lire hors ligne ou enregistrer un PDF

1. Enregistre le fichier HTML téléchargé puis ouvre-le dans ton navigateur. Aucune connexion au serveur ou session Allumi n’est nécessaire pour lire cette copie déjà téléchargée.
2. Utilise **Imprimer** dans le menu du navigateur, ou `Ctrl+P` / `Cmd+P`.
3. Choisis **Enregistrer au format PDF** ou une imprimante. La mise en page prévoit du papier A4 et conserve le texte long sur plusieurs pages. Les instructions de lecture hors ligne sont masquées à l’impression.
4. Vérifie l’aperçu avant de conserver ou transmettre le fichier. Les en-têtes/pieds de page du navigateur peuvent ajouter le nom du fichier local; désactive-les au besoin.

Le serveur fournit un **HTML**, pas un PDF déjà généré. La création du PDF utilise ton navigateur. Le fichier ne contient ni commande JavaScript ni bouton d’impression actif; le menu du navigateur reste utilisable. Les polices sont celles disponibles sur ton appareil, sans téléchargement de police externe.

La langue des libellés de la copie est celle enregistrée pour le document, même si l’interface Allumi est affichée dans une autre langue. Le texte des conditions n’est pas traduit automatiquement. Le fichier utilise une présentation claire pour la lecture et l’impression, indépendamment du thème de l’application.

## Accès et contrôle du contenu

**Ventes en lecture** permet le téléchargement dans la même entreprise, y compris en lecture seule sans Contacts ou Comptabilité. Les brouillons n’ont pas de copie publiée à télécharger. Retirer Ventes retire aussi ce téléchargement.

Le serveur réutilise la lecture et la vérification du [[Dossier-de-preuve-des-documents]] : le contenu canonique de publication doit correspondre à l’empreinte enregistrée, sinon le fichier est refusé en entier. Les données de publication et de preuve sont lues dans le même instantané. Les téléchargements et leur redirection vers la connexion ne sont pas mis en cache et utilisent une politique sans referrer.

La copie reste disponible après expiration ou révocation, et après annulation du document source. Elle ne réactive pas le lien client. Le téléchargement ne marque pas une consultation client, ne crée aucun envoi, signature, paiement ou écriture et ne change pas le document original.

## Confidentialité et limites de la preuve

La copie contient des **données confidentielles**, notamment le texte, le destinataire et les informations de signature. Une personne qui reçoit ce fichier peut le lire sans Allumi et le modifier. La révocation du lien n’efface pas les copies déjà enregistrées; protège leur stockage et leur transmission.

Aucun jeton, clé ou lien d’accès privé généré par Allumi, modèle brut, note interne ou historique SMTP n’est ajouté au fichier. Les valeurs du texte publié restent reproduites littéralement : si tu y as écrit une information confidentielle, elle est conservée dans la copie. Les balises HTML saisies restent du texte, sans création de script, image ou lien actif. Le fichier embarque une politique de sécurité qui interdit les ressources réseau et les scripts; aucune ressource externe n’est requise.

L’empreinte affichée couvre **le contenu canonique de publication seulement**, pas les événements, la signature ou le fichier exporté. Ce HTML n’est pas signé numériquement et ne vérifie ni l’identité ni le pouvoir du signataire; aucun horodatage externe n’est ajouté. Le dossier JSON reste proposé séparément pour conserver le contenu canonique et sa preuve technique. Voir [[Contrats-et-signatures]].

## Références visuelles

![Copie imprimable depuis une fiche de contrat](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-imprimable-contrats-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-imprimable-contrats-mobile.png" alt="Téléchargement de la copie sur téléphone" width="412">

![Printable copy in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-imprimable-contrats-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/copie-imprimable-contrats-en-dark-mobile.png" alt="Printable copy on mobile in English" width="412">

Toutes les captures utilisent des données fictives. Les liens de ces documents de démonstration sont révoqués avant les captures.
