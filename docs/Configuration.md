# Configuration

Toute la configuration passe par des variables d'environnement, lues depuis le fichier `.env` à la racine. Après une modification : `docker compose up -d`.

> Le fichier `.env` contient des secrets : permissions `600`, jamais dans Git, copie dans un gestionnaire de mots de passe. Ne le « source » pas dans un shell (`source .env`) : certaines valeurs, comme `SMTP_FROM`, contiennent des espaces.

## Accès web et proxy externe

| Variable | Rôle |
|---|---|
| `APP_URL` | Origine utilisée par le navigateur, ex. `http://192.168.1.20:28080`, ou HTTPS fourni par votre proxy externe. |
| `ALLUMI_BIND_ADDRESS` | IPv4 d’écoute sur l’hôte, défaut `0.0.0.0`; `127.0.0.1` pour accès local seulement. |
| `ALLUMI_HTTP_PORT` | Port HTTP publié de l’application, défaut `28080`, vers le port interne 3000. |
| `ALLUMI_NETWORK_MODE` | Marqueur de migration réseau géré par les scripts; laisser `direct`. |

Aucun proxy ni certificat n’est fourni. PostgreSQL reste privé. Les anciennes clés `ALLUMI_DOMAIN`, `ACME_EMAIL`, `ALLUMI_HTTPS_PORT` sont ignorées. Voir [[Installation-Docker]] pour la transition depuis Caddy.

## Base de données
| Variable | Description |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER` | Nom de la base et de l'utilisateur (défaut `allumi`). |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL. |
| `DATABASE_URL` | URL de connexion du **propriétaire** de la base. Utilisée seulement par le service `migrate` (migrations, sauvegardes). Doit contenir le même mot de passe que `POSTGRES_PASSWORD`. L'hôte est `db` (réseau Docker interne). **L'application ne la reçoit jamais.** |
| `APP_DB_PASSWORD` | Mot de passe du rôle restreint `allumi_app`. Généré par `install.sh`; le service `migrate` le configure à chaque démarrage. |
| `APP_DATABASE_URL` | URL utilisée par l'application (rôle `allumi_app`, sans droit de contourner la sécurité par ligne). Doit contenir `APP_DB_PASSWORD`. L'application refuse de démarrer si elle est identique à `DATABASE_URL` ou si le rôle est superutilisateur. |

PostgreSQL n'est **pas** exposé hors du réseau Docker en production. Pourquoi deux rôles ? Le rôle propriétaire contourne l'isolation entre entreprises; l'application utilise donc un rôle restreint : voir [[Architecture]].

## Sécurité
| Variable | Description |
|---|---|
| `AUTH_SECRET` | Clé des empreintes des compteurs anti-abus (adresses IP et courriels ne sont jamais stockés en clair). Générée par `install.sh`. Tu peux la changer à tout moment : les compteurs repartent à zéro, rien d'autre n'est touché. Les sessions sont des jetons aléatoires dans la base, pas des signatures : pour **déconnecter tout le monde**, vide la table des sessions (`DELETE FROM session;`, voir [[Depannage]]). |
| `ENCRYPTION_KEY` | Chiffrement des champs sensibles (secrets 2FA, clés d’API des [[Integrations]]) et empreinte des codes de récupération. **Ne la perds jamais ni ne la change** sans procédure : les secrets 2FA deviendraient illisibles, les codes de récupération inutilisables et les clés des intégrations à remplacer. Garde-la dans ta copie de secrets. |

## Application
| Variable | Description |
|---|---|
| `NODE_ENV` | `production` en prod. |
| `LOG_LEVEL` | `silent`, `fatal`, `error`, `warn`, `info` (défaut), `debug`, `trace`. Journaux JSON sur la sortie standard; jamais de secrets ni de renseignements personnels. |
| `DEFAULT_LOCALE` | `fr-CA` (défaut) ou `en`. |
| `SETUP_TOKEN` | Jeton privé de première configuration, généré par les scripts. En production, `/setup` reste fermé sans jeton, en HTTP comme en HTTPS. |
| `TRUSTED_PROXY_HOPS` | De 0 à 5, défaut 0 : accès direct, en-têtes transférés ignorés et budget IP partagé. Avec un proxy externe, renseigner le nombre de proxys de confiance et empêcher tout accès direct contournant ces proxys. |

## Courriel (SMTP)
`SMTP_HOST`, `SMTP_PORT` (587 par défaut), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Utilise un service transactionnel avec SPF, DKIM et DMARC configurés sur ton domaine, sinon les factures risquent d'aboutir dans les pourriels.

## Sauvegardes
| Variable | Description |
|---|---|
| `BACKUP_DIR` | Dossier local (défaut `/var/backups/allumi`). |
| `BACKUP_RETENTION_DAYS` | Jours de conservation locale (défaut 30). |
| `BACKUP_AGE_RECIPIENT` | Clé **publique** age pour chiffrer. La clé privée reste hors du serveur. |
| `BACKUP_RCLONE_REMOTE` | Destination rclone hors site (ex. `remote:allumi-backups`). |

Détails : [[Sauvegardes]].

## Ajouter une variable (contributeurs)
Toute nouvelle variable consommée par l’application doit être ajoutée à `.env.example`, validée au démarrage (Zod, dans `src/platform/env.ts`), transmise à l'application dans `docker-compose.yml` (liste explicite : le service `app` ne lit pas tout le `.env`) et documentée ici, dans le même commit.

Les variables de publication réseau sont propres à Compose. L’application écoute sur 3000 et PostgreSQL sur 5432 dans le réseau interne; seul le port de l’application est publié.

Au démarrage, une variable manquante ou invalide arrête l'application avec un message qui les nomme toutes (voir [[Depannage]]).
