# Mise à jour

## Procédure normale
```bash
cd /opt/allumi
sudo ./scripts/update.sh
```
Le script : sauvegarde, récupère la nouvelle version (`git pull --ff-only` sur une branche), complète ton `.env` des variables ajoutées depuis (sans toucher aux existantes), reconstruit les images, applique les migrations (service `migrate`) et vérifie le healthcheck. Lis le `CHANGELOG.md` avant, surtout pour les versions majeures.

Options : `--no-backup` (déconseillé) et une version, par exemple `sudo ./scripts/update.sh v0.3.0` (voir ci-dessous).

## Épingler une version
Les numéros et le processus de publication sont décrits dans [[Versions-et-releases]].

Pour la production, utilise une version étiquetée plutôt que `main` :
```bash
sudo ./scripts/update.sh v0.3.0
```
Le script sauvegarde, se place sur l'étiquette, reconstruit et vérifie le healthcheck. Sur une version épinglée (HEAD détachée), lancer `update.sh` sans version ne tire rien : il reconstruit seulement.

## Retour arrière
Les migrations de base de données ne sont pas toujours réversibles. Le retour arrière sûr est donc :
1. `git checkout <ancienne-version>`
2. Restaurer la sauvegarde faite juste avant la mise à jour ([[Sauvegardes]]).
3. `docker compose up -d --build`

## Mises à jour du système
- `sudo apt update && sudo apt upgrade` régulièrement; active `unattended-upgrades`.
- Images : `docker compose pull db caddy && docker compose up -d` (PostgreSQL reste en version 17; un changement de version majeure demande un dump/restore).
