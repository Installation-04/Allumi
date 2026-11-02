# Guide utilisateur

Ce guide couvre les fonctions réellement disponibles. Les modules à venir sont identifiés dans [[Fonctionnalites-et-limites]]. Les illustrations de [[References-visuelles]] montrent une entreprise fictive; aucun chiffre n’est une recommandation comptable.

## 1. Ouvrir son espace

L’administrateur installe Allumi ([[Installation]]) puis crée l’entreprise et son premier compte ([[Premier-demarrage]]). Connecte-toi à l’adresse HTTPS de l’instance. Choisis Français ou English dans l’en-tête. Si ton compte appartient à plusieurs entreprises, l’accueil propose leur liste; chaque espace est isolé.

Active la vérification en deux étapes dans **Sécurité du compte**, accessible au bas du tableau de bord. Garde les codes de récupération hors de l’application. Voir [[Authentification]].

## 2. Comprendre le tableau de bord

Le nom de l’entreprise et ton rôle apparaissent en haut. Les cartes Actif, Passif, Produits et Charges reflètent les soldes nets du grand livre pour toutes les dates enregistrées. Elles ne représentent pas les flux de trésorerie du mois. Les dernières écritures ouvrent leur détail; **Voir le journal** ouvre l’historique complet. Voir [[Interface-et-navigation]].

Sur téléphone, utilise la barre de navigation fixe au bas de l’écran. Les tableaux de consultation défilent dans leur propre zone; les formulaires de saisie s’empilent.

## 3. Préparer le plan comptable

Ouvre **Plan comptable**. Le gabarit canadien fournit les comptes de départ. Un propriétaire ou comptable peut créer un compte avec code, libellés français/anglais, type et sous-type. Vérifie le type avant de créer : il détermine le sens naturel du solde et ne se change pas comme un simple libellé. Les comptes système ont des restrictions supplémentaires. Voir [[Plan-comptable]].

## 4. Enregistrer une première écriture

1. Depuis le tableau de bord ou le journal, choisis **Nouvelle écriture**.
2. Choisis une date dans une période ouverte et le type approprié (manuelle ou solde d’ouverture).
3. Donne une description compréhensible.
4. Sur chaque ligne, choisis un compte et saisis un débit **ou** un crédit.
5. Ajoute des lignes au besoin. Le total des débits doit égaler celui des crédits.
6. Relis, puis choisis **Enregistrer l’écriture**. Le numéro attribué et le détail confirment la validation.

Exemple fictif : apport en capital de 1 000,00 $, débit Banque, crédit Capital-actions. La pertinence du compte de contrepartie dépend de la forme juridique et de la situation réelle : fais valider tes soldes d’ouverture par ton comptable.

Une erreur de validation conserve les valeurs saisies et affiche son motif. Aucun bouton ne permet d’écraser une écriture validée. Voir [[Journal-et-ecritures]].

## 5. Corriger sans effacer

Ouvre l’écriture depuis le journal, choisis **Contre-passer**, et vérifie la date de correction. Allumi produit une écriture inverse liée à l’originale. Crée ensuite la bonne écriture si nécessaire. L’historique reste consultable. Une période verrouillée doit être traitée selon la politique comptable; elle ne se contourne pas.

## 6. Vérifier et fermer une période

Consulte **Balance de vérification**, éventuellement à une date donnée. Vérifie les comptes et les contrôles d’équilibre. Dans **Exercices**, verrouille les périodes terminées. La réouverture demande le rôle propriétaire, la 2FA, un code actuel et un motif; une session connectée ne suffit pas. Voir [[Exercices-et-periodes]].

## 7. Consulter les changements

Les propriétaires et comptables accèdent à **Piste d’audit** pour examiner les événements et leurs détails. Un compte en lecture seule ne dispose pas de cet accès. Voir [[Piste-d-audit]].

## 8. Exploiter au quotidien

