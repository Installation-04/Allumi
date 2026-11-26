# Dupliquer un contrat en nouveau brouillon

Pour un renouvellement ou un autre client, ouvre un contrat dans **Ventes → Contrats et liens clients**, puis choisis **Dupliquer en brouillon**. Le contrat peut être en brouillon, publié, signé, expiré ou révoqué. Cette action ouvre un formulaire de revue; elle ne crée encore aucun document.

## Vérifier les champs repris

Le formulaire reprend uniquement :

- Le titre, le nom et le courriel du client.
- La langue du document.
- Le texte brut des conditions, avec ses variables.
- Le tarif horaire exact, ou un champ vide si aucun tarif n’était défini.

Vérifie et adapte ces champs avant d’enregistrer. Le lien **Revoir le contrat d’origine** permet de consulter la source; quitter le formulaire sans enregistrer ne crée rien. Le modèle partagé des nouveaux contrats n’écrase pas les conditions du contrat choisi.

Les variables `{{client_name}}`, `{{company_name}}` et `{{hourly_rate}}` utilisent les champs revus et le nom actuel de l’entreprise dans l’aperçu. Modifier le tarif remplace toutes ses occurrences variables. Les noms, tarifs et clauses écrits littéralement dans le texte restent à modifier manuellement. Voir [[Contrats-et-signatures]].

La langue du contrat choisi est conservée au départ, même si l’interface est dans une autre langue. La changer adapte le format du tarif et les libellés/consentement de la future publication; elle ne traduit pas automatiquement les conditions.

## Créer et publier la nouvelle version

1. Modifie le titre pour reconnaître le renouvellement, puis vérifie le client et le courriel.
2. Mets à jour les conditions, le tarif et la langue; relis l’aperçu.
3. Clique **Enregistrer** pour créer un **nouveau brouillon indépendant**.
4. Relis le brouillon et confirme séparément sa publication pour obtenir un nouveau lien privé.
5. Confirme l’envoi du nouveau lien si tu souhaites le transmettre par le relais SMTP configuré.

La copie ne reprend **aucune signature, preuve, empreinte de contenu publié, consultation, expiration, révocation, lien privé ou tentative d’envoi**. Enregistrer ne publie ni ne transmet de courriel. Une nouvelle publication fige le nouveau document et crée son propre lien de 90 jours; la signature du client exige une nouvelle action explicite.

Le contrat d’origine, ses conditions, son tarif, sa signature et son historique restent intacts. Les deux contrats sont indépendants, sans synchronisation ni relation de renouvellement conservée automatiquement. Le nouveau document reçoit son propre identifiant et son événement de création dans l’audit; aucun montant ou mouvement comptable n’est créé par cette copie.

## Accès et périmètre

La fonction exige **Ventes en écriture** dans la même entreprise. Le rôle lecture seule reste plafonné, même avec une surcharge demandant l’écriture; il ne voit pas la commande et ne peut pas ouvrir la page de copie. Aucun accès Contacts, Comptabilité ou Taxes n’est nécessaire pour ce contrat autonome.

Seuls les **contrats autonomes** sont copiés par ce parcours. Une copie de soumission ou de facture partagée n’est pas transformée en contrat ici. Pour dupliquer une soumission comptable, utilise son parcours [[Devis]]. Une source étrangère, absente ou un paramètre de copie invalide/répété est refusé; aucune création n’a lieu en ouvrant cette adresse.

Pour retrouver les nouveaux brouillons et suivre leurs futurs liens, voir [[Suivi-des-contrats]].

## Export et brouillons inutiles

[[Export-et-nettoyage-des-contrats]] décrit le suivi CSV complet sous les mêmes filtres et la suppression confirmée des seuls brouillons. Les documents publiés et leurs preuves restent conservés.

## Choisir un client du répertoire

[[Choisir-un-client-pour-un-contrat]] décrit la recherche facultative de clients actifs pour préremplir le nom/courriel avant revue, sans changer les conditions, le tarif ou la langue.

## Références visuelles

![Copie française d’un contrat pour revue](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-copie-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-copie-mobile.png" alt="Copie d’un contrat sur téléphone" width="412">

![Contract copy in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-copie-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/contrats-copie-en-dark-mobile.png" alt="Contract copy on mobile in English" width="412">

Les captures utilisent des données fictives.
