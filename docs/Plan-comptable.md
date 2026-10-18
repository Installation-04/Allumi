# Plan comptable

Le plan comptable est la liste des comptes de l'entreprise : chaque montant d'une écriture ([[Journal-et-ecritures]]) est inscrit au débit ou au crédit d'un compte. Écran : **Plan comptable** (`/c/<entreprise>/comptes`).

## Le plan de départ
À la création de l'entreprise (`/setup`), Allumi installe un **plan de départ canadien** de 47 comptes, bilingue (français et anglais), avec une numérotation à quatre chiffres :

| Plage | Type | Exemples |
|---|---|---|
| 1000–1999 | Actif | Banque (1000), Comptes clients (1100), TPS à recevoir (1200), TVQ à recevoir (1210), Équipement (1500) |
| 2000–2999 | Passif | Comptes fournisseurs (2000), TPS à payer (2100), TVQ à payer (2110), Emprunt bancaire (2500) |
| 3000–3999 | Capitaux propres | Capital-actions (3000), Soldes d'ouverture (3100), Bénéfices non répartis (3200) |
| 4000–4999 | Produits | Revenus de services (4000), Ventes de marchandises (4100) |
| 5000–7999 | Charges | Coût des marchandises vendues (5000), Loyer (6050), Intérêts sur emprunts (7000) |

Les noms sont originaux (ni copiés d'un autre logiciel ni tirés d'un barème de produit). Les **codes GIFI** de l'Agence du revenu du Canada ne sont volontairement pas inclus : le rapprochement avec les formulaires T2 viendra avec les rapports (phase 6), après vérification des codes en vigueur.

Le plan est un **point de départ** : ajoute, renomme, désactive des comptes. Une entreprise qui existait avant la phase 3 reçoit le plan, la numérotation et son exercice courant en cliquant sur « Initialiser » sur le tableau de bord; l'opération ne fait qu'ajouter ce qui manque. Dans une entreprise qui a déjà ses propres comptes, seuls les cinq comptes système manquants sont ajoutés (sur le code suivant si celui du gabarit est pris), sans imposer le reste du plan.

## Types et sous-types
Cinq **types** : actif, passif, capitaux propres, produits, charges. Chacun a des **sous-types** (banque, immobilisation, taxe de vente, charge d'exploitation…). La base de données et l'application refusent les combinaisons incohérentes (un compte de passif ne peut pas être une « immobilisation »).

- Un compte d'**actif** ou de **charge** augmente au débit; les autres augmentent au crédit. Le solde est affiché dans son sens naturel.
- Tant qu'un compte a des écritures, son **type** et son **sous-type** sont figés; changer le type renverserait le sens de tout l'historique.

## Comptes système
Cinq comptes sont créés par le système et ne se suppriment jamais : **Comptes clients**, **Comptes fournisseurs**, **Fonds non déposés**, **Bénéfices non répartis**, **Capitaux propres – soldes d'ouverture**. Les modules des phases suivantes les retrouvent par leur clé, pas par leur numéro : tu peux donc changer leur code ou leur nom.

## Ce que tu peux faire
- **Créer** un compte (code, nom français, nom anglais, type, sous-type, description). Le code est unique dans l'entreprise : lettres, chiffres, point et tiret, 20 caractères au plus.
- **Modifier** le code, les noms et la description (bouton « Modifier » de la liste, y compris pour un compte système). Le type et le sous-type ne changent pas : ils donnent son sens à l'historique. Pour en changer, supprime le compte s'il n'a jamais servi, puis recrée-le.
- **Désactiver** un compte : il disparaît des listes de choix, mais son historique reste.
- **Supprimer** un compte seulement s'il n'a jamais servi. Sinon, désactive-le.

Les comptes **clients** et **fournisseurs** (comptes de contrôle) ne reçoivent que des écritures de documents et de paiements, toujours avec un contact; les comptes de **taxes de vente** viendront avec les taxes (phase 4). Ni les uns ni les autres ne se choisissent dans une écriture manuelle (voir [[Regles-comptables]]).

## Qui peut faire quoi
Le propriétaire et le comptable gèrent les comptes; le membre en lecture seule les consulte. Voir [[Authentification]].

Voir aussi : [[Schema-de-donnees]] (table `account`), [[Exercices-et-periodes]].
