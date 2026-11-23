<p align="center">
  <img src="docs/images/allumi-banner.png" alt="Allumi — Votre comptabilité. Vos données." width="1200">
</p>

<h1 align="center">Allumi</h1>

<p align="center">
  <strong>La comptabilité auto-hébergée pour les PME du Québec et du Canada.</strong><br>
  Devis, factures, paiements, taxes et rapports, depuis votre propre serveur.
</p>

<p align="center">
  <a href="https://github.com/Installation-04/Allumi/actions/workflows/ci.yml"><img src="https://github.com/Installation-04/Allumi/actions/workflows/ci.yml/badge.svg?branch=main" alt="État de la CI"></a>
  <a href="https://github.com/Installation-04/Allumi/releases"><img src="https://img.shields.io/github/v/release/Installation-04/Allumi?include_prereleases&amp;label=version&amp;color=087f5b" alt="Dernière version, préversions comprises"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-087f5b" alt="Licence MIT"></a>
  <a href="docs/Installation-Docker.md"><img src="https://img.shields.io/badge/Docker-AMD64%20%7C%20ARM64-2496ed" alt="Docker AMD64 et ARM64"></a>
</p>

<p align="center"><a href="README.md" lang="en">English</a> · <strong>Français</strong></p>

<p align="center">
  <a href="#installer-allumi"><strong>Installer Allumi</strong></a> ·
  <a href="#en-images">Voir l’application</a> ·
  <a href="https://github.com/Installation-04/Allumi/wiki">Documentation</a> ·
  <a href="https://github.com/Installation-04/Allumi/releases">Téléchargements</a>
</p>

Allumi réunit le suivi commercial et la comptabilité dans une application web destinée aux petites entreprises et aux travailleurs autonomes. Préparez un devis, transformez-le en facture, enregistrez un paiement, rapprochez vos transactions et retrouvez vos chiffres dans les rapports. L’application fonctionne en **français ou en anglais**, avec les **thèmes clair et sombre**, sur ordinateur et téléphone.

Vous choisissez où héberger l’instance et ses données. Le code est ouvert sous licence **MIT**, et les clients web, Windows et iPhone se connectent au même serveur.

> [!NOTE]
> **Projet en pré-alpha.** Les fonctionnalités présentées sont disponibles dans les préversions, destinées aux essais avec des données fictives. Consultez les [fonctionnalités et limites](docs/Fonctionnalites-et-limites.md) avant d’évaluer Allumi pour votre activité.

## Installer Allumi

Sur une **VM Ubuntu 22.04/24.04 dédiée**, ouvrez un terminal avec `curl` et un compte disposant de droits root ou `sudo`, puis lancez :

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh
```

Le lanceur est récupéré directement depuis ce dépôt GitHub. Il détecte le système et le processeur, présente un récapitulatif, demande confirmation et récupère la dernière version étiquetée, **préversions comprises**. Il lance ensuite l’installateur adapté.

L’assistant vous guide pour choisir l’adresse de l’instance, le port et la langue. Sur Ubuntu, l’installation complète peut installer Docker, préparer l’application et PostgreSQL privé, configurer le pare-feu et planifier des sauvegardes chiffrées. Les images sont disponibles pour **AMD64 et ARM64**. Prévoyez au moins **2 Go de RAM et 5 Go d’espace libre** pour les images et la base.

- **Port proposé : `28080`.** Vous pouvez le changer dans l’assistant.
- **HTTPS local sur IP :** le certificat interne doit être approuvé sur vos appareils. [Configurer la confiance HTTPS](docs/HTTPS-local.md).
- **Premier accès :** utilisez l’URL et le jeton affichés à la fin pour créer l’administrateur et la première entreprise.
- **Sur Proxmox :** exécutez la commande **dans une VM Ubuntu**, pas sur l’hôte Proxmox. [Guide Proxmox](docs/Proxmox.md).

[Guide d’installation complet](docs/Installation-Docker.md) · [Lire le script avant de l’exécuter](scripts/get.sh) · [Premier démarrage](docs/Premier-demarrage.md)

<details>
<summary>Vérifier la compatibilité, choisir une version ou utiliser Docker déjà installé</summary>

<br>

**Diagnostic uniquement**, sans installation ni modification :

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --check
```

