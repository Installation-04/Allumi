# Suivi de trésorerie comptabilisée

Ouvre **Trésorerie → Suivi de trésorerie**, ou le raccourci dans **Rapports**. Choisis la période et, au besoin, un compte, puis **Afficher**. La lecture et le CSV exigent seulement **Comptabilité en lecture**.

## Périmètre

Le suivi inclut les comptes d’**actif** de sous-type **BANK** ou **CASH**, actifs et inactifs. Les fonds non déposés, cartes de crédit, comptes clients et comptes fournisseurs sont exclus. Les types de comptes sont ceux du plan comptable; les noms et codes sont leur configuration actuelle.

Les chiffres proviennent des écritures validées du journal. Une transaction bancaire importée qui n’a pas d’écriture n’apparaît pas. Le solde affiché est comptable, et peut donc différer du solde d’un relevé bancaire.

Le suivi n’est pas un état réglementaire des flux de trésorerie par activité, ni une prévision. Il ne classe pas l’exploitation, l’investissement ou le financement. Une entrée n’est pas nécessairement un revenu : déposer un paiement enregistré auparavant dans les fonds non déposés augmente le périmètre BANK/CASH à la date du dépôt.

## Soldes et mouvements

Les dates de début et fin sont incluses. Sans dates valides dans l’adresse, la période reprend les règles des autres rapports : exercice courant jusqu’à aujourd’hui, dernier exercice disponible ou année civile.

- **Ouverture** : débits moins crédits cumulés avant le premier jour.
- **Entrées et sorties hors virements purs** : débits et crédits des comptes sélectionnés, séparément, durant la période.
- **Virements entrants et sortants** : mouvements d’écritures touchant exclusivement au moins deux comptes BANK/CASH de l’entreprise.
- **Clôture** : débits moins crédits cumulés jusqu’au dernier jour inclus.
- **Variation nette** : clôture moins ouverture.
- **Écart de contrôle** : ouverture + entrées − sorties + virements entrants − virements sortants − clôture.

La clôture de chaque compte correspond à son grand livre à la même date. Un découvert conserve son signe négatif. Les montants restent en cents entiers, y compris lors de l’agrégation.

Sur tous les comptes, les virements purs entrants et sortants se compensent. Sur un seul compte, ils restent visibles et participent à son évolution. La classification considère toute l’écriture et tous les comptes du périmètre, même lorsque le rapport affiche un seul compte.

Une écriture avec mouvements de trésorerie dans les deux sens qui n’est pas un virement pur est indiquée **Écriture mixte (brut)**. Par exemple, un transfert avec une ligne de frais reste affiché en brut; aucune partie n’est appariée ou estimée comme un transfert. Le nombre de ces écritures apparaît à l’écran et dans le CSV. Consulte le journal pour les analyser.

## Détail et export

Le détail montre la date, le numéro d’écriture, le compte, la description, la nature du mouvement, le débit et le crédit. Les liens ouvrent l’écriture ou le grand livre du compte. L’ordre est date, numéro d’écriture, numéro de ligne; la pagination compte 100 lignes. Les filtres sont conservés dans les liens de page et les raccourcis d’exercice.

Les comptes, leurs soldes, la classification et le détail sont lus dans un même instantané comptable. Les contre-passations suivent leur propre date; les exercices clôturés restent consultables. Aucun ajustement, aucune nouvelle écriture et aucune réouverture ne sont effectués. Un écart de contrôle est signalé et ne provoque aucune correction automatique.

**Exporter en CSV** contient le périmètre, la période, le récapitulatif de chaque compte, les totaux et contrôles, puis le détail complet de la sélection. Une limite de 200 000 lignes protège l’export : choisis une période plus courte ou un seul compte si elle est dépassée. Les totaux ne sont pas limités à la page affichée.

Le CSV est privé, sans cache, UTF-8 avec BOM; les séparateurs et décimales suivent FR/EN. Les textes pouvant être interprétés comme des formules sont neutralisés. Un compte invalide, inconnu, non bancaire/de caisse ou étranger à l’entreprise est refusé au lieu de devenir silencieusement « tous les comptes ».

Voir [[Grand-livre]], [[Etats-financiers]], [[Appariement-bancaire]], [[Rapprochement-bancaire]] et [[Fonctionnalites-et-limites]].

## Captures

Entreprise fictive; un virement pur de 40,00 $ laisse la variation totale inchangée à 580,00 $.

![Suivi de trésorerie sur ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/suivi-tresorerie-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/suivi-tresorerie-mobile.png" alt="Suivi de trésorerie sur téléphone" width="412">
