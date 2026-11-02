<p align="center"><img src="public/icons/allumi.svg" alt="Logo d’Allumi : une flamme au-dessus d’un signe égal" width="112" height="112"></p>

# Allumi

Logiciel de comptabilité **open source** et **auto-hébergeable** pour les PME et les travailleurs autonomes du Québec et du Canada. Une alternative libre aux logiciels de comptabilité infonuagiques propriétaires.

> **État : pré-alpha.** Le squelette fonctionne (premier démarrage, connexion, vérification en deux étapes, interface FR/EN, Docker); le moteur comptable (plan comptable, journal, périodes, audit) est en place, les contacts, taxes configurables, produits/services et brouillons et validation des factures sont disponibles; brouillons, validation, affectation et annulation des avoirs disponibles; encaissements de factures disponibles; import des transactions Stripe et PayPal disponible; remboursements, dépôts et paiements fournisseurs à venir ([feuille de route](docs/Feuille-de-route.md)). N'utilise pas Allumi pour de la comptabilité réelle avant une version stable.

*English summary: Allumi is an open-source, self-hostable accounting app for Canadian small businesses (QST/GST aware, French-first, bilingual). The repo ships a Docker Compose stack, an Ubuntu install script, encrypted backups and a full wiki in `docs/`. Application code is in pre-alpha.*

## Installation Docker

En une commande (détecte le système et le processeur, puis lance l’installateur adapté; `-s -- --check` pour voir sans modifier) :

```bash
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh
```

Ou à la main, avec Docker Engine, Compose v2, Bash, OpenSSL et Git déjà installés :

```bash
git clone https://github.com/Installation-04/Allumi.git allumi
cd allumi
git checkout v0.4.0-alpha.35
./scripts/install-docker.sh
```

Le script génère une configuration privée, conserve les secrets existants et vérifie le démarrage. Option `--prepare-only` pour préparer sans démarrer. [Guide Docker](docs/Installation-Docker.md) · [Proxmox](docs/Proxmox.md). Préversion pour données fictives uniquement.

## Fonctions visées (MVP)
- Plan comptable et journal à partie double
- Clients, fournisseurs, factures, paiements, dépenses
- Rapprochement bancaire (CSV/OFX)
- TPS/TVQ avec taux configurables
- Rapports : balance de vérification, bilan, état des résultats, âge des comptes
- Multi-entreprise, rôles, piste d'audit
- Interface en français (par défaut) et en anglais

## Installation rapide (Ubuntu 22.04/24.04)

Prérequis : un serveur Ubuntu avec accès root, une adresse IP accessible depuis le navigateur.

```bash
git clone https://github.com/Installation-04/Allumi.git /opt/allumi
cd /opt/allumi
sudo ./scripts/install.sh --interactive
```

Le script installe Docker, configure le pare-feu, génère les secrets, démarre la pile (PostgreSQL, application) et planifie des sauvegardes chiffrées quotidiennes. Détails : [`docs/Installation.md`](docs/Installation.md).

## Windows, iPhone et Proxmox

