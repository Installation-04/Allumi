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

L’administrateur doit tester les [[Sauvegardes]], suivre les [[Mise-a-jour]] et vérifier la [[Configuration]]. La pré-alpha ne remplace pas encore un logiciel de production : les ventes, achats, paiements, imports et exports restent planifiés. Pour un problème, consulter [[Depannage]] et [[FAQ]].

Le répertoire clients et fournisseurs (lot 4.1 en revue) est décrit dans [[Contacts]].
