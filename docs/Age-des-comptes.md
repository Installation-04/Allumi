# Âge des comptes clients

Le rapport d'**âge des comptes clients** montre **ce que vos clients vous doivent à un jour donné**, classé selon le nombre de jours écoulés depuis l'échéance de chaque facture. Il est calculé à chaque ouverture depuis les factures, les avoirs et les encaissements, en cents exacts. Les membres qui ont accès à la comptabilité **et** aux ventes (par défaut, tous les rôles) le consultent et l'exportent; retirer l'un de ces deux accès à un membre ([[Utilisateurs-et-permissions]]) lui ferme le rapport : **Rapports → Âge des comptes clients**, ou **Ventes** (`/c/<entreprise>/age-clients`).

Il complète le journal, le grand livre et les états financiers ([[Journal-et-ecritures]], [[Grand-livre]], [[Etats-financiers]]), et se lit avec les factures et les encaissements ([[Brouillons-de-factures]], [[Encaissements]]).

## Ce que le rapport montre

Choisissez le **jour** (par défaut aujourd'hui). Pour chaque client, les factures **encore ouvertes** à ce jour sont classées en **tranches** selon les jours de retard :

| Tranche | Jours écoulés depuis l'échéance |
|---|---|
| Courant | pas encore échue, ou échue aujourd'hui |
| 1–30 jours | de 1 à 30 jours |
| 31–60 jours | de 31 à 60 jours |
| 61–90 jours | de 61 à 90 jours |
| 91 jours et plus | plus de 90 jours |

Une facture compte pour son **solde ouvert**, pas pour son total : un encaissement partiel ou un avoir appliqué le réduit. Une facture entièrement payée ou créditée n'y figure pas. À défaut d'échéance, la date de la facture sert de repère. Les brouillons n'y figurent jamais.

La colonne **Non appliqué** reçoit ce qui n'est pas encore rattaché à une facture : un avoir ou un encaissement non appliqué (en **moins**, puisqu'il réduit ce que le client doit) et un remboursement non appliqué (en plus). Ces montants n'ont pas d'échéance : ils ne sont dans aucune tranche. Aujourd'hui, un encaissement s'applique à une facture dès son enregistrement et un avoir s'applique en entier à sa validation : la colonne reste donc à zéro dans l'usage courant, mais elle empêche un montant de se perdre dans les totaux dès qu'il n'est plus rattaché.

Le **total** de chaque client et le **total général** s'additionnent exactement : tranches + non appliqué.

### Le détail d'un client

Dépliez un client pour voir chaque pièce : son type, son **numéro** (un lien vers la facture, l'avoir ou l'encaissement), sa date, son échéance, ses **jours de retard** (« Non échue » avant l'échéance) et son montant.

## Un jour passé

Les paiements et les avoirs ne s'effacent jamais ([[Regles-comptables]]) : ils portent la date à laquelle ils ont été appliqués, et la date à laquelle ils ont été retirés s'il y a lieu. Le rapport d'un **jour passé** redonne donc ce qu'il était **ce jour-là**, même si des paiements ont été enregistrés depuis.

Exemple : une facture de 1 000,00 $ échue le 1er juillet, payée 400,00 $ le 10 juillet.

| Au | Solde ouvert | Tranche |
|---|---|---|
| 30 juin | 1 000,00 $ | Courant |
| 5 juillet | 1 000,00 $ | 1–30 jours |
| 10 juillet | 600,00 $ | 1–30 jours |
| 1er août | 600,00 $ | 31–60 jours |

Une pièce annulée compte **jusqu'à la veille** du jour de son annulation : le jour de l'annulation, une facture annulée disparaît; un encaissement annulé disparaît et la facture qu'il réglait est de nouveau ouverte.

## Concordance avec le grand livre

Sous le tableau figurent le **solde des comptes clients au grand livre** au même jour et l'**écart** avec le total du rapport. Les comptes clients n'acceptent que des écritures issues de documents et de paiements, toujours avec un contact, et la base vérifie qu'elles correspondent à leur pièce ([[Regles-comptables]], [[Schema-de-donnees]]) : **l'écart est donc toujours nul**. S'il ne l'était pas, il s'afficherait en rouge : c'est une anomalie à examiner dans les écritures des comptes clients, jamais un état normal.

## Exporter en CSV

Un fichier **à plat** pour un tableur : une ligne par pièce ouverte, avec le client, le type, le numéro, la date, l'échéance, les **jours de retard** (zéro ou négatif quand la pièce n'est pas encore échue), le montant dans sa **tranche** ou dans **Non appliqué**, et le total de la ligne; puis une ligne de **total**.

Mêmes règles que les autres exports ([[Etats-financiers]]) : UTF-8 avec marque d'ordre des octets, **séparateur et virgule décimale selon la langue**, montants exacts sans séparateur de milliers, protection contre l'injection de formule (le nom d'un client qui commence par `=` serait exécuté par un tableur : il est précédé d'une apostrophe), jamais mis en cache. Le nom du fichier porte le jour : `age-des-comptes-clients_2026-07-02.csv`.

## Ce qui n'est pas inclus

L’[[Age-des-comptes-fournisseurs]] est un rapport distinct, disponible dans Rapports.

- Les rappels de paiement et les relevés de compte client.
- La comparaison avec un autre jour, et l'export PDF : à venir.

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Âge des comptes clients](images/rapport-age-clients-desktop.png)
![Âge des comptes clients sur téléphone](images/rapport-age-clients-mobile.png)
