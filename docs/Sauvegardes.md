# Sauvegardes

Règle 3-2-1 : 3 copies, 2 supports différents, 1 copie **hors site**. Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

## Ce qui est sauvegardé
- La base PostgreSQL (`pg_dump` format custom).
- Les pièces jointes (`/app/storage`).
- **Pas** le fichier `.env` : garde-le séparément dans un gestionnaire de mots de passe (surtout `ENCRYPTION_KEY`).

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
Le script demande confirmation, remplace la base et les pièces jointes, puis redémarre.

### Restaurer sur un nouveau serveur (reprise après sinistre)
1. Installer Allumi : [[Installation]] (même version si possible).
2. Remplacer `.env` par ta copie de sauvegarde (mêmes `ENCRYPTION_KEY` et `AUTH_SECRET`; l'ancien mot de passe PostgreSQL doit rester cohérent avec `DATABASE_URL`).
3. Copier la sauvegarde sur le serveur et lancer `restore.sh`.

## Test de restauration
Tous les trimestres, restaure une sauvegarde récente sur un serveur de test et vérifie que la balance de vérification correspond.