**Installer une version précise :**

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --version v0.4.0-alpha.84
```

**Docker Engine et Compose v2 déjà disponibles :**

```sh
curl -fsSL https://raw.githubusercontent.com/Installation-04/Allumi/main/scripts/get.sh | sh -s -- --docker-only
```

Ce mode utilise Docker et Compose déjà installés, sans configurer le pare-feu ni planifier de sauvegardes. Le lanceur peut installer Git s’il manque sur un système Debian/Ubuntu avec les droits requis. Voir les [options d’installation](docs/Installation-Docker.md).

</details>

## Ce que vous pouvez faire

| Pour votre activité | Dans Allumi |
| --- | --- |
| **Vendre et facturer** | [Devis](docs/Devis.md), conversion en facture brouillon, factures validées, avoirs, encaissements et remboursements clients. |
| **Communiquer avec vos clients** | Envoi manuel des [devis](docs/Envoi-des-devis.md) et [factures](docs/Envoi-des-factures.md) par SMTP, aperçus, confirmations et historiques; [relances individuelles](docs/Relances-clients.md) sur les factures échues. |
| **Préparer les factures récurrentes** | [Calendriers mensuels, trimestriels ou annuels](docs/Factures-recurrentes.md), génération confirmée de brouillons, pause et historique des échéances. |
| **Suivre les achats** | Factures, [crédits fournisseurs disponibles](docs/Credits-fournisseurs-disponibles.md), [affectations avec retrait daté](docs/Affectation-des-credits-fournisseurs.md), dépenses, paiements partiels ou complets et [historique filtrable avec export CSV](docs/Recherche-des-paiements-fournisseurs.md); clients, fournisseurs et catalogue de produits/services. |
| **Organiser les transactions** | Imports CSV/OFX et de transactions Stripe/PayPal, appariement aux écritures, règles de catégorisation avec aperçu, dépôts groupés et rapprochement bancaire. |
| **Gérer les taxes** | Codes et taux datés, calculs TPS/TVQ/TVH, consultation et import confirmé des [taux officiels ARC et Revenu Québec](docs/Sources-fiscales-officielles.md), avec provenance. |
| **Consulter vos chiffres** | Bilan, état des résultats, grand livre, balance, âge des comptes, relevés clients/fournisseurs, sommaires des taxes mensuels/trimestriels/annuels ou personnalisés, comparatifs et exports CSV; impression/PDF depuis le navigateur. |
| **Travailler à plusieurs** | Plusieurs entreprises, invitations, rôles et [permissions modulaires](docs/Utilisateurs-et-permissions.md), authentification à deux facteurs et piste d’audit. |

La comptabilité utilise la **partie double**, des montants exacts en cents ou Decimal, et des écritures validées immuables corrigées par contre-passation. Les accès sont contrôlés côté application et en base, avec isolation par entreprise.

Les flux bancaires directs, le suivi des stocks, la paie, la multidevise, la signature électronique et l’exécution planifiée des récurrences/relances restent à développer. Les fonctionnalités fiscales ne constituent pas un dépôt de déclaration. [Disponibilités et limites détaillées](docs/Fonctionnalites-et-limites.md).

### Migrer depuis QuickBooks

Reprenez les **clients, fournisseurs, produits/services hors inventaire et comptes** depuis des CSV QuickBooks Online ou Desktop. Vérifiez les associations et chaque ligne avant confirmation. La balance de bascule rapprochée ajuste les comptes ordinaires; les contrôles clients, fournisseurs et taxes doivent déjà correspondre aux pièces natives Allumi. Des modèles CSV/TSV vierges français/anglais sont téléchargeables dans l’assistant avec le séparateur choisi. L’historique détaillé et les fichiers QuickBooks natifs sont exclus. [Guide de migration](docs/Migration-QuickBooks.md).

![Modèles vierges de migration QuickBooks](docs/images/modele-migration-desktop.png)
![Balance de bascule sur mobile](docs/images/soldes-bascule-quickbooks-mobile.png)

## En images

### Votre activité en un coup d’œil

Le tableau de bord rassemble les indicateurs de l’entreprise. La navigation par activité donne accès aux ventes, dépenses, transactions et rapports.

![Tableau de bord Allumi sur ordinateur](docs/images/tableau-de-bord-desktop.png)

### Français, anglais, clair ou sombre

La langue et l’apparence se choisissent dans l’en-tête. Les préférences sont conservées dans votre navigateur.

![Tableau de bord Allumi en anglais et thème sombre](docs/images/dashboard-en-dark-desktop.png)

### Les nouveautés dans l’application

Ouvrez **Versions et mises à jour** pour lire les nouveautés, améliorations, corrections et consignes d’installation de votre version serveur, en français ou anglais. Les notes sont intégrées à Allumi et donnent accès aux guides. [Guide des nouveautés](docs/Nouveautes-des-versions.md).

![Nouveautés en français](docs/images/nouveautes-versions-desktop.png)

### Rapports de taxes selon votre période

Choisissez un mois, un trimestre ou une année civile, ou saisissez les dates de votre calendrier de déclaration. L’écran et le CSV utilisent les mêmes dates inclusives et montants comptabilisés. [Guide fiscal](docs/Sommaire-des-taxes.md).

Comparez les taxes comptabilisées de deux périodes : variations exactes, versements séparés et contrôles du grand livre pour chacune. Exportez les agrégats privés ou imprimez un PDF navigateur. [Guide du comparatif fiscal](docs/Comparaison-des-taxes.md).

![Comparaison des périodes de taxes](docs/images/taxes-comparatif-periodes-desktop.png)

![Rapport trimestriel en anglais sombre](docs/images/taxes-periodes-trimestre-en-dark-desktop.png)

### Imprimer les pièces fournisseurs

Ouvrez une copie comptable des factures et crédits fournisseurs validés ou annulés, puis imprimez ou enregistrez en PDF. Coordonnées figées et montants exacts, sans notes privées. [Guide d’impression](docs/Impression-des-achats.md).

![Copie comptable d’un crédit fournisseur en anglais sombre](docs/images/achats-impression-credit-en-dark-desktop.png)

### Affecter les crédits fournisseurs

Affectez les crédits disponibles aux factures du même fournisseur, avec révision des soldes et retrait daté. [Guide des affectations](docs/Affectation-des-credits-fournisseurs.md).

![Affectation en anglais sombre](docs/images/affectation-credit-fournisseur-en-dark-desktop.png)

### Remboursements reçus des fournisseurs

Comptabilisez un montant déjà reçu sur un crédit disponible, consultez ses origines et annulez-le par contre-passation datée. Soldes et rapports historiques restent rapprochés, sans recalcul des taxes. [Guide des remboursements fournisseurs](docs/Remboursements-fournisseurs.md).

![Remboursement en anglais sombre](docs/images/remboursement-fournisseur-en-dark-desktop.png)

Exportez tous les remboursements fournisseurs filtrés en CSV, au-delà de la page affichée. Montants exacts, dates originales et état actuel, sans notes privées. [Guide de l’export](docs/Export-des-remboursements-fournisseurs.md).

![Filtres et export des remboursements](docs/images/export-remboursements-fournisseurs-desktop.png)

Imprimez une copie comptable d’un remboursement fournisseur : montant original, origines complètes et date de contre-passation, sans notes privées. Enregistrez-la en PDF depuis le navigateur, en français ou en anglais. [Guide d’impression](docs/Impression-des-remboursements-fournisseurs.md).

![Copie comptable du remboursement fournisseur](docs/images/impression-remboursement-fournisseur-desktop.png)

Retrouvez les résultats autorisés pendant la frappe dans l’en-tête : huit propositions maximum, clavier/tactile et accès à la recherche complète. [Guide des suggestions](docs/Suggestions-de-recherche.md).

![Suggestions de recherche](docs/images/suggestions-recherche-desktop.png)

### Importer les objectifs annuels

Créez un nouveau budget depuis un CSV UTF-8 après aperçu local des objectifs. Formats de fichiers français/anglais, cents exacts, confirmation explicite, validation serveur et audit atomique; les budgets existants restent indépendants. [Guide](https://github.com/Installation-04/Allumi/wiki/Import-CSV-des-budgets).

![Import des objectifs annuels](docs/images/import-budget-csv-desktop.png)

[Référence mobile](docs/images/import-budget-csv-mobile.png)

### Importer les répartitions mensuelles

Vérifiez les montants actuels et proposés localement avant de remplacer les comptes listés dans un CSV. Annuels et comptes absents restent intacts; les cellules vides retirent un objectif et les zéros restent définis. Cents exacts, plafonds annuels, aperçu périmé refusé et audit atomique. [Guide](https://github.com/Installation-04/Allumi/wiki/Import-CSV-des-budgets-mensuels).

![Import des répartitions mensuelles](docs/images/import-budget-mensuel-desktop.png)

[Référence mobile](docs/images/import-budget-mensuel-mobile.png)

### Reprendre les répartitions mensuelles

Reprenez les objectifs annuels et leurs montants mensuels définis dans un scénario ou exercice indépendant. Vérifiez les douze correspondances fiscales avant confirmation; les zéros et les mois absents restent distincts. Exclusions explicites, refus des aperçus périmés et aucune écriture réelle copiée. [Guide](https://github.com/Installation-04/Allumi/wiki/Duplication-des-budgets-mensuels).

![Copie des répartitions mensuelles](docs/images/duplication-budget-mensuel-desktop.png)

[Référence mobile](docs/images/duplication-budget-mensuel-mobile.png)

### Budgets mensuels

Répartissez les objectifs annuels sur les douze périodes fiscales, proposez une division exacte et comparez chaque période au réel comptabilisé. Champs vides distincts de zéro, plafond annuel, révisions et permissions protègent les changements. Export CSV privé FR/EN. [Guide](https://github.com/Installation-04/Allumi/wiki/Budgets-mensuels).

![Budget mensuel](docs/images/budget-mensuel-desktop.png)

[Référence mobile](docs/images/budget-mensuel-mobile.png) · [Éditeur de répartition](docs/images/repartition-mensuelle-desktop.png)

### Reprendre un budget

Dupliquez les objectifs annuels vers un nouveau scénario ou exercice après aperçu. Les exclusions des comptes inactifs sont explicites et les aperçus périmés sont refusés. La source reste indépendante; aucune écriture n’est créée. [Guide](https://github.com/Installation-04/Allumi/wiki/Duplication-des-budgets).

![Aperçu de duplication](docs/images/duplication-budget-desktop.png)

[Référence mobile](docs/images/duplication-budget-mobile.png)

### Budgets annuels

Créez des scénarios par exercice, définissez vos objectifs de revenus/charges et comparez-les au réel comptabilisé. Objectifs absents signalés, modifications concurrentes refusées et CSV exact FR/EN. L’exercice complet inclut toutes les écritures datées de la période; les prévisions mensuelles ne sont pas incluses. [Guide](https://github.com/Installation-04/Allumi/wiki/Budgets-annuels).

![Budget annuel](docs/images/budgets-annuels-desktop.png)

[Référence mobile](docs/images/budgets-annuels-mobile.png)


Retrouvez 13 formulaires de rapports financiers par nom français/anglais et synonymes explicites, avec destinations filtrées selon vos droits. [Guide de recherche des rapports](docs/Recherche-des-rapports.md).

![Recherche des rapports](docs/images/recherche-rapports-desktop.png)

Recherchez les transactions bancaires CAD importées par libellé/bénéficiaire, date, état actuel et montant net exact. Les signes et liens vers les fiches sont conservés. [Guide de recherche bancaire](docs/Recherche-bancaire.md).

![Recherche bancaire](docs/images/recherche-bancaire-desktop.png)

Comparez les codes fiscaux importés ou manuels aux taux standards officiels pour une province et une date. Vérifiez les écarts par composante et la couverture datée en lecture seule. [Guide de comparaison fiscale](docs/Comparaison-des-codes-fiscaux.md).

![Comparaison des taux officiels](docs/images/comparaison-code-fiscal-ecart-desktop.png)

Retrouvez les comptes dans les deux langues et ouvrez leur historique, y compris inactifs. Recherchez les écritures manuelles/d’ouverture et leurs contre-passations par numéro, date et total exact des débits, sans rechercher les notes privées. [Guide de recherche comptable](docs/Recherche-comptable.md).

![Compte inactif dans la recherche](docs/images/recherche-comptable-compte-desktop.png)

### Historique des paiements fournisseurs

Retrouvez les paiements par fournisseur, numéro ou référence, filtrez par date et état, puis exportez tous les résultats en CSV. [Guide des paiements fournisseurs](docs/Recherche-des-paiements-fournisseurs.md).

![Filtres des paiements fournisseurs et export CSV en anglais sombre](docs/images/decaissements-recherche-en-dark-desktop.png)

### Sur téléphone aussi

<table>
  <tr>
    <td align="center"><strong>Tableau de bord</strong></td>
    <td align="center"><strong>Contacts en anglais sombre</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tableau-de-bord-mobile.png" alt="Tableau de bord Allumi sur téléphone" width="280"></td>
    <td align="center"><img src="docs/images/contacts-en-dark-mobile.png" alt="Répertoire des contacts en anglais sombre sur téléphone" width="280"></td>
  </tr>
</table>

Captures réelles de l’application avec des données fictives; les vues mobiles sont émulées avec Chromium. [Explorer la galerie complète dans le wiki](https://github.com/Installation-04/Allumi/wiki/References-visuelles).

## Choisissez votre accès

| Accès | Comment l’utiliser |
| --- | --- |
| **Navigateur** | Ouvrez l’URL de votre serveur sur ordinateur, tablette ou téléphone. |
| **Windows x64** | Téléchargez l’installateur `.exe` dans les [Releases](https://github.com/Installation-04/Allumi/releases), puis connectez le client à votre serveur. [Guide Windows](docs/Client-Windows.md). |
| **iPhone / iPad** | Dans Safari : **Partager → Sur l’écran d’accueil**, puis ouvrez Allumi depuis son icône. [Guide iOS](docs/Application-mobile.md). |
| **Serveur Docker** | Déployez les images Linux AMD64/ARM64 sur votre infrastructure. [Guide Docker](docs/Installation-Docker.md). |

Le client Windows et l’app web ajoutée à l’écran d’accueil nécessitent une connexion au serveur; ils ne constituent pas une version de comptabilité hors ligne.

## Exploiter votre instance

Depuis l’administration, les opérateurs autorisés peuvent consulter la version et demander une mise à jour du serveur, avec confirmation de la sauvegarde et de l’interruption. L’installateur active par défaut l’agent de mise à jour web sur les hôtes Linux compatibles exécutés en root avec Python 3 et systemd actif. Pour une installation existante, suivez le [guide des mises à jour](docs/Mise-a-jour.md).

Les sauvegardes chiffrées, la restauration, les journaux d’opérations et les rôles d’administration sont décrits dans le wiki. Les mises à jour du serveur et du client Windows sont distinctes; le web et l’app iOS suivent la version du serveur.

[Administration serveur](docs/Administration-serveur.md) · [Sauvegardes et restauration](docs/Sauvegardes.md) · [Sécurité](SECURITY.md)

## Documentation et contribution

- **Prendre en main l’application :** [guide utilisateur](docs/Guide-utilisateur.md), [wiki GitHub](https://github.com/Installation-04/Allumi/wiki) et [FAQ](docs/FAQ.md).
- **Installer et configurer :** [Docker](docs/Installation-Docker.md), [Proxmox](docs/Proxmox.md), [configuration](docs/Configuration.md) et [dépannage](docs/Depannage.md).
- **Développer et contribuer :** [développement local](docs/Developpement-local.md), [environnement cloud](docs/Developpement-cloud.md), [architecture](docs/Architecture.md) et [contributions](CONTRIBUTING.md).
- **Suivre le projet :** [versions et changelog](CHANGELOG.md), [feuille de route publique](docs/Feuille-de-route.md) et [signalement d’un problème](https://github.com/Installation-04/Allumi/issues).

Les guides sources et les captures sont conservés dans [`docs/`](docs/). Les propositions, corrections, traductions et retours d’essai sont les bienvenus.



## Licence

Allumi est distribué sous [licence MIT](LICENSE). Il ne remplace pas l’accompagnement d’un professionnel comptable ou fiscal; les règles et taux applicables restent à vérifier pour votre situation.
