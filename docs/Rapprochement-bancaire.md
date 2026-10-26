# Rapprochement bancaire

Le **rapprochement** est la vérification de fin de période : vous confrontez un compte de **banque**, de **caisse** ou de **carte de crédit** au **relevé** que la banque vous envoie. Vous **pointez** les lignes du journal que le relevé confirme, jusqu'à ce que l'**écart** soit nul : alors les livres et le relevé disent la même chose, et ce rapprochement est **terminé** et figé.

**Banque et transactions → Rapprochement bancaire.** Réservé aux **propriétaires** et aux **comptables** pour agir; tous les membres consultent. Les lignes du relevé s'importent ([[Import-de-releves]]) et s'apparient aux écritures ([[Appariement-bancaire]]) avant ou pendant, mais ce n'est pas obligatoire : on peut pointer des lignes du journal sans avoir importé de relevé.

## Commencer

Chaque compte a sa carte : le dernier rapprochement terminé, celui qui est en cours, et le formulaire pour en commencer un.

1. la **date de fin du relevé** : le dernier jour qu'il couvre. Elle suit celle du dernier rapprochement terminé du compte (jamais avant, jamais la même);
2. le **solde final** que le relevé indique, tel quel. Pour une **carte de crédit**, le **solde dû** en positif (ce que la carte dit que vous devez) : Allumi fait la conversion avec le grand livre.

Un seul rapprochement à la fois par compte.

## Pointer

La feuille liste les lignes **du compte** dont la date est **au plus celle du relevé** et qu'**aucun rapprochement n'a encore comptées** : celles d'un relevé précédent n'y reviennent pas, mais une ligne datée d'avant le dernier relevé et saisie après lui y figure (elle a été oubliée). Chaque ligne montre l'écriture, la date, la description, le contact, son montant (son **effet sur le compte** : une entrée est positive, une sortie négative) et la ligne du relevé à laquelle elle est appariée, s'il y en a une. Les écritures **contre-passées** sont signalées.

- **Pointer les lignes appariées** coche d'un clic toutes les lignes que des transactions du relevé prouvent déjà et **enregistre** aussitôt;
- sinon on **coche à la main**, avec **Tout cocher** et **Tout décocher** : **Enregistrer le pointage** garde exactement les lignes cochées (ni plus, ni moins). Tant que le pointage n'est pas enregistré, la feuille le dit;
- les chiffres se mettent à jour à chaque case : **solde du relevé**, **compté** (les lignes des relevés précédents plus les lignes cochées) et **écart**. L'écart est ce qu'il reste à expliquer : une ligne du relevé qui n'est pas au journal (des frais, des intérêts) s'enregistre d'abord ([[Appariement-bancaire]]), un chèque non encaissé reste simplement non coché.

## Terminer

**Terminer le rapprochement** n'est offert que lorsque l'écart **enregistré** est exactement zéro. Le rapprochement est alors figé : on ne change plus ses lignes, on ne le supprime pas, et les **appariements** de ses lignes ne se défont plus (la liste des transactions l'indique). La base de données refuse d'ailleurs de terminer un rapprochement dont le total compté n'est pas le solde du relevé, même si l'application était contournée.

**Abandonner** un rapprochement en cours retire ses coches et rien d'autre.

## Rouvrir

Seul le **dernier** rapprochement terminé d'un compte se rouvre, et pas tant qu'un autre est en cours sur ce compte. **Rouvrir** demande un **motif** (dix caractères au moins) qui va à la [[Piste-d-audit]], propriétaires et comptables seulement. Rouvert, le rapprochement redevient modifiable : ses lignes restent cochées, on peut les changer, **défaire l'appariement** d'une ligne qui s'est révélé faux, puis terminer de nouveau. Pour corriger un rapprochement plus ancien, il faut d'abord rouvrir puis **abandonner** les plus récents, du dernier au premier (leurs coches sont alors perdues).

## Règles et limites

- Le **total compté** (en cents exacts) est la somme (débit − crédit) de toutes les lignes comptées par les rapprochements terminés du compte et par celui-ci; il doit être **égal** au solde du relevé. Le domaine, le service et la base ([[Regles-comptables]]) le vérifient.
- Une ligne n'est comptée que par **un** rapprochement, sur **son** compte, à une date **au plus égale** à celle du relevé (le jour même compte).
- Au plus **5 000 lignes** par feuille.
- Le rapprochement **ne crée ni ne change aucune écriture** : le journal reste immuable.
- Dollars canadiens seulement; une transaction d'une autre devise n'est jamais appariée.
- Non fait pour l'instant : proposer le solde final d'un fichier OFX, répartir les taxes d'une ligne, rapprocher plusieurs comptes ensemble, exporter la feuille en PDF (phase 6).

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Feuille de rapprochement](images/rapprochement-feuille-desktop.png)
![Rapprochement terminé](images/rapprochement-termine-desktop.png)
![Les rapprochements d'une entreprise](images/rapprochement-liste-desktop.png)
![Feuille de rapprochement sur téléphone](images/rapprochement-feuille-mobile.png)
