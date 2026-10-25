# Intégrations : Stripe et PayPal

Une **intégration** relie Allumi à un service externe pour **importer ses transactions** (paiements reçus, frais, remboursements, virements) dans une boîte de réception. Les premiers services sont **Stripe** et **PayPal**; l’architecture est faite pour en ajouter d’autres (voir plus bas).

**Ce que cela fait** : lire les transactions du service, les convertir en un format commun (montant net, brut, frais, devise, date, type) et les ranger dans **Banque et transactions → Transactions importées**.

**Ce que cela ne fait pas** (volontairement, pour cette première étape) : aucune **écriture comptable** n’est créée, aucun paiement n’est enregistré sur une facture, aucune transaction n’est rapprochée automatiquement. Le rapprochement avec les factures, les paiements enregistrés et le journal viendra ensuite (phase 5, voir [[Feuille-de-route]]). Il n’y a pas non plus de paiement en ligne sur les factures ni de webhook : un serveur auto-hébergé n’est en général pas joignable depuis Internet, et l’import ne demande que des appels **sortants**.

## Connecter un service

Réservé au **propriétaire** de l’entreprise. **Banque et transactions → Intégrations**, puis **Connecter Stripe** ou **Connecter PayPal** :

- **Nom** de la connexion (unique pour ce service);
- **Compte du plan comptable** (type banque) dont le service tient le solde. Au besoin, créez d’abord un compte « Stripe » ou « PayPal » de type banque dans le [[Plan-comptable]];
- **Importer à partir du** : première journée importée (PayPal garde trois ans d’historique);
- les **clés** du service :
  - **Stripe** : une clé d’API **restreinte en lecture seule** (permission « Transactions de solde » : lecture) est recommandée; une clé secrète `sk_` fonctionne aussi. Une clé publique `pk_` est refusée. Une clé de test (`_test_`) crée une connexion d’**essai**;
  - **PayPal** : l’identifiant et le secret d’une application REST dont la fonction **Transaction Search** est activée, et l’environnement (**production** ou **bac à sable**). PayPal peut mettre jusqu’à **trois heures** à rapporter une transaction.

Allumi **vérifie les clés auprès du service avant de rien enregistrer** : un refus (clés invalides, permission manquante, service indisponible) s’explique par un message et ne laisse aucune connexion. Les clés sont ensuite **chiffrées** et ne sont **plus jamais affichées** : seule la fin de la clé (4 caractères) permet de la reconnaître.

Une connexion d’essai importe des transactions fictives : pointez-la vers un compte d’essai, pas vers vos vrais comptes.

## Synchroniser

Sur la fiche de la connexion, **Synchroniser maintenant** (propriétaire). Allumi lit les transactions par **fenêtres** d’au plus 31 jours, de la plus ancienne à la plus récente, à partir du dernier point atteint (moins deux jours de chevauchement, pour récupérer une transaction arrivée en retard) :

- l’import est **idempotent** : une transaction déjà importée est laissée telle quelle (son identifiant externe est unique par compte). Resynchroniser est toujours sans risque;
- chaque fenêtre est enregistrée **avec son point d’arrivée, en une seule transaction** : une panne ou un refus laisse tout comme avant cette fenêtre, et la synchronisation suivante reprend là où elle s’était arrêtée;
- une seule synchronisation à la fois par connexion (un verrou qui expire après dix minutes si un passage a échoué brutalement);
- un passage lit au plus **24 fenêtres** (environ deux ans) et s’arrête après 40 secondes : pour un long historique, relancez le bouton; le résultat l’indique;
- une fenêtre trop chargée pour être lue d’un trait est **coupée en deux** automatiquement;
- le résultat indique le nombre de transactions importées et ignorées (devise sans cents, transaction non réglée).

Il n’y a **pas de synchronisation planifiée** pour l’instant : c’est un bouton. Un échec est conservé sur la fiche sous forme d’un **code** compris par la personne (clés refusées, permission manquante, service indisponible, réponse inattendue…), jamais du texte renvoyé par le service, qui pourrait citer une clé.

## Transactions importées

Chaque ligne montre le **montant net** (l’effet sur le solde du service, comme une ligne de relevé), le **brut** et les **frais** (`brut − frais = net`), la **devise**, le **type** (paiement, remboursement, virement, frais, litige, ajustement) et la **référence** quand le service en donne une (par exemple le numéro de facture de PayPal). On peut **mettre de côté** une transaction (un essai, un doublon) et la remettre à traiter; une transaction importée ne change jamais d’autre façon, comme n’importe quelle ligne de relevé.

Les montants sont des **cents exacts** (jamais de décimale flottante). Les **devises sans cents** (yen, won…) ou à trois décimales sont **ignorées et comptées**, plutôt que mal converties. Une transaction dans une autre devise que le dollar canadien est importée telle quelle, avec sa devise : Allumi ne fait **aucune conversion de change**.

