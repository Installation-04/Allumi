# Appariement des transactions bancaires

Une **transaction bancaire** (une ligne d'un relevé importé, [[Import-de-releves]], ou une ligne que Stripe ou PayPal rapporte, [[Integrations]]) n'entre dans les livres que de deux façons : en étant **appariée** à une écriture qui existe déjà au journal, ou en donnant lieu à une **nouvelle écriture**. **Banque et transactions → Transactions bancaires** les range, du plus récent au plus ancien.

Réservé aux **propriétaires** et aux **comptables** (les autres membres consultent). L'appariement ne change **jamais** le journal : il relie une ligne du relevé à une ou plusieurs lignes du grand livre **sur le même compte**. Le rapprochement bancaire de fin de période ([[Rapprochement-bancaire]]) vient ensuite.

## L'écriture probable

Sur chaque transaction à traiter, Allumi propose, quand elle existe, **l'écriture probable** : une ligne du grand livre sur **le même compte**, du **montant exact**, dans les **sept jours** de la transaction, pas encore appariée et qui n'est ni une contre-passation ni l'objet d'une contre-passation. Si plusieurs conviennent, la **plus proche en date** gagne. Un clic sur **Apparier** suffit. Rien n'est jamais apparié sans ce clic.

## Les trois façons de traiter une transaction

**Traiter** ouvre la fiche de la transaction, avec trois sections.

### 1. Apparier à des écritures existantes

La fiche liste les lignes du grand livre du compte qui ne sont appariées à rien, **dans les 45 jours** de la transaction (90 jours ou un an au choix), les plus proches d'abord. Cochez celles qui correspondent : une seule pour un paiement, **plusieurs** quand la banque a regroupé (un dépôt de trois chèques) ou retenu des frais (un versement Stripe : le paiement **brut** moins les **frais**, deux écritures). Un total courant montre l'**écart** avec la transaction; le serveur et la base exigent que le total soit **exactement** le montant de la transaction, au cent (au plus 20 lignes). Une ligne ne s'apparie qu'à **une** transaction.

### 2. Enregistrer dans les livres

Pour une dépense ou un revenu qui n'a pas encore d'écriture (des frais bancaires, un abonnement), choisissez **le compte de l'autre côté** : Allumi crée **une écriture de deux lignes**, datée comme la transaction, avec sa description comme note (modifiable) et la rattache aussitôt à la ligne du compte bancaire.

- **argent reçu** : débit du compte du relevé, crédit du compte choisi;
- **argent payé** : crédit du compte du relevé, débit du compte choisi.

Le compte choisi doit accepter les écritures manuelles (pas les comptes clients ni fournisseurs, qui passent par les factures et les paiements), et n'est pas celui du relevé. L'écriture est de source **Banque** : on la voit dans le [[Journal-et-ecritures]] avec un lien vers elle depuis la transaction. Elle est **immuable** comme toute écriture : on la corrige par une **contre-passation** (la page de l'écriture l'offre), puis en défaisant l'appariement de la transaction pour la traiter de nouveau. Tant qu'une écriture non contre-passée existe pour une transaction, Allumi refuse d'en faire une deuxième (« appariez-la plutôt ») : le même argent ne se compte pas deux fois.

Cette étape ne répartit pas les taxes : l'écriture porte le montant total sur le compte choisi. La ventilation de la TPS et de la TVQ d'une ligne de relevé viendra plus tard.

### 3. Virement entre vos comptes

Un paiement de carte de crédit, un versement Stripe au compte bancaire, un transfert vers l'épargne : l'argent sort d'un de vos comptes et entre dans un autre, et les **deux** relevés le montrent. Allumi cherche, sur **un autre compte**, une transaction à traiter de **montant exactement opposé** dans les **sept jours**; **Enregistrer le virement** crée **une seule écriture** de deux lignes (une par compte, datée de la **plus ancienne** des deux dates : l'argent est « en transit » jusque-là) et apparie chaque transaction à sa ligne.

## Défaire un appariement

**Défaire l'appariement** libère la transaction (elle redevient « à traiter ») et ses lignes du journal. Une **écriture créée** à partir de la transaction reste au journal (elle ne se supprime pas) : elle sera offerte comme écriture probable, ou contre-passez-la si elle était erronée. Refusé tant qu'un **rapprochement bancaire terminé** compte une des lignes : on rouvre d'abord le dernier rapprochement du compte ([[Rapprochement-bancaire]]). Un rapprochement en cours n'est qu'un travail et ne bloque rien. La base le refuse aussi (`bank_match_reconciled_guard`).

## Ce qui est refusé

- un total qui n'est pas le montant de la transaction, aucune ligne, plus de 20 lignes, une ligne d'un autre compte ou qui n'existe pas;
- une ligne déjà appariée à une autre transaction (deux demandes simultanées : une seule passe);
- une transaction déjà appariée ou mise de côté, ou en **autre devise** que le dollar canadien;
- une écriture faite dans une **période verrouillée** ou sans exercice;
- un virement entre deux lignes du même compte ou de montants qui ne s'annulent pas.

Un refus **n'enregistre rien** : l'écriture et les appariements d'une même demande sont faits ensemble, ou pas du tout.

## Sécurité

- Les rôles : l'appariement demande le droit de gérer la banque (propriétaire, comptable); créer une écriture demande aussi celui de passer des écritures. Un membre en lecture seule ne voit que les transactions.
- Tout est filtré par entreprise; chaque appariement et chaque écriture sont consignés dans la [[Piste-d-audit]].
- Les règles comptables (somme des lignes appariées, même compte, balance de l'écriture) sont vérifiées par le domaine **et** par la base ([[Regles-comptables]]).

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Transactions avec l'écriture probable](images/appariement-liste-desktop.png)
![Apparier plusieurs écritures à un dépôt](images/appariement-detail-desktop.png)
