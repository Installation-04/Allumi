# Mise à jour

## Procédure normale
```bash
cd /opt/allumi
sudo ./scripts/update.sh
```
Le script : sauvegarde, `git pull --ff-only`, reconstruit les images, applique les migrations (service `migrate`) et vérifie le healthcheck. Lis le `CHANGELOG.md` avant, surtout pour les versions majeures.

Option : `--no-backup` (déconseillé).

## Épingler une version
Pour la production, utilise une version étiquetée plutôt que `main` :
```bash
git fetch --tags
git checkout v0.3.0
docker compose up -d --build
```

## Retour arrière
Les migrations de base de données ne sont pas toujours réversibles. Le retour arrière sûr est donc :
1. `git checkout <ancienne-version>`
2. Restaurer la sauvegarde faite juste avant la mise à jour ([[Sauvegardes]]).
3. `docker compose up -d --build`

## Mises à jour du système
- `sudo apt update && sudo apt upgrade` régulièrement; active `unattended-upgrades`.
- Images : `docker compose pull db caddy && docker compose up -d` (PostgreSQL reste en version 17; un changement de version majeure demande un dump/restore).
