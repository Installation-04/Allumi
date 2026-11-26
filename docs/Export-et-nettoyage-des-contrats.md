# Exporter le suivi et nettoyer les brouillons

Dans **Ventes → Contrats et liens clients**, exporte le suivi pour tes vérifications internes et retire les brouillons devenus inutiles. Les documents publiés et leurs preuves restent conservés.

## Télécharger les résultats filtrés

1. Choisis la recherche, le type de document, l’étape de consultation/signature et la disponibilité du lien, puis applique **Rechercher**.
2. Clique **Exporter le suivi CSV**.
3. Ouvre le fichier `contract_tracking.csv` dans ton tableur.

Le téléchargement inclut **tous les résultats correspondant aux filtres**, même depuis la deuxième page de la liste : il ne se limite pas aux 50 lignes affichées. Il reprend le même filtre et les mêmes permissions, dans un seul instantané de lecture. Les filtres invalides ou répétés sont refusés.

Le plafond est de **5 000 documents**. Au-delà, l’application demande de réduire les filtres et ne crée aucun fichier partiel. Un résultat vide produit seulement la ligne d’en-tête. La liste conserve son fonctionnement paginé; le CSV ne modifie aucun document ni événement de consultation.

## Colonnes, dates et confidentialité

Le fichier comprend la référence Allumi du document, son titre, le nom du client, le type, l’étape de consultation/signature, la disponibilité du lien, les dates de publication/première ouverture/signature/expiration et la date d’extraction du suivi.

Les dates sont en **UTC ISO 8601, avec précision à la milliseconde**. La date d’extraction correspond à l’instantané SQL utilisé pour calculer les états, commun à toutes les lignes. L’écran continue d’afficher les dates à l’heure de Toronto; voir [[Suivi-des-contrats]]. Un lien peut expirer après cet instantané : le fichier reflète sa disponibilité au moment de l’extraction.

La langue de l’interface détermine les libellés et le séparateur : **point-virgule en français**, **virgule en anglais**, avec BOM UTF-8 et fins de ligne CRLF. Les textes sont protégés contre l’interprétation en formules de tableur, y compris après des espaces en début de cellule; les guillemets et sauts de ligne sont échappés.

Le CSV n’inclut **aucun lien privé, jeton, texte de conditions, courriel destinataire, identité du signataire ou preuve détaillée de signature**. Il contient des noms de clients : conserve-le comme un export interne. Il ne remplace pas la preuve conservée dans la fiche; voir [[Contrats-et-signatures]]. Les signatures déclarées ne vérifient pas l’identité du signataire.

L’export exige **Ventes en lecture** dans l’entreprise. Un rôle lecture seule peut exporter les documents qu’il peut consulter; il ne peut pas les modifier ou supprimer. Aucun export anonyme ni accès à une autre entreprise n’est accordé.

## Supprimer un brouillon non publié

Ouvre le brouillon, puis déplie **Supprimer le brouillon**. Relis l’explication, coche la confirmation et clique **Supprimer le brouillon**. La liste est ensuite rechargée.

Seul un gestionnaire disposant de **Ventes en écriture** peut effectuer cette action. La révision est revérifiée sous verrou : si quelqu’un a modifié ou publié le document depuis son affichage, la suppression est refusée et la fiche doit être rechargée.

La commande s’applique aux brouillons de contrat et aux partages non publiés de soumission/facture. Elle retire uniquement ce brouillon; la soumission ou facture comptable source reste intacte. Une trace de suppression est conservée dans l’audit. Il n’existe pas de corbeille ou d’annulation automatique de cette suppression.

Un document **publié ne peut pas être supprimé ici**, même s’il est signé, expiré, révoqué ou si sa source est annulée. Pour bloquer l’accès client, utilise **Révoquer le lien**, qui conserve le document et ses preuves. Les règles SQL protègent également cette limite; une publication concurrente ne peut pas être suivie d’une suppression du document publié.

Ces actions ne créent aucun paiement, mouvement comptable, courriel ou signature. Pour préparer un renouvellement, utilise [[Duplication-des-contrats]].

## Conserver le contenu et la preuve

[[Dossier-de-preuve-des-documents]] décrit le téléchargement privé du contenu publié, de son empreinte et de la signature déclarée, y compris après expiration/révocation.

## Références visuelles

![Export du suivi filtré](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-export-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-export-mobile.png" alt="Export du suivi sur téléphone" width="412">

![Confirmed draft cleanup in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-nettoyage-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-nettoyage-en-dark-mobile.png" alt="Draft cleanup on mobile in English" width="412">

Toutes les captures utilisent des données fictives.
