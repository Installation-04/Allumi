# Suivi des contrats et liens clients

Dans **Ventes → Contrats et liens clients**, retrouve les contrats, soumissions et factures partagés. Les conditions, la publication, l’envoi et la signature sont décrits dans [[Contrats-et-signatures]].

## Filtrer les documents

La recherche porte sur le titre et le nom du client. Le texte est recherché littéralement : `%`, `_` et `\` ne sont pas des jokers. Les filtres se combinent :

| Filtre | Choix |
|---|---|
| Type de document | Contrat, soumission ou facture |
| Consultation et signature | Brouillon, publié non ouvert, ouvert via le lien ou signé |
| Disponibilité du lien | Aucun lien publié, accessible, expiré, révoqué ou source indisponible |

Par exemple, choisis **Contrat + Signé électroniquement + Lien expiré** pour retrouver les contrats signés dont l’accès client a expiré. La signature et l’accès sont deux informations distinctes : l’expiration ne supprime pas la preuve.

**Rechercher** applique les filtres et repart à la première page. La liste affiche 50 documents par page, avec **Précédente/Suivante** conservant la recherche et les filtres. **Réinitialiser** revient à la liste complète. Une adresse contenant un filtre inconnu, répété ou une page invalide affiche une erreur, sans élargir silencieusement les résultats.

Les filtres portent sur l’ensemble des documents de l’entreprise avant pagination, dans un même instantané de lecture. Ils ne se limitent pas aux lignes déjà affichées. Les droits Ventes et le plafond du rôle lecture seule restent applicables; la liste ne contient aucun jeton ou lien privé récupérable.

## Lire les états et les dates

La liste, la fiche et le panneau de la soumission/facture source affichent la même séparation :

- **Consultation/signature** conserve l’étape atteinte. **Signé électroniquement** reste visible lorsque le lien expire ou est révoqué.
- **Disponibilité** indique si le lien peut encore être ouvert. Pour un document publié, la révocation est prioritaire sur l’expiration, puis sur l’indisponibilité de la source. Un brouillon n’a pas encore de lien publié.

Les dates de publication, première ouverture, signature et expiration apparaissent lorsqu’elles existent. L’affichage du suivi utilise l’heure de **Toronto**, en français ou anglais; la preuve conserve également sa date serveur exacte. **Actualiser le suivi** recharge les événements : aucun rafraîchissement automatique ou pixel de courriel n’est ajouté.

Un lien accessible d’une soumission ne signifie pas qu’elle est encore signable : après expiration de la soumission ou son acceptation manuelle, le portail peut rester consultable sans permettre une nouvelle signature. La disponibilité du lien ne représente pas non plus un solde à payer; les factures partagées ne collectent pas de paiement.

## Source annulée et nouvel envoi

L’annulation d’une soumission ou d’une facture rend ses liens publiés indisponibles. La fiche conserve le document figé, son historique et sa preuve, mais retire le lien récupérable et la commande d’envoi. Un brouillon de partage dont la source est annulée ne propose plus sa publication.

Le service et la base refusent aussi une nouvelle réservation d’envoi. Un verrou sur la source arbitre une annulation concurrente : une réservation qui reprend après l’annulation est refusée. Cela ne rappelle pas un courriel déjà réservé ou transmis au relais avant l’annulation. Un renvoi avec le même identifiant de tentative retourne son résultat historique sans transmettre un nouveau message.

**Révoquer le lien** reste disponible aux gestionnaires Ventes pour un document publié non révoqué, y compris après expiration ou annulation de sa source. Cette action conserve la signature et l’historique. Les lecteurs autorisés peuvent toujours consulter les preuves conservées dans l’entreprise.

Ces consultations et filtres ne changent aucun document, aucune signature et aucune écriture comptable. L’affichage ne garantit ni l’identité du visiteur ni la lecture intégrale; voir [[Contrats-et-signatures]].

## Export et brouillons inutiles

[[Export-et-nettoyage-des-contrats]] décrit le suivi CSV complet sous les mêmes filtres et la suppression confirmée des seuls brouillons. Les documents publiés et leurs preuves restent conservés.

## Conserver le contenu et la preuve

[[Dossier-de-preuve-des-documents]] décrit le téléchargement privé du contenu publié, de son empreinte et de la signature déclarée, y compris après expiration/révocation.

## Références visuelles

![Suivi filtré des contrats signés](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-suivi-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-suivi-mobile.png" alt="Filtres et dates des contrats sur téléphone" width="412">

![English tracking in dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-suivi-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-suivi-en-dark-mobile.png" alt="English contract tracking on mobile in dark theme" width="412">

Les captures utilisent des données fictives.

## Contrats et liens clients dans la recherche globale

[[Recherche-des-contrats]] décrit le titre, nom du client et référence complète, les étapes de consultation/signature, les dates de création à Toronto et les suggestions vers la fiche interne, sous Ventes lecture.
