# Grand livre

Le **grand livre** est le détail d'un compte sur une période : son **solde au début**, chaque **ligne du journal** qui l'a touché avec le **solde qui suit**, et son **solde à la fin**. Calculé à chaque ouverture depuis le journal, en cents exacts. Tous les membres qui lisent le journal (propriétaires, comptables, lecture seule) le consultent et l'exportent : **Rapports → Grand livre** (`/c/<entreprise>/grand-livre`).

Il complète la balance de vérification, l'état des résultats et le bilan ([[Journal-et-ecritures]], [[Etats-financiers]]).

## Un compte

Choisissez le **compte** et la **période** (du jour au jour **inclus**; par défaut l'exercice en cours jusqu'à aujourd'hui, les exercices s'ouvrent en un clic) :

- le **solde d'ouverture** est celui du compte la veille du premier jour de la période;
- les **lignes** sont dans l'ordre du grand livre : par **date**, puis par **numéro d'écriture**, puis par numéro de ligne. Chacune montre la date, l'écriture (un lien vers le [[Journal-et-ecritures]]), la description, le contact s'il y en a un (un client sur une ligne de comptes clients), le **débit**, le **crédit** et le **solde** après la ligne. Une écriture **contre-passée**, et la contre-passation elle-même, sont signalées;
- le **solde de clôture** est celui de la fin de la période; il est égal à la ligne du compte au bilan de ce jour-là;
- au-delà de **100 lignes**, la liste se lit **par pages** : les soldes se suivent d'une page à l'autre, sans écart.

### Le sens des soldes

Un solde est dans le **sens habituel** du compte : un **actif** ou une **charge** augmente par le débit, un **passif**, un **capital** ou un **revenu** par le crédit. Un compte à solde « inverse » (une banque à découvert, un revenu remboursé) a un solde **négatif**.

## Exporter en CSV

Deux fichiers : **ce compte**, ou **tous les comptes** qui ont bougé ou qui ont un solde pendant la période. Le fichier est **à plat** pour qu'un tableur le filtre ou le trie : chaque ligne porte son compte; chaque compte a une ligne **solde d'ouverture** et une ligne **solde de clôture** (avec les débits et les crédits de la période). Colonnes : compte, libellé, date, écriture, description, contact, débit, crédit, solde.

Mêmes règles que les autres exports ([[Etats-financiers]]) : UTF-8 avec marque d'ordre des octets, **séparateur et virgule décimale selon la langue**, montants exacts sans séparateur de milliers, protection contre l'injection de formule, jamais mis en cache. Le nom du fichier porte le compte et la période : `grand-livre_1000_2026-01-01_2026-12-31.csv`, `grand-livre_tous-les-comptes_….csv`. Un fichier de tous les comptes est refusé au-delà de **200 000 lignes** : choisissez une période plus courte ou un seul compte.

## Ce qui n'est pas inclus

Filtrer par projet ou montant; regrouper plusieurs comptes; PDF; comparer deux périodes : à venir ([[Feuille-de-route]]).

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Grand livre d'un compte](images/rapport-grand-livre-desktop.png)
![Grand livre sur téléphone](images/rapport-grand-livre-mobile.png)

## Filtrer par contact

Le sélecteur **Contact** limite les lignes et tous les soldes au contact choisi, sous permissions Comptabilité et Contacts. Les raccourcis, pages et deux CSV conservent le filtre; une recherche permet de retrouver les contacts historiques. Voir [[Grand-livre-par-contact]] pour le périmètre et les limites.

## Sélection du compte dans l’adresse

Un identifiant de compte mal formé, inconnu, étranger à l’entreprise ou répété dans l’adresse est refusé, à l’écran et dans le CSV. Il n’est jamais interprété comme **tous les comptes**. L’absence de compte ou une valeur vide conserve le parcours normal : choisir un compte à l’écran ou exporter tous les comptes explicitement.
