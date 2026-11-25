# Prévision de trésorerie par échéances

Ouvre **Trésorerie → Prévision de trésorerie**. Le rapport exige **Comptabilité en lecture et Ventes en lecture**, y compris pour le CSV et les résultats de recherche. Les droits Contacts et Taxes ne sont pas nécessaires; les noms proviennent des instantanés des pièces comptabilisées.

Choisis une **date de référence au plus tard aujourd’hui**, puis un horizon de **7, 30, 60 ou 90 jours** et **Appliquer**. Le solde initial correspond à la fin de la journée de référence; la projection commence le lendemain. Les filtres mal formés, répétés ou incohérents sont refusés, avec un lien de réinitialisation.

## Calcul et hypothèses

1. Addition des soldes comptabilisés de tous les comptes d’**actif BANK/CASH**, même inactifs, jusqu’à la date de référence incluse. Les cartes de crédit et fonds non déposés restent exclus. Un découvert conserve son signe négatif.
2. Lecture des factures clients et fournisseurs comptabilisées au plus tard à cette date, avec leur solde encore ouvert. Les affectations de paiements et crédits, leurs retraits et les contre-passations suivent leur propre date; une annulation ultérieure ne supprime pas la pièce de son historique.
3. Encaissement supposé des factures clients et paiement supposé des factures fournisseurs à l’échéance. Sans échéance, la date du document est utilisée. Les échéances déjà atteintes sont reportées au premier jour projeté avant les délais additionnels éventuels; celles après le dernier jour sont exclues et dénombrées.
4. Pour chaque jour : **clôture = ouverture + encaissements prévus − décaissements prévus**. Le graphique accompagne le tableau exact, le minimum, sa date et les jours terminant sous zéro. Le minimum tient aussi compte du solde initial; le premier solde négatif peut donc être celui de référence.

Exemple : au 30 juin, la banque contient 50,00 $. Une facture fournisseur échue de 114,98 $ est reportée au 1er juillet et une facture client ouverte de 64,98 $ arrive le 5 juillet. La projection descend à −64,98 $, puis revient à 0,00 $ le 5 juillet. Elle suppose que ces montants transitent par banque/caisse; elle ne prédit pas leur compte bancaire précis.

## Simuler les délais de règlement

Ouvre **Simuler les délais de règlement**, choisis séparément un **délai additionnel clients** et un **délai additionnel fournisseurs** de **0, 7, 14 ou 30 jours calendaires**, puis **Appliquer**. Zéro conserve la projection aux échéances. Les échéances déjà atteintes sont d’abord reportées au lendemain de la référence; le délai est ajouté ensuite. Les fins de semaine et jours fériés ne sont pas ajustés.

La comparaison montre les encaissements, décaissements, solde final, minimum et jours terminant sous zéro **sans délai additionnel** et **selon les hypothèses sélectionnées**. Les deux résultats utilisent le même solde initial et le même instantané des éléments ouverts. Les dates contractuelles, les affectations et les écritures restent inchangées; aucun ordre bancaire n’est envoyé et aucun scénario n’est enregistré.

Un montant déplacé après le dernier jour est exclu de la série sélectionnée, mais son **nombre et son total** sont indiqués séparément pour les encaissements et les décaissements reportés. Les factures déjà au-delà de l’horizon restent exclues. Le compteur général après l’horizon comprend les deux groupes; les comptes de contrôle restent rapprochés avec tous les éléments ouverts à la référence.

Exemple sur 30 jours au 30 juin : avec 50,00 $ en banque, une facture fournisseur échue de 114,98 $ et une facture client de 64,98 $ due le 5 juillet, la projection de référence descend à −64,98 $. Une hypothèse clients +7 jours et fournisseurs +14 jours place les mouvements aux 12 et 15 juillet : le solde final reste 0,00 $, avec un minimum de 0,00 $. Cela ne change pas l’obligation de payer le fournisseur à son échéance contractuelle.

Les liens de pagination, le CSV et **Impression / PDF complet** conservent les hypothèses. L’export contient les délais, la comparaison et les montants sortant de l’horizon, puis le détail de la projection sélectionnée avec les dates d’origine. **Retirer les délais additionnels** revient à la référence. Les paramètres `delai_clients` et `delai_fournisseurs` de l’adresse n’acceptent que les quatre valeurs autorisées; les valeurs vides, répétées ou mal formées sont refusées, y compris en CSV et impression.

![Comparaison des délais en français](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-delais-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-delais-mobile.png" alt="Comparaison des hypothèses sur mobile" width="412">

![Settlement assumptions in English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-delais-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-delais-en-dark-mobile.png" alt="Settlement assumptions, mobile dark theme" width="412">

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

## Impression et PDF complets

Depuis le rapport, ouvre **Impression / PDF complet**, puis **Imprimer / PDF**. Les dates et l’horizon sont conservés. La copie inclut **toutes les échéances projetées**, même en l’ouvrant depuis la deuxième page du détail, ainsi que les hypothèses, exclusions, contrôles, série quotidienne et soldes initiaux par compte. Le lien de retour retrouve la page du rapport.

Les données sont relues dans un nouvel instantané à l’ouverture de la copie : un mouvement comptabilisé entre les deux chargements peut donc changer les montants. Le dialogue d’impression utilise ensuite les valeurs déjà affichées; recharge la copie pour actualiser les données. Les mêmes droits Comptabilité + Ventes en lecture, règles de date et limites de 1 000 comptes / 5 000 éléments s’appliquent. Une erreur de filtre ou un refus de permission ne produit pas de copie partielle.

La mise en page papier est **paysage**, noire sur fond blanc, même depuis le thème sombre ou un écran mobile. Les en-têtes de tableau se répètent et les noms longs restent dans les colonnes. La navigation, les boutons et les liens internes vers les pièces sont retirés du papier. Le document contient le nom de l’entreprise, la date de référence, la période projetée et la devise CAD. Les notes privées et descriptions de lignes des pièces sources ne sont pas incluses.

Choisis **Enregistrer en PDF** dans le navigateur pour conserver une copie. Désactive ses en-têtes et pieds de page pour omettre l’adresse de la page. Il n’y a pas de génération PDF côté serveur ni de création d’écriture comptable. Les références sont produites avec Chromium et émulation mobile; les essais physiques Safari iOS restent à effectuer.

Les captures ordinateur montrent le rendu papier; les captures mobiles montrent l’aperçu à l’écran.

![Copie complète pour impression, français](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-impression-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-impression-mobile.png" alt="Copie complète sur téléphone" width="412">

![Paper output from the English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-impression-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-impression-en-dark-mobile.png" alt="Complete forecast print view, English dark theme, mobile" width="412">

## Références visuelles

Données fictives uniquement. Version française, ordinateur et téléphone :

![Prévision de trésorerie sur ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-mobile.png" alt="Prévision de trésorerie sur mobile" width="412">

Version anglaise avec thème sombre :

![Cash flow forecast, English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/previsions-tresorerie-en-dark-mobile.png" alt="Cash flow forecast, English dark theme, mobile" width="412">

Voir [[Budgets-annuels]], [[Budgets-mensuels]], [[Recherche-globale]] et [[Fonctionnalites-et-limites]].
