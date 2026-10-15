# Configuration

Toute la configuration passe par des variables d'environnement, lues depuis le fichier `.env` à la racine. Après une modification : `docker compose up -d`.

> Le fichier `.env` contient des secrets : permissions `600`, jamais dans Git, copie dans un gestionnaire de mots de passe.

## Domaine et HTTPS
| Variable | Description |
|---|---|
| `ALLUMI_DOMAIN` | Nom de domaine public (ex. `compta.exemple.ca`). Caddy obtient le certificat automatiquement. |
| `ACME_EMAIL` | Courriel pour les avis d'expiration du certificat. |
| `APP_URL` | URL publique complète, avec `https://`. |

## Base de données
| Variable | Description |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER` | Nom de la base et de l'utilisateur (défaut `allumi`). |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL. |
| `DATABASE_URL` | URL de connexion. Doit contenir le même mot de passe. L'hôte est `db` (réseau Docker interne). |

PostgreSQL n'est **pas** exposé hors du réseau Docker en production.

## Sécurité
| Variable | Description |
|---|---|
| `AUTH_SECRET` | Signature des sessions. Générée par `install.sh`. Si elle change, tout le monde est déconnecté. |
| `ENCRYPTION_KEY` | Chiffrement des champs sensibles (ex. secrets 2FA). **Ne la perds jamais ni ne la change** sans procédure : les données chiffrées deviendraient illisibles. Garde-la dans ta copie de secrets. |

## Application
| Variable | Description |
|---|---|
| `NODE_ENV` | `production` en prod. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`. |
| `DEFAULT_LOCALE` | `fr-CA` (défaut) ou `en`. |

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
Toute nouvelle variable doit être ajoutée à `.env.example`, validée au démarrage (Zod) et documentée ici dans le même commit.