L’administrateur doit tester les [[Sauvegardes]], suivre les [[Mise-a-jour]] et vérifier la [[Configuration]]. Le produit reste une préversion; consultez [[Fonctionnalites-et-limites]] pour le périmètre disponible et les limites avant un usage en production. Pour un problème, consulter [[Depannage]] et [[FAQ]].

Le répertoire clients et fournisseurs (lot 4.1 livré) est décrit dans [[Contacts]].

## Taxes et produits/services

Ouvrir **Taxes** pour configurer les taux et codes, puis **Produits et services** pour préparer les articles. Voir [[Taxes-et-catalogue]] pour la simulation, les comptes, les droits et les limites.

## Identité de l’entreprise

Le propriétaire renseigne les coordonnées et numéros fiscaux dans **Entreprise**. Les autres membres consultent la fiche. Voir [[Entreprise]] pour les formats acceptés et les limites.

## Préparer une facture

Ouvrir **Brouillons de factures** pour saisir un client et des lignes, puis consulter le calcul enregistré. Voir [[Brouillons-de-factures]]. Les brouillons ne sont pas comptabilisés. Voir [[Validation-des-factures]] pour leur attribuer un numéro et créer leur écriture. L’envoi n’est pas encore disponible.

Pour corriger entièrement une facture validée, voir [[Annulation-des-factures]]. Le document et son numéro sont conservés.

- [[Brouillons-d-avoirs]]

- [[Validation-des-avoirs]]

## Saisir une facture fournisseur

Ouvrir **Dépenses → Factures fournisseurs** pour préparer une facture à payer, la valider et consulter son écriture. Voir [[Factures-fournisseurs]] pour les droits, l’annulation et les limites de récupération des taxes.

Depuis une facture fournisseur validée, **Nouveau crédit fournisseur** prépare un brouillon de correction aux taux d’origine. Le brouillon ne réduit pas le solde à payer; sa validation le comptabilise et l’applique intégralement à la facture d’origine. Voir [[Factures-fournisseurs]].

Pour une dépense déjà réglée et non encore saisie, ouvrir **Dépenses → Dépenses payées**. Voir [[Depenses-payees]]. Une facture fournisseur déjà enregistrée se règle depuis sa fiche, sans créer une nouvelle dépense.

Les factures et avoirs clients disposent de [[Justificatifs]] privés sous permissions Ventes; les achats utilisent les permissions Comptabilité.

## Envoyer une facture

Ouvre une facture validée puis **Envoi par courriel**. Vérifie le destinataire, choisis la langue et confirme. L’historique distingue l’acceptation SMTP d’un résultat incertain; aucun renvoi automatique. Voir [[Envoi-des-factures]].

## Vérifier les comptes fournisseurs

Dans **Rapports → Âge des comptes fournisseurs**, choisis une date pour retrouver les factures ouvertes, les montants non affectés et leur concordance avec le grand livre. Le détail et le CSV suivent cette même date. Voir [[Age-des-comptes-fournisseurs]].

## Consulter le sommaire des taxes

Dans **Rapports → Sommaire TPS/TVQ**, sélectionne une période pour consulter les taxes comptabilisées et leur contrôle au grand livre. Les versements restent distincts du net de période. Voir [[Sommaire-des-taxes]] pour les signes, limites et exports.

## Comparer les résultats

Dans l’état des résultats, ouvre **Comparer des périodes**, choisis les deux plages et consulte les montants et écarts par compte. Voir [[Comparaison-des-resultats]].

## Comparer les bilans

Dans le bilan, **Comparer deux dates** montre les soldes cumulatifs, leurs écarts et le contrôle d’équilibre de chaque date, avec export CSV. Voir [[Comparaison-des-bilans]].

## Imprimer les états financiers

Dans les résultats, le bilan ou leurs comparatifs, **Imprimer / PDF** ouvre la boîte d’impression du navigateur. Elle permet d’imprimer ou d’enregistrer un PDF selon les options de l’appareil. Voir [[Impression-des-etats-financiers]].
