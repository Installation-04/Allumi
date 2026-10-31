# Mise à jour

## Procédure normale
```bash
cd /opt/allumi
sudo ./scripts/update.sh
```
Le script : sauvegarde, récupère la nouvelle version (`git pull --ff-only` sur une branche), complète ton `.env` des variables ajoutées depuis (sans toucher aux existantes), reconstruit les images, applique les migrations (service `migrate`) et vérifie le healthcheck. Lis le `CHANGELOG.md` avant, surtout pour les versions majeures.

Options : `--no-backup` (déconseillé) et une version, par exemple `sudo ./scripts/update.sh v0.4.0-alpha.19` (voir ci-dessous).

## Épingler une version
Les numéros et le processus de publication sont décrits dans [[Versions-et-releases]].

Pour la production, utilise une version étiquetée plutôt que `main` :
```bash
sudo ./scripts/update.sh v0.4.0-alpha.19
```
Le script sauvegarde, se place sur l'étiquette, **télécharge les images publiées de cette version** (aucune compilation; repli automatique sur la construction si elles sont introuvables, ou avec `--build`) et vérifie le healthcheck. Sur une version épinglée (HEAD détachée), lancer `update.sh` sans version ne tire rien : il redémarre seulement avec les images de la version courante. Voir [[Installation-Docker]], « Images déjà construites ». La première mise à jour depuis une version antérieure à ce changement construit encore sur place : c’est l’ancien script qui s’exécute.

## Retour arrière
Les migrations de base de données ne sont pas toujours réversibles. Le retour arrière sûr est donc :
1. `git checkout <ancienne-version>`
2. Restaurer la sauvegarde faite juste avant la mise à jour ([[Sauvegardes]]).
3. `./scripts/up.sh` (images publiées de l'ancienne version, ou construites sur place si elles sont introuvables)

## Mises à jour du système
- `sudo apt update && sudo apt upgrade` régulièrement; active `unattended-upgrades`.
- Images : `docker compose pull db && docker compose up -d` (PostgreSQL reste en version 17; un changement de version majeure demande un dump/restore).

## Depuis le web ou le client Windows

Le lien **Version** du pied de page ouvre `/versions`, affiche la version du serveur et consulte GitHub Releases. Le serveur doit pouvoir joindre `api.github.com`. Les versions stables ignorent les préversions; un serveur de préversion les inclut. L’interface web et l’app iOS suivent la version du serveur : recharger la page après son redémarrage.

La mise à jour du serveur depuis l’interface est réservée à l’**administrateur de l’instance ou opérateur serveur explicitement autorisé** et désactivée par défaut. Dans la VM, depuis le dépôt, exécuter une fois :

```bash
sudo ./scripts/enable-web-updates.sh
```

Le script installe un agent root et un timer systemd, puis monte une boîte de demandes dans le conteneur de l’application. Il ne donne **aucun accès au socket Docker** au site. Si `compose.override.yaml` existe déjà, le script s’arrête pour préserver votre configuration : intégrer son bloc `app.environment`/`app.volumes` avant de reprendre l’installation de l’agent avec votre administrateur système.

L’administrateur choisit la nouvelle version et confirme l’interruption. Le timer traite la demande sous environ une minute : il exige un tag officiel publié, plus récent, descendant du commit installé, un dépôt propre et l’origine GitHub officielle. Il arrête l’application, sauvegarde obligatoirement, lance la reconstruction et les migrations, puis vérifie la santé. Les demandes expirent après une heure. La première installation n’aura pas de mise à jour disponible avant la publication suivante.

Pendant cette opération, l’interface est temporairement indisponible. Après retour du serveur, recharger la page Versions. Ne pas lancer une mise à jour manuelle simultanément. Le journal conserve l’acteur, le tag et les erreurs :

```bash
sudo journalctl -u allumi-update.service
sudo systemctl status allumi-update.timer
```

En cas d’échec de sauvegarde, l’ancienne application redémarre. Après le début d’une migration, aucun retour arrière automatique n’est tenté : utiliser la sauvegarde et la procédure de restauration. L’agent root installé est une copie contrôlée; pour mettre à jour ce composant lui-même après revue d’une release : `sudo install -m 0755 scripts/update-agent.py /usr/local/sbin/allumi-update-agent`.

Pour désactiver les demandes automatiques : `sudo systemctl disable --now allumi-update.timer`, puis retirer la variable et le montage ajoutés au service app et le recréer. Les mises à jour du client Windows restent indépendantes : [[Client-Windows]].

## Transition vers la pile sans SSL intégré

À partir de v0.4.0-alpha.10, Caddy est retiré. Pour passer d’un ancien accès HTTPS intégré à HTTP direct, effectuer la transition manuelle de [[Installation-Docker]] et définir la nouvelle `APP_URL` avant de redémarrer. La mise à jour conserve les URL existantes, les secrets et les volumes; elle ne réécrit pas une URL HTTPS qui peut être servie par un proxy externe.
