# Validation des factures

Préparer et enregistrer d’abord un [[Brouillons-de-factures]], puis ouvrir **Valider la facture** sur sa fiche. Vérifier les lignes, les taxes, le total et les coordonnées du client et de l’entreprise avant de continuer.

Choisir la **date comptable**, égale ou postérieure à la date de facture, dans une période ouverte. La date de facture reste la date utilisée pour les taux fiscaux. Cocher la confirmation puis valider. Si un taux a changé et que les montants enregistrés ne correspondent plus, revenir au brouillon et l’enregistrer pour revoir le calcul avant de valider.

La validation attribue le prochain numéro de facture, débite le compte clients et crédite les revenus et taxes collectées. L’ensemble est enregistré dans une seule transaction : en cas de refus, ni document validé, ni écriture partielle, ni numéro consommé. Un nouvel envoi de la même demande retourne la facture déjà validée, sans créer une seconde écriture. Un brouillon modifié depuis son ouverture doit être rechargé avant validation.

Le propriétaire et les comptables peuvent valider; les lecteurs peuvent consulter. Les accès restent isolés par entreprise et les changements sont audités.

## Consulter

Depuis **Brouillons de factures → Factures validées**, ouvrir le numéro souhaité. Les 100 factures les plus récemment validées sont affichées, y compris celles annulées avec leur statut. La fiche présente les montants, dates et coordonnées figées à la validation, avec un lien **Voir l’écriture comptable**. Modifier ensuite le client ou l’entreprise ne réécrit pas ces coordonnées.

Une facture validée et son écriture sont immuables. Une correction complète passe par [[Annulation-des-factures]], qui crée une écriture inverse et conserve le document. Les [[Brouillons-d-avoirs]] sont disponibles sans effet comptable; leur validation reste à venir. Utiliser uniquement des données fictives pendant cette préversion. Envoi, PDF, paiements et solde ouvert ne sont pas encore disponibles dans ce parcours. Une écriture de facture ne peut pas être contre-passée depuis le journal manuel.

## Captures

Données fictives, Chromium ordinateur et téléphone émulé; les essais sur iPhone physique restent à effectuer.

![Facture validée](images/facture-validee-desktop.png)
![Facture mobile en anglais sombre](images/facture-validee-en-dark-mobile.png)
