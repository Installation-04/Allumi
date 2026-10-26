# Règles comptables

Ces règles sont non négociables : toute contribution qui les contourne est refusée.

## Montants
- Entiers (cents) ou `Decimal`. **Jamais de float.**
- Arrondi explicite et documenté (une seule fonction centrale) : au cent, **demi s'éloignant de zéro** (0,005 → 0,01; −0,005 → −0,01). C'est aussi le comportement de `round(numeric)` dans PostgreSQL, ce qui permet à la base de vérifier les montants de ligne.
- Taxes : calcul par ligne ou par document selon une règle configurable, jamais implicite.

## Partie double
- Chaque écriture a au moins deux lignes; la somme des débits = la somme des crédits.
- Validé dans l'application **et** en base (contrainte/trigger).
- Une écriture **manuelle** ([[Journal-et-ecritures]]) refuse aussi les comptes de taxes de vente et les comptes désactivés; elle porte la source `MANUAL` ou `OPENING_BALANCE`, et seules ces écritures se contre-passent à la main (les autres s'annulent avec leur pièce).
- Les comptes clients et fournisseurs (comptes de contrôle) ne reçoivent que des écritures issues de documents et de paiements, toujours avec un contact. La base vérifie que l'écriture d'une pièce existe pour cette pièce et que ses montants sur les comptes de contrôle égalent le total de la pièce : l'âge des comptes concilie toujours avec le grand livre.

## Immuabilité
- Une écriture validée ne se modifie ni ne se supprime.
- Correction par **contre-passation** (écriture inverse) puis nouvelle écriture.

## Piste d'audit
- Qui, quoi, quand, valeurs avant/après pour toute création ou modification.
- Les journaux d'audit eux-mêmes sont en ajout seulement.

## Dates
- Un document a deux dates : celle de la pièce (échéance, âge des comptes) et sa **date comptable** (celle de l'écriture). Une facture fournisseur reçue après la fermeture de sa période se comptabilise à la date d'aujourd'hui, sans fausser la date inscrite sur la pièce.
- Les affectations de paiements et d'avoirs portent une date d'effet et ne s'effacent jamais : on les retire à une date, dans une période ouverte. L'âge des comptes à une date passée reste reproductible.

## Encaissements
- Un encaissement est une seule écriture équilibrée : débit du compte de réception (banque, caisse ou fonds non déposés), crédit des comptes clients avec le contact de la facture. Il porte le prochain numéro de la séquence `PAYMENT_RECEIVED`, sans trou. L'écriture, l'encaissement et l'affectation à la facture sont enregistrés dans la même transaction.
- Le montant affecté ne dépasse jamais le solde ouvert de la facture (total moins encaissements et avoirs appliqués) : l'application le vérifie sous verrou de la facture, avec le solde que la personne a vu, et la base le vérifie encore à la validation. Pas de trop-perçu dans ce lot.
- La date de réception ne précède pas la date comptable de la facture, n'est pas dans le futur et tombe dans une période ouverte.
- Un encaissement ne se modifie pas : on l'annule. L'annulation retire l'affectation à une date, ajoute l'écriture inverse exacte et garde l'encaissement avec son motif. Une facture avec un encaissement appliqué ne peut pas être annulée.

## Transactions importées
- Un **paiement en ligne** (lien de paiement Stripe, [[Integrations]]) est un encaissement **au brut** sur le compte de la connexion, appliqué à la facture du lien, plus une **écriture de frais** de deux lignes (charge au compte des frais de traitement, crédit au compte de la connexion), le tout dans une transaction : le solde du compte égale le net versé par Stripe. Le domaine (`domain/online-payment.ts`) et la base (`online_payment_guard`, `payment_link_guard`) refusent les mêmes cas : un lien n'existe que pour une facture validée, son solde et sa devise, une seule fois en cours par facture; un paiement en ligne n'arrive que sur un lien actif, pour le montant du lien, avec un encaissement brut sur le bon compte appliqué à la bonne facture et, s'il y a des frais, une écriture exactement de ces deux lignes. Un paiement en ligne et un lien payé ou annulé ne changent plus; rien ne se supprime.
- Les transactions importées d'un service externe ([[Integrations]]) et celles d'un relevé CSV ou OFX ([[Import-de-releves]]) ne créent **aucune écriture** à l'import : elles alimentent seulement les transactions bancaires. Le montant d'une ligne de relevé est son effet sur le compte (entrée positive, sortie négative, même pour une carte de crédit), en cents exacts; une ligne n'est connue qu'une fois par compte (identifiant de la banque, ou date, montant, description et rang) et un même fichier ne s'importe qu'une fois par compte. Leur montant est l'effet net sur le solde du service (`brut − frais`), dans leur devise, sans conversion de change; une ligne importée ne change plus que de statut.
- Une transaction bancaire s'**apparie** ([[Appariement-bancaire]]) à une ou plusieurs lignes du grand livre **du même compte** dont le total (débit − crédit) est **exactement** son montant, jamais plus de 20 lignes, une ligne à une seule transaction; la base le vérifie à la fin de la transaction (`bank_transaction_match_check`) et refuse de défaire un appariement dont une ligne est comptée par un rapprochement terminé (`bank_match_reconciled_guard`). Une transaction non appariée peut donner une **écriture de source Banque** : deux lignes (compte du relevé et compte choisi, jamais le même), datée de la transaction, dont le sens suit le signe du montant; ou, pour deux transactions de montants opposés sur deux comptes, **une écriture de virement** datée de la plus ancienne. L'écriture et les appariements se font dans la même transaction. Une écriture Banque est immuable et se corrige par contre-passation; une transaction n'a jamais deux écritures non contre-passées.
- Un **rapprochement bancaire** ([[Rapprochement-bancaire]]) confronte un compte de banque, de caisse ou de carte à un relevé (date et solde finaux). Il **compte** des lignes du grand livre de ce compte datées au plus du jour du relevé, une ligne n'étant comptée que par un seul rapprochement; il ne se **termine** que si la somme (débit − crédit, en cents exacts) des lignes comptées par ses prédécesseurs terminés et par lui est exactement le solde du relevé (le solde d'une carte, un passif, est lu en signe inverse). Un rapprochement terminé est figé : ni lignes ajoutées ou retirées, ni suppression, ni solde ou date changés; seul le dernier du compte se rouvre, avec un motif consigné, et pas pendant qu'un autre est en cours. Un seul rapprochement en cours par compte, et sa date suit celle du dernier terminé. Il ne crée ni ne change aucune écriture. Domaine (`domain/reconciliation.ts`), service et base (`reconciled_line_guard`, `bank_reconciliation_guard`, `bank_match_reconciled_guard`) refusent les mêmes cas.


## Périodes
- Une période fermée refuse toute nouvelle écriture.
- La réouverture est une action privilégiée et auditée : propriétaire seulement, avec la vérification en deux étapes active et un code saisi à ce moment, un motif écrit d'au moins 10 caractères et un événement d'audit ([[Exercices-et-periodes]]). Ces conditions sont appliquées par l'application (la base garantit l'audit du changement, pas le 2FA).
- Un exercice se ferme quand toutes ses périodes sont verrouillées; tant qu'il est fermé, ses périodes ne changent pas d'état.

