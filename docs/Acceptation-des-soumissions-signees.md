# Revoir et accepter une soumission signée

La signature d’un lien client et la décision interne sur une soumission sont deux étapes distinctes. Dans **Ventes → Contrats et liens clients**, ouvre une copie de soumission signée puis **Revoir et accepter la soumission signée**.

## Revoir la preuve et décider

1. Vérifie la **Soumission source actuelle** : numéro, état et date de validité. Le lien ouvre la fiche source.
2. Relis le contenu publié, les parties, l’empreinte et la signature déclarée. La page ne récupère pas le lien privé du client.
3. Si la source est encore **Envoyé** et valide à la date de Toronto, saisis au besoin une **Note interne sur la réponse** (500 caractères maximum).
4. Coche la confirmation de revue puis clique **Accepter la soumission source**.
5. La fiche de soumission s’ouvre avec l’état **Accepté** et la note enregistrée. Tu peux poursuivre par la conversion habituelle si tes permissions le permettent.

L’action enregistre l’acceptation, sa date et une référence d’audit vers le document signé et son empreinte. Elle **ne crée aucune facture, paiement, écriture ou envoi**. Le document publié et sa signature restent inchangés. La note est interne à la soumission; elle n’est pas ajoutée au contenu signé.

La **conversion en facture brouillon** reste une action séparée, avec ses confirmations et ses permissions Contacts, Comptabilité et Taxes habituelles. L’acceptation seule ne valide pas une facture et ne génère aucun mouvement financier. Voir [[Devis]].

## Conditions et accès

**Ventes en écriture** permet la revue et l’acceptation, même sans accès Contacts, Comptabilité ou Taxes. Un rôle lecture seule reste plafonné : une surcharge demandant l’écriture ne l’autorise pas. Les lecteurs peuvent toujours consulter les documents et leurs preuves par les parcours existants. Voir [[Utilisateurs-et-permissions]].

Ce parcours concerne uniquement une **copie publiée de soumission, déjà signée**. Un contrat autonome, une facture, un brouillon, une copie non signée ou une référence d’une autre entreprise n’est pas éligible.

La validité de la **soumission source** se vérifie à la date courante de Toronto, dates inclusives. Une source acceptée, refusée, annulée, convertie ou expirée n’affiche plus de commande d’acceptation. Son état actuel reste visible sur la revue d’une preuve signée accessible.

La disponibilité du **lien client** est distincte : une preuve signée reste utilisable pour la revue après expiration ou révocation du lien, tant que la source est encore envoyée et valide. Revoir ou accepter ne réactive pas le lien et ne marque pas de nouvelle consultation client.

## Révision périmée, intégrité et audit

La révision de la soumission et l’empreinte du document revues sont vérifiées de nouveau à la confirmation. Si un collègue a traité la source entre-temps, l’ancienne page est refusée, la note saisie reste disponible et **Recharger la revue** permet de voir le nouvel état. Deux confirmations concurrentes ne produisent qu’une acceptation et une référence d’audit.

Le contrôle d’intégrité du [[Dossier-de-preuve-des-documents]] est réutilisé avant tout changement. Si le contenu restauré ne correspond plus à son empreinte, la revue affiche un refus sans contenu ni formulaire et l’acceptation est bloquée. Si l’enregistrement de l’audit échoue, la décision et sa trace de modification sont annulées ensemble.

L’audit comprend l’événement `estimate.accept_signed_document`, lié à la soumission, avec la référence du document client et l’empreinte de publication. Aucun jeton, lien privé ou détail de signature n’est ajouté à cet événement. L’auteur employé et la date proviennent du contexte serveur validé; la consultation du journal conserve ses permissions propres.

La signature demeure **déclarative** : l’identité et le pouvoir de signature ne sont pas vérifiés par ce parcours. La décision d’acceptation appartient à l’employé autorisé après revue. La signature publique seule n’accepte pas automatiquement la source; l’acceptation manuelle habituelle reste disponible séparément, sans prétendre qu’une preuve a été revue. Voir [[Contrats-et-signatures]].

## Références visuelles

![Revue et confirmation d’une soumission signée](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/revue-soumission-signee-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/revue-soumission-signee-mobile.png" alt="Confirmation de revue sur téléphone" width="412">

![Signed estimate review in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/revue-soumission-signee-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/revue-soumission-signee-en-dark-mobile.png" alt="Signed estimate review on mobile in English" width="412">

Toutes les captures utilisent des données fictives.
