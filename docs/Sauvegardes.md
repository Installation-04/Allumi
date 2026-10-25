# Sauvegardes

Règle 3-2-1 : 3 copies, 2 supports différents, 1 copie **hors site**. Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

## Ce qui est sauvegardé
- La base PostgreSQL (`pg_dump` format custom).
- Les pièces jointes (`/app/storage`).
- **Pas** le fichier `.env` : garde-le séparément dans un gestionnaire de mots de passe (surtout `ENCRYPTION_KEY`, sans laquelle les secrets 2FA et les clés des [[Integrations]] contenus dans la sauvegarde sont illisibles).

## Mettre en place le chiffrement (age)
Sur **ta machine** (pas sur le serveur) :
```bash
sudo apt install age        # ou brew install age
age-keygen -o allumi-backup.key
# Affiche : Public key: age1xxxxxxxx...
```
- Garde `allumi-backup.key` (clé privée) dans un endroit sûr, **hors du serveur**.
- Mets la clé publique `age1...` dans `.env` : `BACKUP_AGE_RECIPIENT=age1...`.

## Envoi hors site (rclone)
```bash
sudo apt install rclone
sudo rclone config        # crée un « remote » (S3, Backblaze B2, Wasabi, SFTP, etc.)
```
Puis dans `.env` : `BACKUP_RCLONE_REMOTE=nom-du-remote:allumi-backups`. Pour la Loi 25, choisis un stockage situé au Canada (voir [[Securite-et-Loi-25]]).

## Lancer / planifier
```bash
sudo ./scripts/backup.sh
```
`install.sh` planifie l'exécution quotidienne à 02 h 30; journal : `/var/log/allumi-backup.log`.

## Restaurer
```bash
sudo ./scripts/restore.sh /var/backups/allumi/allumi-20260101-023000.tar.age ~/allumi-backup.key
```
Le script demande confirmation, remplace la base et les pièces jointes, puis redémarre. Il crée d'abord les rôles PostgreSQL de l'application s'ils manquent (les rôles appartiennent au serveur, pas à la base : ils ne sont pas dans la sauvegarde, alors que leurs droits y sont), restaure en une seule transaction qui s'arrête à la première erreur, recalcule les statistiques (`ANALYZE`), puis le service `migrate` redonne son mot de passe au rôle de l'application.

### Restaurer sur un nouveau serveur (reprise après sinistre)
1. Cloner le dépôt (même version si possible) et **mettre ta copie de `.env` en place avant tout** (mêmes `ENCRYPTION_KEY` et `AUTH_SECRET`; `POSTGRES_PASSWORD` doit rester cohérent avec `DATABASE_URL`, et `APP_DB_PASSWORD` avec `APP_DATABASE_URL`). PostgreSQL n'applique `POSTGRES_PASSWORD` qu'à la **première** initialisation de son volume : si `install.sh` tournait d'abord avec un autre `.env`, le mot de passe ne correspondrait plus.
2. Lancer `sudo ./scripts/install.sh --domain <domaine> --email <courriel>` : il garde les secrets existants et ne change que le domaine et le courriel : [[Installation]].
3. Copier la sauvegarde sur le serveur et lancer `restore.sh`.

Les sauvegardes **conservent les propriétaires** des objets (pas de `--no-owner`) : la fonction de caviardage de la Loi 25 appartient à un rôle dédié, et la restaurer sous un autre propriétaire la ferait échouer sans bruit. Le service `migrate` remet de toute façon ce propriétaire en place à chaque démarrage.

## Test de restauration
Tous les trimestres, restaure une sauvegarde récente sur un serveur de test et vérifie que la balance de vérification correspond.
