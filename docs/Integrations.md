# Intégrations : Stripe et PayPal

Une **intégration** relie Allumi à un service externe pour **importer ses transactions** (paiements reçus, frais, remboursements, virements) dans une boîte de réception. Les premiers services sont **Stripe** et **PayPal**; l’architecture est faite pour en ajouter d’autres (voir plus bas).

**Ce que cela fait** : lire les transactions du service, les convertir en un format commun (montant net, brut, frais, devise, date, type) et les ranger dans **Banque et transactions → Transactions importées**.

**Ce que cela ne fait pas** : l’**import** ne crée aucune **écriture comptable**, n’enregistre aucun paiement sur une facture et ne rapproche rien automatiquement. Le rapprochement avec les factures, les paiements enregistrés et le journal viendra ensuite (phase 5, voir [[Feuille-de-route]]). Il n’y a pas non plus de webhook : un serveur auto-hébergé n’est en général pas joignable depuis Internet, et tout ce qui est décrit ici ne demande que des appels **sortants**.

**Paiement en ligne des factures** : avec Stripe, le propriétaire peut en plus créer, pour une facture validée, un **lien de paiement** hébergé par Stripe et enregistrer le paiement reçu : voir la section « Paiement en ligne des factures (Stripe) » plus bas. PayPal n’offre pas encore cette fonction.

## Connecter un service

Réservé au **propriétaire** de l’entreprise. **Banque et transactions → Intégrations**, puis **Connecter Stripe** ou **Connecter PayPal** :

- **Nom** de la connexion (unique pour ce service);
- **Compte du plan comptable** (type banque) dont le service tient le solde. Au besoin, créez d’abord un compte « Stripe » ou « PayPal » de type banque dans le [[Plan-comptable]];
- **Importer à partir du** : première journée importée (PayPal garde trois ans d’historique);
- les **clés** du service :
  - **Stripe** : une clé d’API **restreinte** est recommandée : « Transactions de solde » en lecture suffit pour l’import; pour le paiement en ligne, ajoutez l’écriture sur « Prix » et « Liens de paiement » et la lecture sur « Sessions Checkout » et « PaymentIntents ». Une clé secrète `sk_` fonctionne aussi. Une clé publique `pk_` est refusée. Une clé de test (`_test_`) crée une connexion d’**essai**;
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

## Paiement en ligne des factures (Stripe)

Réservé au **propriétaire**, sur une connexion Stripe active. Rien ne demande une adresse publique ni un webhook : Allumi **appelle** Stripe pour créer la page, puis, quand vous le demandez, **regarde** si elle a été payée.

**Mise en place** (une fois) : sur la fiche de la connexion, choisissez le **compte des frais de traitement** (un compte de charges, par exemple « 6010 · Frais bancaires »). Sans lui, aucun lien n’est offert. Le changement vaut pour les paiements enregistrés à partir de ce moment; les écritures déjà passées gardent leur compte.

**Créer un lien** : sur une facture validée qui a un solde, section **Paiement en ligne**, **Créer un lien de paiement**. Le lien vaut pour le **solde actuel** et pour **un seul paiement** (la page se ferme d’elle-même après un paiement). Envoyez son adresse à votre client; il paie par carte sur la page de Stripe, et Allumi ne voit jamais le numéro de carte. Une facture n’a qu’**un lien en cours** à la fois (la base l’impose) : si le solde change (un autre paiement, un avoir), annulez le lien et créez-en un autre.

**Enregistrer le paiement** : **Vérifier le paiement** sur la facture (ou **Vérifier les paiements en ligne** sur la fiche de la connexion, pour tous les liens d’un coup). Pour chaque paiement réglé, Allumi crée **en une seule transaction** :

1. l’**encaissement** au montant **brut** payé par le client, sur le **compte de la connexion**, appliqué à la facture (numéroté comme tout encaissement : voir [[Encaissements]]);
2. une **écriture des frais** à part : charge au compte des frais de traitement, crédit au compte de la connexion, pour les frais que Stripe a retenus;
3. le paiement en ligne (la session Stripe, l’encaissement, l’écriture des frais, brut, frais, net) et le lien marqué **Payé**.

