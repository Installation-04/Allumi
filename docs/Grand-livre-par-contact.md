# Grand livre par contact

Dans **Rapports → Grand livre**, choisis un compte, un **Contact** et la période, puis **Afficher**. **Tous les contacts** revient au compte complet.

Le grand livre exige l’accès **Comptabilité en lecture**. Le filtre et sa recherche exigent aussi **Contacts en lecture**, conformément aux restrictions de la base. Le compte complet reste consultable avec Comptabilité seule. Aucun lien public n’est créé.

## Lire les soldes filtrés

Le filtre retient uniquement les **lignes du journal portant l’identifiant du contact**, pas toutes les lignes des écritures correspondantes. Une ligne bancaire, de taxe ou de revenu sans ce contact est exclue même si la même écriture comporte une ligne de comptes clients pour ce contact.

Les soldes d’ouverture, les débits/crédits de période, les soldes courants et le solde final portent tous sur cette sélection. Le solde d’ouverture comprend les lignes du contact antérieures au début de période. Les dates de début et fin sont incluses. Le sens naturel des soldes est inchangé et les montants restent en cents exacts.

Le bandeau **Contact : …** rappelle le périmètre choisi : ces soldes peuvent différer du compte complet au bilan. Ce rapport n’est pas un âge des comptes ni un solde de factures à payer; voir [[Age-des-comptes]] et [[Age-des-comptes-fournisseurs]].

La pagination reste de 100 lignes; elle conserve les soldes courants entre pages. Les raccourcis d’exercice et les liens CSV conservent le contact choisi. Un changement de sélection repart à la première page. Les contre-passations portent leur propre date comptable et conservent le contact de la ligne d’origine.

## Trouver un contact historique

La liste propose les 100 premiers contacts déjà liés au journal, y compris les contacts inactifs. **Rechercher un contact** ouvre une recherche de nom pour trouver les autres. La recherche limite les options de la liste; sélectionne ensuite le contact et clique sur **Afficher** pour l’appliquer. Une recherche vide rétablit les premiers choix.

La sélection courante reste proposée même si elle ne correspond pas au texte recherché ou n’appartient pas aux 100 premiers résultats. Le nom et le statut sont ceux de la configuration actuelle. Une anonymisation respecte le nom anonymisé conservé en base, sans rétablir d’anciennes coordonnées.

Seuls l’identifiant, le nom affiché et le statut actif sont lus pour le sélecteur. Aucune adresse, courriel, note ou autre coordonnée n’est ajouté au rapport. Un identifiant de contact mal formé, inconnu, étranger à l’entreprise ou répété dans l’adresse est refusé; il ne devient pas silencieusement un rapport sans filtre.

## CSV

**Exporter ce compte en CSV** et **Exporter tous les comptes en CSV** utilisent le même contact et la même période. Le second fichier regroupe les comptes ayant des lignes ou un solde pour ce contact, sans ajouter les contreparties sans contact. Un compte ayant uniquement un solde d’ouverture reste présent.

Le CSV contient une ligne de contexte **Contact**, puis les colonnes habituelles; le nom de fichier contient `_contact_` pour distinguer un export filtré. Les règles FR/EN, UTF-8 avec BOM, montants numériques exacts et protection contre les formules restent celles de [[Grand-livre]]. Le téléchargement est privé et sans cache. La limite d’export de 200 000 lignes s’applique aux lignes retenues, pas aux mouvements des autres contacts.

Le filtre est en lecture seule : aucune écriture, association de contact ou période n’est modifiée. Pour des écritures ajoutées entre deux consultations, recharge le rapport avant d’exporter.

## Captures

Données fictives, Chromium ordinateur et téléphone émulé.

![Grand livre filtré par contact](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/grand-livre-contact-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/grand-livre-contact-mobile.png" alt="Grand livre par contact sur téléphone" width="412">
