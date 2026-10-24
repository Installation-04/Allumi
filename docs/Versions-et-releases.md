# Versions et releases

Allumi suit le [versionnage sémantique](https://semver.org/lang/fr/) : `MAJEUR.MINEUR.CORRECTIF`.

| Changement | Exemple | Quand |
|---|---|---|
| CORRECTIF | 0.3.0 → 0.3.1 | Corrections de bogues, sans changement de comportement voulu |
| MINEUR | 0.3.1 → 0.4.0 | Nouvelles fonctions, compatibles |
| MAJEUR | 0.9 → 1.0.0 | Changement incompatible ou migration délicate |
| Préversion | 0.4.0-beta.1 | Test avant la version finale |

Tant que la version est `0.x`, le projet est en pré-alpha/bêta : des changements incompatibles peuvent arriver entre deux versions mineures. La `1.0.0` marquera la première version recommandée pour de la vraie comptabilité.

## Où voir la version
- Releases GitHub (onglet *Releases*) avec les notes tirées du `CHANGELOG.md`.
- `GET /api/health` → `{"status":"ok","version":"0.4.0"}`.
- Dans l'application (pied de page / page « Versions »).
- Image Docker : `ghcr.io/installation-04/allumi:0.4.0` (et `:latest` pour les versions stables).

## Publier une version (mainteneurs)
1. Vérifie que la CI est verte sur `main` et que `CHANGELOG.md` a du contenu sous **[Non publié]**.
2. Lance :
   ```bash
   ./scripts/release.sh 0.4.0
   git push origin main && git push origin v0.4.0
   ```
   Le script date la section du changelog, met à jour les versions du serveur et du client Windows, crée le commit `chore(release): v0.4.0` et le tag annoté `v0.4.0`.
3. Le workflow **Release** crée la release GitHub (préversion si le numéro contient un `-`) construit le client Windows et les images Docker avant de publier la release. Un échec laisse la release en brouillon.

## Installer une version précise
```bash
sudo ./scripts/update.sh v0.4.0
```
Le script sauvegarde d'abord, se place sur l'étiquette, complète ton `.env` et reconstruit : voir [[Mise-a-jour]]. Pour la production, utilise toujours une version étiquetée, jamais `main`.

## Règles pour les contributeurs
- Chaque PR utile ajoute une ligne sous **[Non publié]** dans `CHANGELOG.md` (Ajouté, Modifié, Corrigé, Sécurité).
- Une migration de base de données risquée ou un changement de variable d'environnement doit être signalé en gras dans le changelog.
- On ne modifie jamais un tag déjà publié : on publie un correctif.

## Contenu d’une release

Chaque release réunit l’installateur Windows x64 `.exe`, son `.blockmap`, les métadonnées du canal de mise à jour (`latest.yml` ou `alpha.yml`/`beta.yml`), une archive du serveur et `SHA256SUMS.txt`. Les images application et migration sont publiées avec le numéro exact dans GHCR. `latest` est réservé aux versions stables.

Pour les mises à jour Git, installer depuis un clone du dépôt : l’archive source n’inclut pas le répertoire `.git` nécessaire aux scripts. Les préversions Windows sont non signées. Les numéros utilisés par les mises à jour sont `X.Y.Z` ou `X.Y.Z-alpha.N`, `-beta.N`, `-rc.N`. Le client et le serveur portent le même numéro à la publication, mais peuvent être mis à jour séparément.

Les images serveur et migrations sont construites nativement pour Linux AMD64 et ARM64, puis regroupées sous un tag de version commun. La publication de la release attend les deux architectures et la vérification des manifestes. Le client Windows reste x64.
