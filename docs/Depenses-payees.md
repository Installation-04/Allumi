# Dépenses immédiatement payées

Dans **Dépenses → Dépenses payées**, préparez une dépense déjà réglée à un fournisseur, puis validez-la pour la comptabiliser directement contre la banque, l’encaisse ou la carte de crédit utilisée.

Si une facture existe déjà dans **Factures fournisseurs**, enregistrez son paiement depuis sa fiche. Ne la ressaisissez pas comme une dépense : cela doublerait les charges et les taxes.

## Préparer le brouillon

Choisissez un fournisseur actif, une référence de reçu si disponible, la date du document, le compte de paiement et le mode utilisé. Ajoutez les lignes avec leurs quantités, prix en CAD, comptes de charges et codes fiscaux. Le catalogue propose la description et le compte; le prix d’achat reste à saisir.

Les droits du module **Comptabilité** contrôlent la lecture et l’écriture. L’enregistrement d’un brouillon ne crée aucune écriture. Sa fiche affiche les montants calculés et le compte choisi. Vous pouvez le modifier ou le supprimer; une version modifiée ailleurs exige de recharger la fiche.

![Brouillon sur ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/depense-payee-brouillon-desktop.png)

## Valider

Ouvrez **Valider la dépense**, choisissez la date comptable du paiement et confirmez les montants et l’admissibilité intégrale des taxes. Cette date doit être au moins égale à la date du document, ne pas être future et appartenir à une période ouverte.

La validation attribue un numéro de la séquence d’achats `A-…`, fige les coordonnées du fournisseur et crée une écriture : débit des charges et des taxes récupérables, crédit du compte de paiement. Elle ne crée ni dette fournisseur ni règlement séparé dans Paiements fournisseurs. Aucun virement bancaire n’est envoyé.

Un second essai de la même validation retourne la dépense existante sans numéro ni écriture supplémentaire. La pièce validée est immuable. La base vérifie que l’écriture utilise exactement les montants, comptes et cases fiscales de la dépense.

![Dépense validée](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/depense-payee-validee-desktop.png)

![Dépense sur téléphone](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/depense-payee-validee-mobile.png)

## Corriger et limites

**Annuler la dépense** demande un motif et une date dans une période ouverte, au moins égale à sa validation. La contre-passation inverse chaque ligne; la dépense, son numéro, son écriture d’origine et l’audit restent conservés.

Ce premier parcours exige un fournisseur actif et un compte actif banque, encaisse ou carte de crédit. Il couvre les charges avec taxes entièrement récupérables ou sans taxe. Ne validez pas si les montants calculés ne correspondent pas au reçu. Les dépenses sans contact, immobilisations/stocks, récupération partielle, ajustements manuels de taxes et pièces jointes ne sont pas disponibles dans ce parcours. Les listes affichent les 100 pièces les plus récentes; les brouillons proposent une recherche.

Voir [[Factures-fournisseurs]], [[Taxes-et-catalogue]] et [[Utilisateurs-et-permissions]].
