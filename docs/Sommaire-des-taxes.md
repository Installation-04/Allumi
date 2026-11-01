# Sommaire TPS/TVQ et autres taxes

Dans **Rapports → Sommaire TPS/TVQ**, choisis les dates **Du** et **Au**, puis **Afficher**. La consultation et le CSV exigent les permissions **Comptabilité en lecture** et **Taxes en lecture**. Les accès Ventes et Contacts ne sont pas nécessaires.

## Ce que le sommaire calcule

Il reprend les lignes du grand livre datées de la période, pour chaque taxe configurée, y compris une taxe inactive ayant des mouvements. Il ne recalcule pas les montants avec les taux actuels et ne dépend pas du statut actuel des factures. Les dates sont inclusives.

| Colonne | Calcul à partir des écritures |
|---|---|
| Perçue | Crédits moins débits, catégorie COLLECTED |
| Récupérable | Débits moins crédits, catégorie RECOVERABLE |
| Ajustements | Crédits moins débits, catégorie ADJUSTMENT |
| Net avant versements | Perçue − récupérable + ajustements |
| Versements / remboursements | Crédits moins débits, catégorie SETTLEMENT |
| Mouvement net | Net avant versements + versements / remboursements |

Un versement comptabilisé au débit du compte de taxes apparaît donc négatif; un remboursement reçu peut apparaître positif. Le signe des ajustements reflète leur effet au grand livre. Le crédit de taxe récupérable est uniquement le montant réellement porté dans RECOVERABLE; une portion non récupérable enregistrée en charges n’est pas ajoutée.

Les avoirs et contre-passations sont pris à leur date comptable. Une facture validée en juin puis annulée en juillet reste incluse dans juin; sa contre-passation apparaît en juillet et les deux s’annulent sur une période qui les couvre. Un encaissement ou décaissement ordinaire sans ligne de taxe ne modifie pas ce sommaire.

## Portée

Le rapport est un sommaire des écritures comptabilisées, et non une déclaration officielle ou un montant final à verser. Il ne reporte pas les soldes des périodes antérieures et ne remplit pas les cases d’un formulaire fiscal. Les méthodes de calcul ou ajustements réglementaires absents des écritures ne sont pas calculés automatiquement. Aucune déclaration, date de clôture ni écriture de versement n’est créée par cette page.

Les libellés et codes des taxes sont ceux de leur configuration actuelle. Les montants proviennent des écritures immuables. Vérifie les paramètres et les écritures nécessaires à ta méthode de déclaration avant utilisation.

## Contrôle et détail

Le contrôle compare le **mouvement net** aux crédits moins débits de tous les comptes de sous-type **Taxes de vente** sur la même période. Résumé, détail et contrôle sont lus dans un seul instantané de la base.

Une ligne non classée ou portée sur un compte incohérent est signalée dans **Lignes à vérifier**, même si plusieurs anomalies s’annulent et produisent un écart nul. Une ligne sans taxe/catégorie ne peut pas être affectée à une taxe du tableau; son mouvement reste dans le contrôle. Le lien **Vérifier le grand livre** aide à l’examiner. Le rapport ne corrige aucune écriture automatiquement.

Le détail montre les lignes de taxes classées, avec date, numéro interne d’écriture, taxe, catégorie, compte, description, débit et crédit. Le numéro ouvre l’écriture. Il est paginé par 100 lignes; les totaux portent toujours sur la période entière.

## Export CSV

L’export contient le sommaire, les totaux, le contrôle, l’écart et le nombre de lignes à vérifier, puis **tout** le détail classé. Il utilise UTF-8 avec BOM, les points-virgules et virgules décimales en français, ou les virgules et points décimaux en anglais. Les textes susceptibles d’être interprétés comme des formules sont neutralisés; les montants restent exacts et numériques.

Au-delà de 200 000 lignes, le téléchargement est refusé : réduis la période. Aucun fichier partiel n’est produit. L’export n’est pas mis en cache et suit les mêmes droits que la page.

Voir [[Taxes-et-catalogue]], [[Grand-livre]], [[Regles-comptables]] et [[Utilisateurs-et-permissions]].

## Captures

![Sommaire des taxes — ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/sommaire-taxes-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/sommaire-taxes-mobile.png" alt="Sommaire des taxes — téléphone" width="412">
