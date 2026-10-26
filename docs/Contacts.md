# Clients et fournisseurs

Le lot 4.1 ajoute le répertoire **Contacts** à la navigation de l’entreprise, sur ordinateur et téléphone. Cette fonctionnalité est intégrée à `main` avec les PR #5 et #6 (web mobile et espace comptable) et la PR #7 (contacts).

## Créer et modifier

Choisir **Nouveau contact**, puis saisir un nom affiché et un type : client, fournisseur ou les deux. Les coordonnées, la raison sociale, l’adresse et les notes sont facultatives. Le pays utilise un code de deux lettres (CA par défaut); le délai de paiement accepte un entier de 0 à 365 jours (30 par défaut). La langue du contact est indépendante de celle de votre interface.

Enregistrer ouvre la fiche. Modifier les champs puis choisir **Enregistrer le contact**. Une validation refusée conserve les valeurs pour les corriger.

## Retrouver une fiche

Les onglets Tous, Clients et Fournisseurs filtrent le type. La recherche porte sur le nom affiché, la raison sociale, le courriel et le téléphone; les caractères `%` et `_` sont recherchés littéralement. Le filtre de statut distingue actifs, archivés et tous. La liste affiche 25 contacts par page, triés par nom. Sur téléphone, chaque fiche apparaît dans une liste tactile; sur ordinateur, les coordonnées apparaissent en colonnes.

## Archiver et restaurer

**Archiver le contact** le retire de la liste active. Choisir le statut Archivés pour retrouver sa fiche, puis **Restaurer le contact**. L’archivage conserve son identité et les références comptables; aucune suppression n’est proposée. Il ne constitue pas une anonymisation au sens de la Loi 25 : pour effacer une personne, voir la section suivante. Les fiches anonymisées ne sont ni affichées ni modifiables.

## Anonymiser un contact (Loi 25)

Quand une personne exerce son droit à l’effacement, ou que la période de conservation de ses renseignements est terminée, le **propriétaire** ouvre la fiche et déplie **Anonymiser ce contact (Loi 25)**. L’opération est **irréversible**. Il faut :

1. choisir un **motif** dans une liste fixe (demande de la personne, fin de la période de conservation, autre). Le motif n’est pas un champ libre : un texte saisi dans la piste d’audit pourrait nommer la personne qu’on veut oublier;
2. saisir un **code de vérification** (application d’authentification ou code de récupération, voir [[Authentification]]). La vérification en deux étapes doit donc être active, et un témoin de connexion volé ne suffit pas;
3. cocher la confirmation.

Ce qui change, en une seule transaction :

- la fiche perd son nom (remplacé par « Contact anonymisé »), sa raison sociale, son courriel, son téléphone, son adresse, ses notes et ses numéros de TPS, de TVQ et d’exemption; elle est archivée et disparaît des listes et des formulaires;
- ces mêmes renseignements sont **retirés de toute la [[Piste-d-audit]]** de la fiche (les entrées restent, sans ces champs) par la fonction `audit_redact` de la base;
- la piste d’audit consigne **qui** a anonymisé, **quand** et **pourquoi** (`contact.anonymize`, puis `privacy.redact` avec les champs et le nombre d’entrées touchées), sans aucun renseignement sur la personne.

Ce qui est conservé : les écritures, les montants et les taxes, car les registres comptables doivent être gardés. Une **facture validée garde la copie figée** des coordonnées de son client (nom, adresse, courriel, numéros de taxes), prise à la validation : c’est la pièce légale. Aucune nouvelle facture ni brouillon ne peut viser un contact anonymisé. Un code ne sert qu’une fois; un code refusé ne change rien à la fiche.

## Permissions et limites

Tous les membres peuvent consulter les contacts de leur entreprise. Seuls le propriétaire et le comptable peuvent créer, modifier, archiver et restaurer; seul le propriétaire peut anonymiser. Les changements sont inscrits par la base dans la [[Piste-d-audit]]. Chaque opération vérifie les permissions et l’entreprise côté serveur; la base applique également l’isolation.

Ce lot ne crée ni facture, ni paiement, ni solde client. Le catalogue, les paramètres fiscaux des contacts, l’import et les opérations en lot ne sont pas encore exposés. Voir [[Feuille-de-route]] et [[References-visuelles]].
