# Annulation des factures

L’annulation corrige entièrement une facture validée. Elle conserve le numéro, les coordonnées figées, les lignes et l’écriture originale; une nouvelle écriture en inverse exactement les débits et crédits. Elle ne crée pas d’avoir partiel et ne supprime aucun document.

## Annuler

Ouvrir **Brouillons de factures → Factures validées**, puis la facture. Le propriétaire ou un comptable peut ouvrir **Annuler la facture**. Indiquer :

- une date de contre-passation égale ou postérieure à la date comptable de la facture, dans une période ouverte;
- un motif obligatoire de 1 à 500 caractères;
- la confirmation explicite de l’annulation.

Valider. Le statut devient **Facture annulée**. Le motif, la date et le lien **Voir la contre-passation** restent sur la fiche. Les lecteurs peuvent consulter cet historique, mais pas annuler.

Les montants affichés restent ceux de la facture originale : ils ne représentent pas un solde à encaisser. Le lien vers l’écriture d’origine reste disponible. La liste conserve les factures annulées parmi les 100 documents les plus récemment validés.

## Contrôles

Une période verrouillée, une date antérieure, un paiement affecté, un avoir affecté ou un avoir validé lié empêchent l’opération. Un avoir admissible peut être annulé depuis sa fiche : voir [[Validation-des-avoirs]]. La désaffectation des paiements n’est pas encore disponible; il ne faut pas contourner ces protections en modifiant directement la base.

La contre-passation et le statut sont enregistrés ensemble. Un refus ne laisse aucune écriture partielle. Répéter la demande ou cliquer deux fois ne crée pas de seconde contre-passation et ne remplace pas le premier motif. La piste d’audit conserve le changement.

Une facture annulée ne peut pas être remise en brouillon ou revalidée. Créer un nouveau brouillon si une nouvelle facture est nécessaire. Les avoirs partiels, remboursements, PDF et envoi restent à venir.

## Captures

Données fictives, Chromium ordinateur et téléphone émulé. Les essais sur iPhone physique restent à effectuer.

![Facture annulée](images/facture-annulee-desktop.png)
![Facture annulée en anglais sombre sur téléphone](images/facture-annulee-en-dark-mobile.png)

Les [[Brouillons-d-avoirs]] préparent une correction partielle sans effet comptable. Ils ne bloquent pas l’annulation; après celle-ci, ils restent consultables et supprimables mais ne peuvent plus être modifiés.
