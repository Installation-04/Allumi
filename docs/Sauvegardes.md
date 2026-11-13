# Sauvegardes

Règle 3-2-1 : 3 copies, 2 supports différents, 1 copie **hors site**. Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

## Ce qui est sauvegardé
- La base PostgreSQL (`pg_dump` format custom).
- Les pièces jointes (`/app/storage`).
- En mode HTTPS local, les données et la configuration Caddy dans `local-tls.tar.gz`, y compris l’autorité et ses clés privées, afin de préserver la confiance des appareils. Cette archive interne est créée avec permissions 600 puis incluse dans la sauvegarde habituelle; le chiffrement `age` reste optionnel mais est recommandé. Aucune clé privée de cette archive ne doit être transférée aux appareils clients ou à l’application web.
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
Le script demande confirmation, valide l’archive extérieure et sa structure, contrôle l’archive interne des pièces jointes, puis vérifie la configuration HTTPS locale rendue avant tout arrêt de service ou remplacement de la base. Une archive ou une configuration refusée doit être corrigée avant de reprendre; le contrôle ne justifie pas de contourner une erreur. Après ces vérifications, il remplace la base et les pièces jointes, puis redémarre. Il crée d'abord les rôles PostgreSQL de l'application s'ils manquent (les rôles appartiennent au serveur, pas à la base : ils ne sont pas dans la sauvegarde, alors que leurs droits y sont), restaure en une seule transaction qui s'arrête à la première erreur, recalcule les statistiques (`ANALYZE`), puis le service `migrate` redonne son mot de passe au rôle de l'application.

L’archive des pièces jointes doit contenir une racine `storage/` et uniquement des fichiers ordinaires ou des répertoires sous cette racine. Les chemins absolus, traversées `..`, liens symboliques ou physiques, fichiers spéciaux, doublons et conflits entre fichier et répertoire sont refusés avant l’arrêt du service et avant toute modification de la base. Les répertoires `storage/update-control` et `storage/server-control` sont également refusés : une restauration ne doit pas rejouer de demandes privilégiées. Les noms Unicode, fichiers cachés et répertoires vides restent acceptés. Une archive refusée doit être examinée et recréée depuis une source fiable, sans désactiver le contrôle.

Après validation, le remplacement des pièces jointes supprime aussi les anciens fichiers cachés absents de la sauvegarde. L’extraction s’exécute dans un conteneur sans réseau et avec système racine en lecture seule; seul le volume de stockage est remplacé.

### Restaurer sur un nouveau serveur (reprise après sinistre)
1. Cloner le dépôt (même version si possible) et **mettre ta copie de `.env` en place avant tout** (mêmes `ENCRYPTION_KEY` et `AUTH_SECRET`; `POSTGRES_PASSWORD` doit rester cohérent avec `DATABASE_URL`, et `APP_DB_PASSWORD` avec `APP_DATABASE_URL`). PostgreSQL n'applique `POSTGRES_PASSWORD` qu'à la **première** initialisation de son volume : si `install.sh` tournait d'abord avec un autre `.env`, le mot de passe ne correspondrait plus.
2. Préparer les services avec la même version et le même mode réseau que la sauvegarde, sans régénérer les secrets : [[Installation-Docker]]. Pour HTTPS local, conserver les réglages et l’overlay de [[HTTPS-local]]. Le fichier `.env` reste une copie séparée, jamais un élément supposé de l’archive.
3. Copier la sauvegarde sur le serveur et lancer `restore.sh`.

Les sauvegardes **conservent les propriétaires** des objets (pas de `--no-owner`) : la fonction de caviardage de la Loi 25 appartient à un rôle dédié, et la restaurer sous un autre propriétaire la ferait échouer sans bruit. Le service `migrate` remet de toute façon ce propriétaire en place à chaque démarrage.

## Restaurer l’autorité HTTPS locale

En mode `local-https`, la restauration exige une archive `local-tls.tar.gz` complète et valide avant d’arrêter les services ou de remplacer la base. Elle restaure les volumes Caddy et la même autorité. Si le contrôle préalable échoue, aucune autorité de remplacement n’est générée. Pour un refus de configuration Compose, corriger la surcharge puis vérifier avec `sudo ./scripts/enable-local-https.sh --check` avant de relancer la restauration : [[HTTPS-local]]. Une sauvegarde ancienne sans données TLS n’est pas silencieusement transformée en nouvelle autorité : restaurer délibérément en HTTP ou choisir une sauvegarde HTTPS complète.

Après restauration, exporter uniquement le certificat public avec `scripts/enable-local-https.sh --export-ca` et comparer l’empreinte attendue. Si l’autorité a été conservée, la confiance déjà installée sur les appareils peut être réutilisée. Si elle a été remplacée volontairement, vérifier puis déployer la nouvelle autorité sur chaque appareil et retirer l’ancienne selon la politique du poste : [[HTTPS-local]]. Les clés privées restent sur le serveur et dans les sauvegardes protégées.

## Test de restauration
Tous les trimestres, restaure une sauvegarde récente sur un serveur de test et vérifie que la balance de vérification correspond.
