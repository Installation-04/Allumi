# Allumi

Logiciel de comptabilité **open source** et **auto-hébergeable** pour les PME et les travailleurs autonomes du Québec et du Canada. Une alternative libre aux logiciels de comptabilité infonuagiques propriétaires.

> **État : pré-alpha.** Le squelette fonctionne (premier démarrage, connexion, vérification en deux étapes, interface FR/EN, Docker); le moteur comptable (plan comptable, journal, périodes, audit) est en place, les contacts, taxes, factures et paiements arrivent ensuite ([feuille de route](docs/Feuille-de-route.md)). N'utilise pas Allumi pour de la comptabilité réelle avant une version stable.

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
# Remplace OWNER par ton compte ou ton organisation GitHub
git clone https://github.com/OWNER/allumi.git /opt/allumi
cd /opt/allumi
sudo ./scripts/install.sh --domain compta.exemple.ca --email admin@exemple.ca
```

Le script installe Docker, configure le pare-feu, génère les secrets, démarre la pile (PostgreSQL, application, Caddy avec HTTPS automatique) et planifie des sauvegardes chiffrées quotidiennes. Détails : [`docs/Installation.md`](docs/Installation.md).

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

Le [wiki GitHub](https://github.com/Installation-04/Allumi/wiki) regroupe le guide utilisateur, l’installation, l’exploitation, l’architecture et la feuille de route. Voir le [guide utilisateur](docs/Guide-utilisateur.md), les [fonctionnalités et limites](docs/Fonctionnalites-et-limites.md) et les [captures de référence](docs/References-visuelles.md). Les fichiers PNG originaux sont dans [docs/images](docs/images). Les captures de refonte décrivent la branche en revue jusqu’à son intégration.
