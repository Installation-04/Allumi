# Retrouver les contrats et liens clients dans la recherche globale

Depuis **Rechercher dans l’entreprise**, retrouve les contrats et copies de liens clients avec leur titre, le nom du client ou leur référence Allumi complète. Ouvre le résultat pour consulter la fiche interne et son suivi; le résultat ne contient pas de lien privé à transmettre au client.

## Rechercher et filtrer

1. Saisis une partie du titre ou du nom du client. La recherche est insensible à la casse; `%`, `_` et `\` restent des caractères littéraux.
2. Ouvre **Filtres avancés** et choisis **Type → Contrats et liens clients** pour isoler ces copies des factures/soumissions comptables originales.
3. Choisis au besoin **Brouillon**, **Publié**, **Ouvert via le lien** ou **Signé électroniquement**, puis les dates de création.
4. Clique **Rechercher**, puis ouvre la fiche voulue dans les résultats.

La référence Allumi complète correspond à l’identifiant du document, présent dans le CSV de suivi ou dans la dernière partie de l’adresse de sa fiche. Cette référence est recherchée exactement, sans distinction de majuscules; un fragment d’identifiant n’est pas utilisé comme terme partiel. Cela évite de mêler des fragments numériques aléatoires aux recherches de montants.

Le champ Date représente la **date de création du partage/contrat à l’heure de Toronto**, pour les brouillons comme pour les publications. Il ne représente pas la date de publication, de signature ou la date comptable de la source. Les dates de début et de fin sont inclusives.

Ces copies n’ont **aucun montant financier associé dans la recherche** : un filtre de montant les exclut, y compris zéro. Recherche la facture ou soumission comptable originale pour ses montants. Aucun total n’est ajouté à partir du contenu du contrat ou de la copie.

Les résultats conservent l’ordre global par date décroissante, type et référence stable. Jusqu’à 50 résultats figurent par page, avec les mêmes filtres sur Précédent/Suivant; précise les critères au-delà de 5 000 résultats. Voir [[Recherche-globale]].

## Consultation, signature et disponibilité

Le statut décrit l’étape du document : **Brouillon**, **Publié**, **Ouvert via le lien**, puis **Signé électroniquement**. La signature reste visible après expiration ou révocation du lien. Un document dont la source a été annulée reste retrouvable dans l’entreprise; cette recherche ne réactive aucun accès public.

La **disponibilité du lien** est un suivi distinct. Ouvre la fiche ou utilise les filtres du [[Suivi-des-contrats]] pour vérifier lien accessible, expiré, révoqué ou source indisponible. Un statut Signé ne signifie pas que le lien est encore accessible ou que l’identité du signataire a été vérifiée.

Les partages de soumission/facture apparaissent sous **Contrats et liens clients**; leurs originaux restent sous Soumission/Facture, avec leurs dates et montants comptables. Ce sont des résultats distincts qui ouvrent des fiches distinctes.

## Suggestions et confidentialité

Les [[Suggestions-de-recherche]] de l’en-tête incluent ces documents dès deux caractères, dans la limite habituelle de huit suggestions. Le libellé reprend titre et nom du client; les flèches et Entrée, ou un clic/toucher, ouvrent la fiche interne. Entrée sans choix ouvre la recherche complète.

**Ventes en lecture** dans l’entreprise suffit, y compris en lecture seule et sans accès Contacts ou Comptabilité. Les noms sont ceux conservés sur le contrat/partage; le répertoire Contacts n’est pas consulté pour les compléter. Retirer Ventes retire aussi ces résultats et suggestions. Aucun résultat d’une autre entreprise n’est mélangé.

Seuls le titre, le nom du client et la référence complète sont recherchés pour ces documents. **Conditions, courriels destinataire/signataire, consentement, empreinte, jeton, clé et lien privé ne sont ni indexés ni retournés dans leurs métadonnées.** Les autres types de résultats conservent leurs propres critères et permissions. Le terme peut figurer dans l’historique du navigateur ou les journaux d’un proxy; les protections générales de [[Recherche-globale]] s’appliquent.

La recherche et les suggestions ne changent pas le document, ne marquent pas une consultation client et ne créent aucun envoi, signature ou mouvement comptable. La fiche interne conserve ses permissions; publication, partage et envoi restent des actions distinctes. Voir [[Contrats-et-signatures]] et [[Dossier-de-preuve-des-documents]].

## Références visuelles

![Résultat de recherche d’un contrat signé](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/recherche-contrats-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/recherche-contrats-mobile.png" alt="Recherche d’un contrat sur téléphone" width="412">

![Client-document search in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/recherche-contrats-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/recherche-contrats-en-dark-mobile.png" alt="Client-document search on mobile in English" width="412">

Toutes les captures utilisent des données fictives.