Allumi **refuse** toute réponse qui n’a pas la forme documentée ou dont les chiffres ne concordent pas (`net ≠ brut − frais`) : la synchronisation s’arrête avec le message « réponse inattendue » et **rien** de la fenêtre fautive n’est importé.

## Sécurité et vie privée

- **Clés chiffrées** en AES-256-GCM avec `ENCRYPTION_KEY`, par une clé dérivée propre à cet usage, et **liées à leur connexion** : un blob copié vers une autre connexion ou une autre entreprise ne se déchiffre pas. Elles vivent dans une table à part que **seul le propriétaire peut lire** (la base l’impose); elles ne sont jamais affichées, journalisées ni copiées dans la [[Piste-d-audit]] (seul « clés modifiées » y figure).
- Les clés voyagent dans un **en-tête**, jamais dans une adresse. Les adresses des services sont **fixes** dans le code (`api.stripe.com`, `api-m.paypal.com` et son bac à sable); aucune adresse ne vient de la saisie, et **aucune redirection** n’est suivie.
- **Minimisation (Loi 25)** : PayPal n’est interrogé que pour `transaction_info` : ni nom, ni courriel, ni adresse de client n’entrent dans Allumi. Les transactions de solde de Stripe n’en portent pas non plus; seule la **description** donnée par le service est conservée telle quelle (elle peut contenir un nom si vous l’y mettez vous-même). Voir [[Securite-et-Loi-25]].
- Une connexion n’est **jamais supprimée** : on la **déconnecte** (l’import s’arrête et la clé chiffrée est effacée; ce qui a été importé reste). Son service, son compte, son environnement et sa date de départ ne changent pas : on en crée une autre. **Remplacer les clés** vérifie les nouvelles clés et exige le même environnement (une clé de test ne remplace pas une clé de production).
- **Perdre ou changer `ENCRYPTION_KEY`** rend les clés enregistrées illisibles : la synchronisation affiche « les clés enregistrées sont illisibles » et il faut les remplacer (voir [[Configuration]] et [[Sauvegardes]]).

Qui fait quoi : tous les membres consultent les connexions et les transactions importées; le propriétaire connecte, synchronise, remplace les clés et déconnecte; le propriétaire et les comptables mettent une transaction de côté.

## Ce qui n’a pas été vérifié en conditions réelles

Les connecteurs sont écrits d’après la **documentation officielle** de Stripe (liste des transactions de solde) et de PayPal (Transaction Search), et testés contre des **simulations fidèles à cette documentation** (pagination, filtres de dates, fenêtre de 31 jours, authentification). Aucun appel n’a été fait à un vrai compte depuis le développement. À confirmer avec des clés d’essai (mode test de Stripe, bac à sable PayPal) avant tout usage réel :

- **Signe des frais PayPal** : la documentation ne dit pas si `fee_amount` est négatif quand des frais sont prélevés. Allumi le traite comme un effet signé sur le solde (un paiement reçu a des frais négatifs), conserve les chaînes d’origine avec chaque transaction et **signale « À vérifier »** toute transaction dont le signe des frais est inhabituel. Comparez la première synchronisation au rapport de PayPal.
- **Format des dates** envoyées à PayPal (`AAAA-MM-JJThh:mm:ss+0000`, comme dans ses réponses) et **permissions** exigées par la clé restreinte de Stripe.
- Les identifiants des transactions PayPal peuvent se répéter dans les rapports : Allumi les combine avec le code d’événement.

## Ajouter un autre service

Un service est **trois pièces** : sa définition (les champs de ses clés, dans `domain/provider.ts` et `domain/credentials.ts`), un **convertisseur** vers le format commun (`domain/`, pur et testé) et un **connecteur** (vérifier les clés, lire une fenêtre; `connectors/`). La connexion, la synchronisation, le chiffrement, l’audit, la boîte de réception et les écrans n’ont pas à changer. Pistes envisagées, sans engagement :

- **Square** : paiements et virements, de forme voisine de Stripe;
- **Flux bancaires canadiens** : via un agrégateur (Plaid, Flinks), ce qui suppose un contrat et des frais avec l’agrégateur;
- **Shopify / WooCommerce** : commandes et versements d’une boutique en ligne;
- **Moneris / Interac e-Transfert** : l’accès se fait surtout par fichier (CSV) ou entente de partenaire, rarement par une interface publique; le CSV relève de l’import bancaire de la phase 5.

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Connexions](images/integrations-desktop.png)
![Fiche d’une connexion](images/integration-connexion-desktop.png)
![Transactions importées](images/transactions-importees-desktop.png)
![Transactions importées sur téléphone](images/transactions-importees-mobile.png)
