# Prévision de trésorerie par échéances

Ouvre **Trésorerie → Prévision de trésorerie**. Le rapport exige **Comptabilité en lecture et Ventes en lecture**, y compris pour le CSV et les résultats de recherche. Les droits Contacts et Taxes ne sont pas nécessaires; les noms proviennent des instantanés des pièces comptabilisées.

Choisis une **date de référence au plus tard aujourd’hui**, puis un horizon de **7, 30, 60 ou 90 jours** et **Appliquer**. Le solde initial correspond à la fin de la journée de référence; la projection commence le lendemain. Les filtres mal formés, répétés ou incohérents sont refusés, avec un lien de réinitialisation.

## Calcul et hypothèses

1. Addition des soldes comptabilisés de tous les comptes d’**actif BANK/CASH**, même inactifs, jusqu’à la date de référence incluse. Les cartes de crédit et fonds non déposés restent exclus. Un découvert conserve son signe négatif.
2. Lecture des factures clients et fournisseurs comptabilisées au plus tard à cette date, avec leur solde encore ouvert. Les affectations de paiements et crédits, leurs retraits et les contre-passations suivent leur propre date; une annulation ultérieure ne supprime pas la pièce de son historique.
3. Encaissement supposé des factures clients et paiement supposé des factures fournisseurs à l’échéance. Sans échéance, la date du document est utilisée. Les échéances déjà atteintes sont reportées au premier jour projeté; celles après le dernier jour sont exclues et dénombrées.
4. Pour chaque jour : **clôture = ouverture + encaissements prévus − décaissements prévus**. Le graphique accompagne le tableau exact, le minimum, sa date et les jours terminant sous zéro. Le minimum tient aussi compte du solde initial; le premier solde négatif peut donc être celui de référence.

Exemple : au 30 juin, la banque contient 50,00 $. Une facture fournisseur échue de 114,98 $ est reportée au 1er juillet et une facture client ouverte de 64,98 $ arrive le 5 juillet. La projection descend à −64,98 $, puis revient à 0,00 $ le 5 juillet. Elle suppose que ces montants transitent par banque/caisse; elle ne prédit pas leur compte bancaire précis.

## Exclusions et contrôles

Cette projection repose sur les échéances, **sans garantie de règlement ni de liquidités disponibles**. Elle ne déclenche aucun paiement et ne modifie aucune écriture, période ou piste d’audit.

- Les crédits, encaissements, décaissements et remboursements **non affectés** sont dénombrés mais ne sont pas compensés ou planifiés automatiquement. Consulte [[Age-des-comptes]] et [[Age-des-comptes-fournisseurs]] pour les analyser.
- Les écritures de trésorerie déjà datées **après la référence et dans l’horizon** sont exclues du modèle, avec leur nombre et leur montant net affichés. Cela évite de compter deux fois un règlement futur et la facture encore ouverte à la référence. Les virements purs entre comptes banque/caisse, de variation nette nulle, ne figurent pas dans cette alerte.
- Les brouillons, salaires, remises fiscales, prélèvements, ordres bancaires, récurrences et scénarios manuels ne sont pas prédits. Les dépenses déjà payées participent au solde initial si leur date le permet, sans nouvelle échéance.
- Le rapport rapproche les auxiliaires clients et fournisseurs **complets à la référence**, exclusions et échéances lointaines comprises, avec leurs comptes de contrôle. Un écart est affiché et ne crée aucun ajustement automatique. Analyse-le avant d’utiliser la projection.

Tous les soldes, éléments ouverts et contrôles sont lus dans un même instantané SQL de la société. Les montants restent en cents entiers. Le rapport est distinct du [[Suivi-de-tresorerie]] qui présente les mouvements effectivement comptabilisés durant une période.

## Détail et CSV

Le détail pagine **100 factures** et conserve les filtres; les totaux et la série quotidienne restent ceux du rapport entier. Les liens ouvrent les pièces sources. **Exporter en CSV** contient les hypothèses, dates, totaux, exclusions, écarts, jours, toutes les factures projetées et les soldes banque/caisse initiaux. Les noms et textes pouvant devenir des formules sont neutralisés. CSV UTF-8 avec BOM, privé et sans cache; séparateur et décimales selon FR/EN.

Limites : **1 000 comptes banque/caisse** et **5 000 éléments ouverts** en tout, incluant crédits, paiements, remboursements et factures après l’horizon. Au-delà, le rapport entier est refusé; aucune projection tronquée n’est affichée ou exportée. Aucune migration ni nouvelle variable de configuration n’est nécessaire.

## Références visuelles

Données fictives uniquement. Version française, ordinateur et téléphone :

![Prévision de trésorerie sur ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-mobile.png" alt="Prévision de trésorerie sur mobile" width="412">

Version anglaise avec thème sombre :

![Cash flow forecast, English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-en-dark-mobile.png" alt="Cash flow forecast, English dark theme, mobile" width="412">

Voir [[Budgets-annuels]], [[Budgets-mensuels]], [[Recherche-globale]] et [[Fonctionnalites-et-limites]].
