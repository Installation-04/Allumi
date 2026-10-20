# Clients et fournisseurs

Le lot 4.1 ajoute le répertoire **Contacts** à la navigation de l’entreprise, sur ordinateur et téléphone. Cette fonctionnalité est intégrée à `main` avec les PR #5 et #6 (web mobile et espace comptable) et la PR #7 (contacts).

## Créer et modifier

Choisir **Nouveau contact**, puis saisir un nom affiché et un type : client, fournisseur ou les deux. Les coordonnées, la raison sociale, l’adresse et les notes sont facultatives. Le pays utilise un code de deux lettres (CA par défaut); le délai de paiement accepte un entier de 0 à 365 jours (30 par défaut). La langue du contact est indépendante de celle de votre interface.

Enregistrer ouvre la fiche. Modifier les champs puis choisir **Enregistrer le contact**. Une validation refusée conserve les valeurs pour les corriger.

## Retrouver une fiche

Les onglets Tous, Clients et Fournisseurs filtrent le type. La recherche porte sur le nom affiché, la raison sociale, le courriel et le téléphone; les caractères `%` et `_` sont recherchés littéralement. Le filtre de statut distingue actifs, archivés et tous. La liste affiche 25 contacts par page, triés par nom. Sur téléphone, chaque fiche apparaît dans une liste tactile; sur ordinateur, les coordonnées apparaissent en colonnes.

## Archiver et restaurer

**Archiver le contact** le retire de la liste active. Choisir le statut Archivés pour retrouver sa fiche, puis **Restaurer le contact**. L’archivage conserve son identité et les références comptables; aucune suppression n’est proposée. Il ne constitue pas une anonymisation au sens de la Loi 25. Les fiches déjà anonymisées ne sont ni affichées ni modifiables par ce module.

## Permissions et limites

Tous les membres peuvent consulter les contacts de leur entreprise. Seuls le propriétaire et le comptable peuvent créer, modifier, archiver et restaurer. Les changements sont inscrits par la base dans la [[Piste-d-audit]]. Chaque opération vérifie les permissions et l’entreprise côté serveur; la base applique également l’isolation.

Ce lot ne crée ni facture, ni paiement, ni solde client. Le catalogue, les paramètres fiscaux des contacts, l’import et les opérations en lot ne sont pas encore exposés. Voir [[Feuille-de-route]] et [[References-visuelles]].
