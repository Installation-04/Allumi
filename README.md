# Allumi

Logiciel de comptabilité **open source** et **auto-hébergeable** pour les PME et les travailleurs autonomes du Québec et du Canada. Une alternative libre aux logiciels de comptabilité infonuagiques propriétaires.

> **État : pré-alpha.** Le squelette fonctionne (premier démarrage, connexion, vérification en deux étapes, interface FR/EN, Docker); le moteur comptable (plan comptable, journal, périodes, audit) est en place, les contacts sont disponibles; taxes, factures et paiements arrivent ensuite ([feuille de route](docs/Feuille-de-route.md)). N'utilise pas Allumi pour de la comptabilité réelle avant une version stable.

*English summary: Allumi is an open-source, self-hostable accounting app for Canadian small businesses (QST/GST aware, French-first, bilingual). The repo ships a Docker Compose stack, an Ubuntu install script, encrypted backups and a full wiki in `docs/`. Application code is in pre-alpha.*

## Fonctions visées (MVP)
- Plan comptable et journal à partie double
- Clients, fournisseurs, factures, paiements, dépenses
- Rapprochement bancaire (CSV/OFX)
- TPS/TVQ avec taux configurables
- Rapports : balance de vérification, bilan, état des résultats, âge des comptes
- Multi-entreprise, rôles, piste d'audit
- Interface en français (par défaut) et en anglais

## Installation rapide (Ubuntu 22.04/24.04)

Prérequis : un serveur Ubuntu avec accès root, un nom de domaine dont l'enregistrement DNS pointe vers le serveur.

```bash
git clone https://github.com/Installation-04/Allumi.git /opt/allumi
cd /opt/allumi
sudo ./scripts/install.sh --domain compta.exemple.ca --email admin@exemple.ca
```

Le script installe Docker, configure le pare-feu, génère les secrets, démarre la pile (PostgreSQL, application, Caddy avec HTTPS automatique) et planifie des sauvegardes chiffrées quotidiennes. Détails : [`docs/Installation.md`](docs/Installation.md).

## Windows, iPhone et Proxmox

Le client Windows de la préversion v0.2.0-alpha.2 est distribué via les [Releases](https://github.com/Installation-04/Allumi/releases), avec leur version et leurs sommes de contrôle. Voir le [client Windows](docs/Client-Windows.md). Sur iPhone : **Safari → Partager → Sur l’écran d’accueil**, puis ouvrir Allumi depuis son icône ([guide iOS](docs/Application-mobile.md)). Une connexion au serveur est nécessaire.

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

Le [wiki GitHub](https://github.com/Installation-04/Allumi/wiki) regroupe le guide utilisateur, l’installation, l’exploitation, l’architecture et la feuille de route. Voir le [guide utilisateur](docs/Guide-utilisateur.md), les [fonctionnalités et limites](docs/Fonctionnalites-et-limites.md) et les [captures de référence](docs/References-visuelles.md). Les fichiers PNG originaux sont dans [docs/images](docs/images). La refonte est intégrée; les captures présentent les contacts intégrés.

Captures réelles de l’entreprise fictive des tests, sur Chromium (19 octobre 2026). Les vues mobiles sont émulées à 412 × 839 px; elles ne remplacent pas les essais sur appareil physique.

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
