# Import de relevés bancaires (CSV et OFX)

Un **relevé** est le fichier que votre banque ou l'émetteur de votre carte de crédit vous donne : les transactions d'un compte, sur une période. Allumi le lit et range chaque ligne dans **Banque et transactions → Transactions bancaires**, avec celles que Stripe et PayPal rapportent ([[Integrations]]).

**Ce que cela fait** : lire le fichier, montrer ce qui sera importé, enregistrer les lignes nouvelles. **Ce que cela ne fait pas** : aucune **écriture comptable** n'est créée, rien n'est apparié aux factures ni au journal, rien n'est rapproché. L'appariement et le rapprochement de fin de période sont les étapes suivantes de la phase 5 ([[Feuille-de-route]]).

## Importer un relevé

Réservé aux **propriétaires** et aux **comptables**. **Transactions bancaires → Importer un relevé** :

1. choisissez le **compte du plan comptable** que le relevé décrit : un compte de **banque**, de **caisse** ou de **carte de crédit** actif (créez-le au besoin dans le [[Plan-comptable]]);
2. choisissez le **fichier** : `.csv`, `.ofx` ou `.qfx`, jusqu'à **4 Mo** et 20 000 lignes. Les fichiers en UTF-8 (avec ou sans marque d'ordre des octets) et en Windows-1252 (accents d'un seul octet) sont lus correctement;
3. vérifiez l'**aperçu**, puis **Importer le relevé**.

L'aperçu est calculé **dans votre navigateur** avec le même code que le serveur : ce que vous voyez est ce qui sera lu (format, nombre de transactions, dates extrêmes, total des entrées et des sorties, les huit premières lignes). Le serveur **relit le fichier** au moment de l'import et ne fait confiance à rien de ce que le navigateur annonce.

### Le signe d'un montant

Le montant d'une ligne est son **effet sur le compte** : une entrée d'argent est **positive**, une sortie **négative**. C'est vrai aussi pour une carte de crédit : un achat est une sortie (il augmente ce que vous devez). Les fichiers OFX suivent déjà cette convention. Beaucoup de relevés CSV de carte montrent un achat en **positif** : cochez **Inverser les signes** et vérifiez les totaux de l'aperçu.

### Un fichier CSV

Les colonnes sont reconnues d'après l'en-tête et les valeurs (date, description, montant ou deux colonnes sorties/entrées); sinon, vous les choisissez :

- **la première ligne est un en-tête** ou non;
- **date** : colonne et ordre (`2026-10-15`, `15/10/2026`, `10/15/2026`, avec `-`, `/` ou `.`, année à deux chiffres, `20261015`, heure ignorée). Seule une date qui existe au calendrier est acceptée;
- **description** : une colonne, et une deuxième facultative (les textes sont joints);
- **montants** : une colonne signée, ou **deux colonnes** (sorties, entrées) comme en écrivent plusieurs banques; séparateur décimal point ou virgule. Sont lus : `1 234,56`, `1,234.56`, `-$12.30`, `(45.00)`, `12.30-`. Un montant qui n'est pas **exactement** un montant (une troisième décimale, une lettre) est une ligne illisible : Allumi ne devine pas.

Une ligne **illisible** (date ou montant) est signalée avec son **numéro de ligne** dans l'aperçu, et **l'import est refusé tant qu'il en reste**. Les lignes **vides** et les lignes **à zéro** sont ignorées et comptées. Les colonnes choisies sont **retenues pour le compte** et proposées au prochain import, mais seulement si elles lisent le nouveau fichier sans erreur (le fichier d'une autre banque repart de la suggestion).

### Un fichier OFX ou QFX

Lu tel quel (OFX 1.x en SGML ou 2.x en XML, compte bancaire ou carte). Chaque transaction a son **identifiant** de la banque (`FITID`), qui sert à ne l'importer qu'une fois. La date est celle du fichier, **sans conversion de fuseau horaire**. L'aperçu affiche la devise, les quatre derniers chiffres du compte et le **solde de clôture déclaré** : il servira au rapprochement.

## Ce qui est refusé, et pourquoi

- un fichier **vide**, de plus de 4 Mo ou de plus de 20 000 lignes, ou **illisible** (guillemet non fermé, cellule trop longue, trop de colonnes);
- un relevé **dans une autre devise** que le dollar canadien (les livres d'Allumi n'ont qu'une devise);
- un compte qui n'est **pas** une banque, une caisse ou une carte de crédit, ou qui est inactif;
- le **même fichier** (même contenu, quel que soit son nom) déjà importé sur ce compte;
- des lignes illisibles, ou un CSV dont les colonnes ne sont pas choisies.

Un refus **n'enregistre rien**.

## Relevés qui se chevauchent

On peut importer le relevé d'octobre, puis celui d'octobre et novembre : une ligne **déjà connue** est laissée **telle quelle** et comptée (« 3 lignes étaient déjà connues »), seules les nouvelles sont ajoutées. Une ligne OFX est reconnue par l'identifiant de la banque; une ligne CSV, par sa date, son montant, sa description (sans égard à la casse, aux accents ni aux espaces) et son **rang parmi les lignes identiques du même fichier** : deux cafés identiques le même jour sont deux lignes, et un relevé suivant qui en contient trois n'ajoute que la troisième. Deux imports simultanés sur le même compte se suivent (le compte est verrouillé) : jamais de doublon.

## Les transactions bancaires

**Banque et transactions → Transactions bancaires** liste les lignes de tous les comptes, du plus récent au plus ancien, 50 par page : date, description, bénéficiaire, montant, **état** (à traiter, rapprochée, mise de côté), compte et **origine** (le fichier, ou le service Stripe/PayPal avec brut, frais et référence). Filtres : compte, connexion, état, recherche dans la description et le bénéficiaire (un texte, pas un motif). Tous les membres consultent; les propriétaires et les comptables **mettent de côté** une ligne (un doublon, ce qui n'est pas du ressort des livres) et la remettent à traiter. Une ligne importée ne change jamais d'autre façon et ne se supprime jamais.

## Sécurité et vie privée

- Le **fichier n'est pas conservé** : seuls restent son nom, son empreinte SHA-256 (pour refuser un second import), le format et le nombre de lignes ajoutées, avec les lignes elles-mêmes.
- Un relevé contient des renseignements sur des tiers (noms de bénéficiaires, descriptions de virements) : ils sont conservés tels que la banque les écrit, dans la table des transactions, sous la même isolation par entreprise que le reste. Les descriptions sont nettoyées (pas de caractères de contrôle, 200 caractères au plus). Voir [[Securite-et-Loi-25]].
- Les montants sont des **cents exacts** (jamais de décimale flottante); toute ligne est vérifiée par le domaine et par la base (compte de type banque, montant non nul, identifiant unique par compte).
- L'import est consigné dans la [[Piste-d-audit]] (qui, quand, quel fichier, combien de lignes).

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Import d'un relevé sur téléphone](images/releves-import-mobile.png)
![Transactions bancaires](images/releves-transactions-desktop.png)
