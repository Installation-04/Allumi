# Âge des comptes fournisseurs

Dans **Rapports → Âge des comptes fournisseurs**, choisis une date puis **Afficher**. Le rapport reconstitue les sommes dues à la fin de cette journée. L’accès en lecture au module Comptabilité suffit; il ne nécessite pas l’accès Ventes.

## Lire le rapport

Les factures fournisseurs encore ouvertes sont regroupées par fournisseur et selon leur échéance : **Courant**, **1–30**, **31–60**, **61–90** et **91 jours et plus**. Une facture due le jour choisi reste courante. Sans échéance, la date de la pièce sert de référence.

Les crédits fournisseurs et paiements non affectés réduisent le solde dans **Non appliqué**; les remboursements reçus non affectés l’augmentent. Ils ne sont pas répartis dans les tranches de retard. Un fournisseur peut donc avoir un solde négatif. Les dépenses immédiatement payées et les brouillons sont exclus.

Déplie **Détail par fournisseur** pour consulter les pièces, leurs dates, jours de retard et montants. Les liens ouvrent les factures, crédits et décaissements disponibles. Un remboursement sans page dédiée reste une ligne informative.

Le rapport utilise les dates comptables : une pièce comptabilisée après la date choisie n’apparaît pas. Une annulation ultérieure ne retire pas rétroactivement une pièce du rapport historique. Les affectations et leurs annulations sont également prises en compte à leur date respective. Ce n’est pas une prévision de paiement ni un ordre de virement.

## Comparer au grand livre

Le contrôle additionne les crédits moins les débits des comptes de sous-type **Comptes fournisseurs**, à la même date. Le détail et le contrôle sont lus dans un seul instantané de base de données.

Un écart nul confirme la concordance. Un écart est affiché, sans correction automatique, si le grand livre contient un montant que les pièces et paiements n’expliquent pas. Il reste visible même lorsqu’aucune pièce ouverte n’existe. Examine les écritures et les imports avec ton comptable avant de corriger.

## Noms et permissions

Les fournisseurs inactifs restent inclus si leur solde est ouvert. Le nom actuel du contact est utilisé lorsqu’il est accessible. Si l’accès Contacts est désactivé, le nom figé de la dernière facture comptabilisée à la date choisie sert de repli. Sans nom accessible ou figé, un tiret est affiché. Le lien vers la fiche contact est masqué si tu n’as pas cette permission.

Le rapport n’ajoute aucun droit d’écriture. L’isolation par entreprise et les permissions Comptabilité s’appliquent également à l’export.

## Export CSV

**Exporter en CSV** télécharge les pièces ouvertes, une ligne par pièce, puis les totaux. Les tranches et le montant non appliqué sont dans des colonnes distinctes. La date sélectionnée et le titre figurent en tête. Le contrôle du grand livre et son écart sont consultables à l’écran; ils ne sont pas ajoutés au CSV.

Le fichier est en UTF-8 avec marqueur BOM. En français, les colonnes sont séparées par des points-virgules et les décimales par des virgules; en anglais, les colonnes utilisent des virgules et les décimales des points. Les cellules de texte pouvant être interprétées comme des formules sont neutralisées. Le téléchargement n’est pas mis en cache.

Voir [[Factures-fournisseurs]], [[Etats-financiers]] et [[Grand-livre]].

## Captures

![Âge des comptes fournisseurs — ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/rapport-age-fournisseurs-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/rapport-age-fournisseurs-mobile.png" alt="Âge des comptes fournisseurs — téléphone" width="412">