## Vie privée (Loi 25)
- La piste d'audit est en ajout seulement. Les renseignements personnels (courriel, téléphone, nom d'un contact anonymisé) peuvent en être caviardés par le propriétaire de l'entreprise; l'opération est elle-même journalisée et ne touche jamais aux champs comptables.
- Les secrets (mot de passe, secret 2FA) ne sont jamais copiés dans l'audit.

## Isolation
- Toute table de données comptables porte `company_id`.
- Aucune requête sans filtre d'entreprise; tests automatisés d'isolation.
- Le contexte d'entreprise est lié à l'adhésion de l'utilisateur dans la base de données : désigner une entreprise dont on n'est pas membre ne donne accès à rien.
- Un membre en lecture seule ne peut rien modifier, même par erreur de code.

## Taxes (TPS/TVQ)
- Taux configurables avec date d'effet (jamais codés en dur).
- Les **états financiers** ([[Etats-financiers]]) se calculent à l'ouverture depuis le grand livre, en cents exacts, dans le sens normal de chaque compte : résultat net = revenus − charges sur la période, jours inclus; au bilan, actif = passif + capitaux propres + résultats (revenus − charges), les résultats d'avant l'exercice en cours étant présentés à part puisqu'aucune écriture de clôture ne les passe aux capitaux propres. Un export CSV ne contient que ces chiffres et des noms de compte, ceux-ci protégés contre l'injection de formule.
- Les rapports de taxes se calculent depuis le grand livre : chaque ligne d'un compte de taxes porte sa taxe et sa case de déclaration (perçue, récupérable, redressement, versement).
- Une déclaration produite est figée : aucune écriture ne peut plus être datée dans sa période.
- La base de données recalcule les taxes des ventes à la validation (lignes, codes, taux en vigueur à la date du document, mode d'arrondi figé).

## Tests exigés
- Tests de propriétés : écritures aléatoires ⇒ la balance de vérification reste à zéro.
- Tests de non-régression pour chaque rapport.
- Tests d'isolation entre entreprises.

Le détail de l'application de ces règles en base (contraintes, triggers, codes d'erreur) est dans [[Schema-de-donnees]]; les tests qui les protègent sont dans [[Plan-de-tests]].

Voir [[Architecture]].