Le solde du compte de la connexion égale ainsi le **net** que Stripe verse, comme la transaction importée correspondante. L’encaissement et les frais sont des écritures séparées parce que la base exige qu’un encaissement égale exactement le montant appliqué à la facture. La date comptable est le jour du paiement chez Stripe, dans le fuseau horaire de l’entreprise.

**Sûreté** : regarder deux fois, ou deux personnes en même temps, n’enregistre rien en double (la session Stripe est unique, le lien est verrouillé pendant l’enregistrement). Les requêtes qui créent un prix ou une page portent une **clé d’idempotence** : si la réponse de Stripe se perd, **Reprendre la création** retrouve ce que le premier essai a fait au lieu d’en faire un second (Stripe garde ces clés 24 heures).

**Quand Allumi ne peut pas enregistrer le paiement**, rien n’est écrit dans les livres et le lien passe à **À vérifier**, avec la raison : le solde a changé depuis la création du lien (un autre encaissement, un avoir), la facture a été annulée, la période comptable est verrouillée ou la date précède la facture, le compte de la connexion n’accepte pas d’encaissement, le compte des frais a disparu, le montant ou les frais rapportés ne concordent pas, ou Stripe a réglé dans une autre devise que le dollar canadien. L’argent est quand même arrivé chez Stripe : il figure dans les transactions importées. Enregistrez l’encaissement à la main au besoin, puis **fermez le signalement**.

**Annuler un lien** ferme d’abord la page chez Stripe, puis regarde une dernière fois : un paiement arrivé entre-temps est enregistré (le lien n’est alors pas annulé). Si la connexion est déconnectée, le lien est annulé ici mais la page reste ouverte chez Stripe : fermez-la dans votre tableau de bord. Un **deuxième paiement** reçu sur un lien déjà payé (deux clients passés avant la fermeture) n’est pas enregistré : le résultat le signale, remboursez-le dans Stripe.

**Limites** : dollars canadiens seulement; de 0,50 $ à 999 999,99 $ par lien (les limites de Stripe); ni remboursement, ni litige, ni acompte, ni paiement partiel d’un lien (un remboursement chez Stripe apparaît dans les transactions importées; enregistrez-le comme un remboursement quand ce lot existera); pas de vérification automatique : c’est un bouton, comme la synchronisation. Annuler l’encaissement d’un paiement en ligne (**Annuler cet encaissement**) ne rembourse pas le client et n’annule pas l’écriture des frais : remboursez dans Stripe, puis corrigez les écritures à la main.

## Sécurité et vie privée

- **Ce qui part vers Stripe** pour une page de paiement : le montant du solde, la devise, le libellé « Facture F-00012 » et l’identifiant interne du lien. Ni le nom ni les coordonnées du client, ni le nom de l’entreprise n’y sont envoyés.
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
- **Pages de paiement Stripe** : les appels (prix, lien de paiement avec `restrictions[completed_sessions][limit]`, sessions Checkout d’un lien, PaymentIntent avec `expand[]=latest_charge.balance_transaction`) suivent la documentation, mais n’ont jamais été essayés contre un compte Stripe, même en mode test. À confirmer en mode test avant tout usage réel : la création d’un lien, un paiement avec la carte de test `4242 4242 4242 4242`, puis « Vérifier le paiement » (encaissement au brut, frais, solde du compte égal au net), les permissions de la clé restreinte, et un paiement refusé ou en traitement.
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
![Fiche d’une connexion : compte des frais et vérification des paiements](images/paiement-en-ligne-connexion-desktop.png)
![Facture avec un lien de paiement prêt](images/paiement-en-ligne-facture-desktop.png)
![Paiement à vérifier sur téléphone](images/paiement-en-ligne-a-verifier-mobile.png)
