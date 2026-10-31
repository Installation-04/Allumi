# Factures fournisseurs

Dans **Dépenses → Factures fournisseurs**, préparez une facture à payer, puis validez-la pour la comptabiliser. Les droits du module **Comptabilité** s’appliquent : lecture pour consulter, écriture pour créer, modifier, supprimer, valider et annuler. Les restrictions de l’entreprise sont également contrôlées en base.

## Saisir et vérifier

Créez d’abord un contact actif de type Fournisseur ou Client et fournisseur, puis initialisez le plan comptable et les taxes. Choisissez le fournisseur, le numéro inscrit sur sa facture, la date du document et son échéance. Un même numéro ne peut pas être réutilisé pour ce fournisseur tant que la pièce précédente n’est pas annulée, y compris en brouillon. Le numéro peut rester vide si la pièce n’en porte pas.

Ajoutez les descriptions, quantités, prix en CAD, comptes de charges et codes fiscaux. Le catalogue peut fournir la description, le compte et le code de taxe; saisissez toujours le coût d’achat, proposé à zéro plutôt que repris du prix de vente. Les quantités acceptent quatre décimales, les prix six; les montants et taxes sont calculés sans nombres flottants. L’arrondi de l’entreprise est conservé sur le brouillon.

L’enregistrement ne crée aucune écriture. Relisez le sous-total, les taxes et le total; vous pouvez modifier ou supprimer le brouillon. Une modification concurrente impose de recharger la fiche.

![Saisie sur ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/achat-formulaire-desktop.png)

## Valider

Ouvrez **Valider la facture**, indiquez une date comptable au moins égale à la date du document et située dans une période ouverte, puis confirmez les montants et l’admissibilité intégrale des taxes.

Cette version est limitée aux charges avec taxes entièrement récupérables ou sans taxe. **Ne validez pas si les taxes calculées diffèrent de la facture fournisseur ou si elles ne sont pas entièrement récupérables.** Les ajustements de taxes et la récupération partielle ne sont pas encore pris en charge.

La validation attribue un numéro interne `A-…`, fige les coordonnées du fournisseur et crée une écriture équilibrée : débit des charges et des taxes récupérables, crédit des comptes fournisseurs. Un nouvel essai de la même validation ne crée pas de seconde écriture. La pièce validée devient immuable; son écriture est consultable depuis sa fiche.

![Facture fournisseur validée](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/achat-valide-desktop.png)

![Facture fournisseur sur téléphone](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/achat-valide-mobile.png)

## Corriger et limites

**Annuler la facture** demande un motif et une date dans une période ouverte, au moins égale à la date comptable originale. La facture et sa piste d’audit restent présentes; une écriture inverse annule son effet comptable. Des paiements ou crédits liés empêchent l’annulation tant qu’ils ne sont pas résolus.

Le règlement des fournisseurs, les crédits fournisseurs, les dépenses immédiatement payées, les immobilisations et stocks, les pièces jointes et l’âge des comptes fournisseurs restent à venir. Les listes affichent au maximum 100 pièces; la liste des brouillons propose une recherche. Les sélecteurs de fournisseurs et d’articles sont limités à 500 entrées actives.

Voir aussi [[Taxes-et-catalogue]], [[Utilisateurs-et-permissions]] et [[Fonctionnalites-et-limites]].
