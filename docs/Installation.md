# Installation

Cette page explique comment installer Allumi sur un serveur Ubuntu avec Docker Compose et HTTPS automatique (Caddy).

## Prérequis
| Élément | Minimum | Recommandé |
|---|---|---|
| Système | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU / RAM | 1 vCPU / 2 Go | 2 vCPU / 4 Go |
| Disque | 20 Go | 40 Go SSD |
| Réseau | Ports 80 et 443 ouverts | IP fixe |
| Domaine | Un enregistrement DNS **A** (et AAAA si IPv6) vers le serveur | |

**Hébergement** : pour des données d'entreprises québécoises, choisis un fournisseur avec une région canadienne (voir [[Securite-et-Loi-25]]). Un serveur maison convient pour tester, pas pour des clients payants.

## Installation en une commande
```bash
git clone https://github.com/OWNER/allumi.git /opt/allumi
cd /opt/allumi
sudo ./scripts/install.sh --domain compta.exemple.ca --email admin@exemple.ca
```

Options : `--no-firewall` (ne touche pas à ufw), `--no-cron` (pas de sauvegarde planifiée).

### Ce que fait le script
1. Installe Docker Engine et le plugin Compose (dépôt officiel Docker).
2. Configure le pare-feu ufw : SSH, 80, 443.
3. Crée `.env` (permissions 600) avec des secrets aléatoires, dont le mot de passe du rôle restreint de l'application.
4. Construit les images et démarre PostgreSQL, les migrations (qui configurent aussi ce rôle), l'application et Caddy.
5. Attend que l'application soit « healthy ».
6. Planifie une sauvegarde quotidienne à 02 h 30 (`/etc/cron.d/allumi-backup`).

Le script est **idempotent** : le relancer ne régénère pas les secrets existants.

## Premier démarrage
Ouvre `https://ton-domaine`. Si aucun utilisateur n'existe, la page `/setup` te demande de créer l'entreprise et le compte administrateur, puis se désactive : voir [[Premier-demarrage]]. Active ensuite la 2FA ([[Authentification]]).

## Installation manuelle
```bash
cp .env.example .env && chmod 600 .env
# Remplace tous les CHANGE_ME (openssl rand -hex 24 / -base64 48), domaine, courriel
# Attention : POSTGRES_PASSWORD doit aussi apparaître dans DATABASE_URL, et APP_DB_PASSWORD dans APP_DATABASE_URL
# Renseigne aussi SETUP_TOKEN (openssl rand -hex 16) : sans lui, la page /setup reste fermée sur un serveur public en HTTPS
docker compose up -d --build
docker compose ps
```

## Vérifier
```bash
docker compose ps                 # tous les services « running », app « healthy »
curl -fsS https://ton-domaine/api/health
```

## Étapes recommandées après l'installation
1. Configurer le SMTP dans `.env` (courriels de facture, réinitialisation) puis `docker compose up -d`.
2. Configurer les sauvegardes chiffrées et hors site : [[Sauvegardes]].
3. **Tester une restauration** sur un autre serveur avant d'avoir des données importantes.
4. Activer les mises à jour de sécurité automatiques : `sudo apt install unattended-upgrades`.
5. Lire [[Securite-et-Loi-25]].

Problème ? [[Depannage]].