Le client Windows de la préversion v0.4.0-alpha.35 est distribué via les [Releases](https://github.com/Installation-04/Allumi/releases), avec leur version et leurs sommes de contrôle. Voir le [client Windows](docs/Client-Windows.md). Sur iPhone : **Safari → Partager → Sur l’écran d’accueil**, puis ouvrir Allumi depuis son icône ([guide iOS](docs/Application-mobile.md)). Une connexion au serveur est nécessaire.

Pour tester sur Proxmox, utiliser une **VM Ubuntu dédiée** et des données fictives : [guide Proxmox](docs/Proxmox.md). La page **Versions** distingue les mises à jour du serveur et du client.

## Développement local

```bash
cp .env.example .env                              # puis adapte-le (voir la page ci-dessous)
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + Mailpit
npm install && npm run db:migrate && npm run dev
```

Voir [`docs/Developpement-local.md`](docs/Developpement-local.md). Pour développer dans le cloud (Claude Code sur le web, sans Docker) : [`docs/Developpement-cloud.md`](docs/Developpement-cloud.md).

## Documentation
Le dossier [`docs/`](docs/) est le wiki du projet. Point de départ : [`docs/Home.md`](docs/Home.md). La commande `scripts/sync-wiki.sh` le publie sur le wiki GitHub.

## Contribuer
Lis [`CONTRIBUTING.md`](CONTRIBUTING.md). Pour signaler une faille de sécurité : [`SECURITY.md`](SECURITY.md).

## Avertissement
Allumi est un outil. Il ne remplace ni un comptable professionnel ni un avis juridique ou fiscal. Les taux et règles de taxes doivent être vérifiés auprès de Revenu Québec et de l'Agence du revenu du Canada. Chaque exploitant d'une instance est responsable de la conformité de son usage (dont la Loi 25 sur la protection des renseignements personnels).

## Licence
[MIT](LICENSE)

## Guide et références visuelles

Le [wiki GitHub](https://github.com/Installation-04/Allumi/wiki) regroupe le guide utilisateur, l’installation, l’exploitation, l’architecture et la feuille de route. Voir le [guide utilisateur](docs/Guide-utilisateur.md), les [fonctionnalités et limites](docs/Fonctionnalites-et-limites.md) et les [captures de référence](docs/References-visuelles.md). Les fichiers PNG originaux sont dans [docs/images](docs/images). La refonte est intégrée; les captures présentent les contacts, taxes et produits/services.

Captures réelles de l’entreprise fictive des tests, générées avec Chromium. Les vues mobiles sont émulées à 412 × 839 px; elles ne remplacent pas les essais sur appareil physique.

### Tableau de bord — ordinateur

![Tableau de bord Allumi sur ordinateur](docs/images/tableau-de-bord-desktop.png)

### Tableau de bord — téléphone

<img src="docs/images/tableau-de-bord-mobile.png" alt="Tableau de bord Allumi sur téléphone" width="360">

### Clients et fournisseurs — ordinateur et téléphone

![Répertoire des contacts sur ordinateur](docs/images/contacts-desktop.png)

<img src="docs/images/contacts-mobile.png" alt="Répertoire des contacts sur téléphone" width="360">

Les [25 captures de la galerie](https://github.com/Installation-04/Allumi/wiki/References-visuelles) montrent aussi la saisie, le journal, la balance, les exercices et la piste d’audit.

### Navigation par activité

![Espace Ventes et navigation latérale](docs/images/espace-ventes-desktop.png)

<img src="docs/images/menu-complet-mobile.png" alt="Menu complet Allumi sur téléphone" width="360">

Les pages des domaines non encore livrés indiquent leur état; elles ne simulent ni facturation, ni banque connectée, ni paie.

### Versions du serveur

![Versions et mises à jour](docs/images/versions-desktop.png)

Capture du serveur de test, agent non activé. Le [guide des mises à jour](docs/Mise-a-jour.md) explique son installation facultative.

### English and dark mode

Choose **English** in the header and use **Appearance** to select **Light theme**, **Dark theme** or **System theme**. Both preferences persist in your browser. See the [English appearance and language guide](docs/Appearance-and-language.md).

![Allumi English dashboard in dark mode](docs/images/dashboard-en-dark-desktop.png)

<img src="docs/images/contacts-en-dark-mobile.png" alt="Allumi contacts in English and dark mode on a phone" width="360">

### Taxes et catalogue

[Guide des taxes et du catalogue](docs/Taxes-et-catalogue.md), avec simulation et archivage.

![Taxes Allumi sur ordinateur](docs/images/taxes-desktop.png)

<img src="docs/images/catalogue-mobile.png" alt="Catalogue Allumi sur téléphone" width="360">

![Catalogue anglais sombre](docs/images/catalogue-en-dark-desktop.png)

### Réglages de l’entreprise

Identité, coordonnées et numéros fiscaux : [guide](docs/Entreprise.md).

![Entreprise en anglais sombre](docs/images/entreprise-en-dark-desktop.png)

<img src="docs/images/entreprise-mobile.png" alt="Réglages de l’entreprise sur téléphone" width="360">

### Brouillons de factures

[Préparer des factures](docs/Brouillons-de-factures.md) avec calcul des taxes, sans écriture comptable.

![Brouillon Allumi](docs/images/facture-brouillon-desktop.png)

<img src="docs/images/factures-en-dark-mobile.png" alt="Brouillons de factures en anglais sombre sur téléphone" width="360">

### Factures validées

[Valider une facture](docs/Validation-des-factures.md) lui attribue un numéro et crée son écriture comptable.

![Facture validée](docs/images/facture-validee-desktop.png)

<img src="docs/images/facture-validee-en-dark-mobile.png" alt="Facture validée en anglais sombre sur téléphone" width="360">

### Annulation avec historique

[Annuler une facture](docs/Annulation-des-factures.md) crée une contre-passation sans supprimer le document original.

![Facture annulée](docs/images/facture-annulee-desktop.png)

<img src="docs/images/facture-annulee-en-dark-mobile.png" alt="Facture annulée en anglais sombre sur téléphone" width="360">

## Brouillons d’avoirs partiels

Préparez une correction depuis une facture validée, avec montants par ligne et taux d’origine. Le brouillon reste sans effet comptable. Sa validation permet de comptabiliser et affecter intégralement l’avoir à sa facture. [Guide](docs/Brouillons-d-avoirs.md).

![Brouillon d’avoir sur ordinateur](docs/images/avoir-brouillon-desktop.png)
![Brouillon d’avoir anglais sombre sur mobile](docs/images/avoir-brouillon-en-dark-mobile.png)

## Validation des avoirs

Numérotation, écriture comptable et affectation intégrale à la facture d’origine, avec contrôle des plafonds cumulés et du solde. [Guide](docs/Validation-des-avoirs.md).

![Avoir validé sur ordinateur](docs/images/avoir-valide-desktop.png)
![Avoir validé anglais sombre sur mobile](docs/images/avoir-valide-en-dark-mobile.png)

### Correction d’un avoir validé

L’annulation retire les affectations à la facture d’origine et crée une contre-passation, avec motif et historique conservés. Voir le [guide des avoirs](docs/Validation-des-avoirs.md).

![Avoir annulé](docs/images/avoir-annule-desktop.png)

### Protection des connexions

La vérification en deux étapes doit être terminée dans les dix minutes suivant le mot de passe. [Guide d’authentification](docs/Authentification.md) et [protections de sécurité](docs/Securite-et-Loi-25.md).

![Connexion avec deuxième facteur](docs/images/connexion-deux-etapes-desktop.png)

### Assistant Docker interactif

Dans une VM Linux avec Docker et Compose installés, lancez `./scripts/install-docker.sh` sans argument : parcours standard ou avancé, questions de configuration et confirmation avant installation. Domaine, langue et ports sont configurables. [Guide illustré](docs/Installation-Docker.md).

![Assistant Docker](docs/images/assistant-docker.png)

L’assistant Docker utilise les port HTTP **28080** pour les nouvelles installations et conserve les réglages existants. Le serveur cible Linux **AMD64 et ARM64** (builds et tests Docker natifs pour les deux architectures). Voir le [guide Docker](docs/Installation-Docker.md).

La pile Docker contient uniquement l’application et PostgreSQL, avec un service ponctuel de migrations. Aucun SSL intégré : accès direct via `http://ADRESSE_VM:28080`; HTTPS peut être fourni par votre propre proxy. [Transition depuis Caddy](docs/Installation-Docker.md#passer-de-la-version-avec-caddy).

## Sécurité du compte

Depuis v0.4.0-alpha.11, consulter et déconnecter les appareils, ou changer le mot de passe en fermant les autres sessions. [Guide illustré](docs/Authentification.md#appareils-connectés--références-visuelles).

![Appareils connectés](docs/images/securite-appareils-desktop.png)
![Sécurité du compte sur téléphone](docs/images/securite-mot-de-passe-mobile.png)

### Utilisateurs et administration

Profils admin, utilisateur, lecteur et comptable externe, permissions par module et invitations à usage unique : [guide illustré](docs/Utilisateurs-et-permissions.md). Le super admin peut déléguer séparément [l’administration du serveur](docs/Administration-serveur.md) : santé, sauvegardes, rétention et journal d’opérations.

![Permissions des utilisateurs](docs/images/utilisateurs-permissions-desktop.png)
![Administration serveur sur téléphone](docs/images/serveur-mobile.png)

### États financiers

[État des résultats et bilan](docs/Etats-financiers.md), avec exports CSV français/anglais et accès contrôlé par les permissions comptables.

![État des résultats](docs/images/rapport-resultats-desktop.png)
![Bilan sur téléphone](docs/images/rapport-bilan-mobile.png)

Le [grand livre](docs/Grand-livre.md) détaille les mouvements et soldes par compte. L’[âge des comptes clients](docs/Age-des-comptes.md) répartit les soldes dus par retard et les rapproche du grand livre. Les deux offrent un export CSV.

![Grand livre](docs/images/rapport-grand-livre-desktop.png)
![Âge des comptes clients sur téléphone](docs/images/rapport-age-clients-mobile.png)

### Navigation selon les permissions

Les menus et raccourcis s’adaptent aux accès de chaque membre ([guide](docs/Utilisateurs-et-permissions.md#navigation-selon-les-droits)).

![Navigation d’un compte limité aux contacts](docs/images/navigation-restreinte-desktop.png)
![Menu mobile du même compte](docs/images/navigation-restreinte-mobile.png)

### Recherche des sections

Retrouve une section autorisée depuis le menu, sur ordinateur ou téléphone, sans tenir compte des accents. [Guide](docs/Interface-et-navigation.md#rechercher-une-section).

![Recherche dans le menu](docs/images/navigation-recherche-desktop.png)

![Recherche mobile](docs/images/navigation-recherche-mobile.png)

### Navigation par domaine

Les domaines restent à gauche; les outils du domaine ouvert apparaissent dans des onglets contextuels, sans répéter le menu global. [Guide](docs/Interface-et-navigation.md#navigation-par-domaine).

![Navigation contextuelle](docs/images/navigation-contextuelle-desktop.png)

![Navigation mobile](docs/images/navigation-contextuelle-mobile.png)

### Paramètres et administration

Les réglages de l’entreprise, des utilisateurs, de sécurité, du serveur et de l’apparence sont regroupés dans un espace adapté aux permissions. [Guide](docs/Parametres-et-administration.md).

![Paramètres](docs/images/parametres-administration-desktop.png)

![Paramètres mobile](docs/images/parametres-administration-mobile.png)

### Factures imprimables

Les factures validées proposent une [version imprimable](docs/Impression-des-factures.md), enregistrable en PDF avec le navigateur.

![Facture](docs/images/facture-imprimable-desktop.png)

![Facture mobile](docs/images/facture-imprimable-mobile.png)

### Factures fournisseurs

Le parcours [Dépenses → Factures fournisseurs](docs/Factures-fournisseurs.md) permet de saisir, valider et annuler une facture à payer. Ce premier lot couvre les charges avec taxes entièrement récupérables ou sans taxe; les paiements fournisseurs peuvent être enregistrés et annulés.

![Facture fournisseur validée](docs/images/achat-valide-desktop.png)

![Facture fournisseur sur mobile](docs/images/achat-valide-mobile.png)

### Paiements fournisseurs

Enregistrez un règlement partiel ou complet depuis une facture fournisseur, suivez le solde restant et consultez les contre-passations dans Dépenses → Paiements fournisseurs.

![Paiement fournisseur](docs/images/paiement-fournisseur-desktop.png)

![Paiement fournisseur sur téléphone](docs/images/paiement-fournisseur-mobile.png)

### Brouillons de crédits fournisseurs

Préparez une correction depuis une facture fournisseur, avec reprise des taux d’origine. Les brouillons restent sans effet comptable et ne réduisent pas le solde à payer ([guide](docs/Factures-fournisseurs.md)).

![Brouillon de crédit fournisseur](docs/images/credit-fournisseur-brouillon-desktop.png)

![Brouillon sur mobile](docs/images/credit-fournisseur-brouillon-mobile.png)

### Crédits fournisseurs validés

Les crédits peuvent être comptabilisés et appliqués intégralement à la facture d’origine, puis annulés par contre-passation. Les limites cumulées par ligne et taxe sont vérifiées en base ([guide](docs/Factures-fournisseurs.md)).

![Crédit fournisseur validé](docs/images/credit-fournisseur-valide-desktop.png)

![Crédit sur mobile](docs/images/credit-fournisseur-valide-mobile.png)

### Dépenses immédiatement payées

Saisissez une dépense déjà réglée avec son fournisseur, ses lignes et son compte banque/encaisse/carte. La validation comptabilise directement charges et taxes contre ce compte; l’annulation conserve l’historique ([guide](docs/Depenses-payees.md)).

![Dépense payée validée](docs/images/depense-payee-validee-desktop.png)

![Dépense sur mobile](docs/images/depense-payee-validee-mobile.png)

### Justificatifs privés

Ajoutez des PDF, PNG ou JPEG aux factures fournisseurs, crédits et dépenses : 4 Mo par fichier, 20 fichiers par pièce, accès selon les permissions Comptabilité et téléchargement avec vérification d’intégrité ([guide](docs/Justificatifs.md)).

![Justificatif privé](docs/images/justificatif-depense-desktop.png)

![Justificatif sur mobile](docs/images/justificatif-depense-mobile.png)

### Justificatifs des factures clients

Les factures et avoirs clients acceptent les justificatifs privés sous permissions Ventes, indépendamment de l’accès Comptabilité. Les fichiers des achats restent protégés par leur propre portée ([guide](docs/Justificatifs.md)).

![Justificatif client](docs/images/justificatif-client-desktop.png)

![Justificatif client mobile](docs/images/justificatif-client-mobile.png)

### Envoi manuel des factures par courriel

Envoyez une facture validée en français ou anglais via votre relais SMTP. Destinataire confirmé, historique et permissions Ventes; les résultats incertains ne déclenchent pas de renvoi automatique ([guide](docs/Envoi-des-factures.md)).

![Envoi par courriel](docs/images/courriel-facture-desktop.png)

![Envoi par courriel mobile](docs/images/courriel-facture-mobile.png)

### Âge des comptes fournisseurs

Consultez les factures encore dues à une date donnée, réparties par retard, avec paiements/crédits historiques, comparaison au grand livre et export CSV bilingue ([guide](docs/Age-des-comptes-fournisseurs.md)).

![Âge fournisseurs](docs/images/rapport-age-fournisseurs-desktop.png)

![Âge fournisseurs mobile](docs/images/rapport-age-fournisseurs-mobile.png)

### Sommaire TPS/TVQ et autres taxes

Consultez les montants comptabilisés par période, les ajustements et versements, avec détail et contrôle du grand livre. Export CSV bilingue; aucune déclaration ni écriture créée ([guide](docs/Sommaire-des-taxes.md)).

![Sommaire des taxes](docs/images/sommaire-taxes-desktop.png)

![Sommaire des taxes mobile](docs/images/sommaire-taxes-mobile.png)

### Comparaison de l’état des résultats

Comparez deux périodes depuis l’état des résultats : montants par compte, écarts exacts, pourcentages et export CSV bilingue ([guide](docs/Comparaison-des-resultats.md)).

![Résultats comparatifs](docs/images/resultats-comparatifs-desktop.png)

![Résultats comparatifs mobile](docs/images/resultats-comparatifs-mobile.png)

### Comparaison des bilans

Comparez les soldes à deux dates, les écarts par compte et l’équilibre de chaque bilan, avec un export CSV bilingue ([guide](docs/Comparaison-des-bilans.md)).

![Bilans comparatifs](docs/images/bilans-comparatifs-desktop.png)

![Bilans comparatifs mobile](docs/images/bilans-comparatifs-mobile.png)

### Impression des états financiers et PDF

Imprimez les résultats, le bilan et leurs comparatifs, ou enregistrez un PDF depuis le navigateur. Les menus sont masqués et les comparatifs passent en paysage ([guide](docs/Impression-des-etats-financiers.md)).

![Résultats en mode impression](docs/images/impression-resultats-desktop.png)

![Commande sur téléphone](docs/images/impression-resultats-mobile.png)
