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

Les immobilisations et stocks restent à venir. L’[[Age-des-comptes-fournisseurs]] est disponible dans Rapports. Les listes affichent au maximum 100 pièces; la liste des brouillons propose une recherche. Les sélecteurs de fournisseurs et d’articles sont limités à 500 entrées actives.

Voir aussi [[Taxes-et-catalogue]], [[Utilisateurs-et-permissions]] et [[Fonctionnalites-et-limites]].

## Paiements fournisseurs

Depuis une facture validée, le panneau Paiements permet de saisir un règlement partiel ou complet et affiche le solde à payer. Choisissez une banque, une encaisse ou une carte de crédit active. La date doit suivre la date comptable de la facture et ne pas être future. Un solde modifié par une autre opération impose de recharger la fiche. Le paiement débite les comptes fournisseurs et crédite le compte choisi. Sa fiche permet une annulation motivée dans une période ouverte; le solde de la facture est rétabli par contre-passation. Voir aussi Dépenses → Paiements fournisseurs pour l’historique paginé. Ces opérations enregistrent les paiements dans la comptabilité; elles n’émettent aucun virement bancaire.

![Paiement fournisseur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/paiement-fournisseur-desktop.png)

![Paiement sur téléphone](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/paiement-fournisseur-mobile.png)

## Préparer un crédit fournisseur

Depuis une facture validée, **Nouveau crédit fournisseur** permet de saisir un motif, une date au moins égale à la date comptable de la facture et un montant hors taxes pour chaque ligne corrigée. Laissez zéro pour exclure une ligne. Chaque montant est limité au montant original de sa ligne; les taux de taxes enregistrés sur la facture et son mode d’arrondi sont repris. Seules les factures avec taxes intégralement récupérables sont prises en charge.

Le brouillon se consulte dans **Dépenses → Crédits fournisseurs**. Les droits Comptabilité autorisent la consultation ou l’écriture. Il peut être modifié ou supprimé; une modification concurrente exige de recharger la fiche. Si la facture d’origine est annulée, le brouillon reste consultable et supprimable.

**Un brouillon ne crée aucune écriture, aucun numéro définitif, aucune réservation de montant et aucune réduction du solde fournisseur.** La validation et l’annulation sont maintenant disponibles depuis la fiche du crédit. Plusieurs brouillons peuvent donc corriger les mêmes montants; ils ne représentent pas des crédits validés.

![Brouillon de crédit fournisseur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/credit-fournisseur-brouillon-desktop.png)

![Brouillon sur téléphone](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/credit-fournisseur-brouillon-mobile.png)

## Valider et appliquer un crédit fournisseur

Ouvrez **Valider et affecter l’avoir**, choisissez une date comptable au moins égale à sa date de document et dans une période ouverte, puis confirmez. La validation attribue un numéro de la séquence d’achats `A-…`, débite les comptes fournisseurs et crédite les charges et taxes récupérables correspondantes. Les coordonnées du fournisseur proviennent de la facture figée. Le crédit est appliqué intégralement à sa facture d’origine dans la même transaction.

Les contrôles de l’application et de la base limitent les crédits validés cumulés aux montants originaux de chaque ligne, de chaque taxe et de la facture. Le solde encore à payer doit couvrir le crédit : un paiement ou un autre crédit concurrent peut empêcher la validation. Un nouvel essai d’une validation déjà réussie retourne le crédit existant sans écriture ni numéro supplémentaire.

Depuis la facture, consultez son nouveau solde et ses crédits. **Crédits fournisseurs → Avoirs validés** donne accès aux pièces et à l’historique daté des affectations.

![Crédit fournisseur validé](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/credit-fournisseur-valide-desktop.png)

![Crédit validé sur téléphone](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/credit-fournisseur-valide-mobile.png)

## Annuler un crédit validé

**Annuler l’avoir** demande un motif et une date dans une période ouverte, au moins égale à sa validation et à tous les événements d’affectation/retrait. L’application à la facture est retirée à cette date et une écriture inverse rétablit son solde. Le crédit original, son numéro et l’historique sont conservés. Un remboursement actif ou une affectation active à une autre facture bloque cette annulation. Les remboursements et la gestion manuelle d’affectations à d’autres factures ne sont pas proposés par cette interface.

Les crédits restent limités aux factures avec taxes entièrement récupérables ou sans taxe. La récupération partielle et les ajustements manuels de taxes restent indisponibles.

Pour les dépenses déjà réglées sans facture préalablement saisie, voir [[Depenses-payees]].

Les [[Justificatifs]] permettent de joindre des documents privés aux factures et crédits fournisseurs.
