# Installation avec Docker Compose

Le script `scripts/install-docker.sh` installe Allumi dans la pile Docker du dépôt : PostgreSQL 17, migrations, application et Caddy pour HTTPS. Node.js n’est pas nécessaire sur l’hôte : les images sont construites par Docker à partir de la version choisie.

## Prérequis

- Une VM Linux dédiée, par exemple Ubuntu 24.04 sur Proxmox. Ne pas installer sur l’hôte Proxmox.
- Docker Engine et le plugin Docker Compose v2 déjà installés; le compte doit pouvoir exécuter `docker info` et `docker compose version`.
- Bash, OpenSSL et Git. Prévoir initialement 4 vCPU, 8 Go de RAM et 40 Go de disque pour les builds et essais; ce n’est pas une mesure de capacité.
- Un nom DNS dirigé vers la VM et les ports 80/443 disponibles pour Caddy. Le certificat doit être reconnu par les clients Windows/iPhone.

Docker absent sur Ubuntu? Le script `sudo ./scripts/install.sh --domain … --email …` installe aussi le moteur, configure le pare-feu et planifie les sauvegardes. Voir [[Installation]]. Le script Docker dédié ne modifie ni les paquets, ni le pare-feu, ni les tâches planifiées de l’hôte.

## Installer une version publiée

Dans la VM, avec un compte autorisé à utiliser Docker :

```bash
git clone https://github.com/Installation-04/Allumi.git allumi
cd allumi
git checkout v0.4.0-alpha.8
./scripts/install-docker.sh --domain compta.exemple.ca --email admin@exemple.ca
```

Remplacer le domaine et le courriel. Utiliser seulement des données fictives pendant cette préversion. Le script utilise `.env` à la racine du dépôt; ce fichier est exclu des images Docker. Le projet Compose se nomme `allumi` par défaut : une seule installation par défaut sur ce moteur. Ne pas créer un deuxième dossier pour mettre à jour une instance existante.

## Ce que fait le script

1. Vérifie les arguments, OpenSSL, Docker et Compose. Si des conteneurs ou volumes du projet existent sans `.env`, il refuse de générer de nouveaux secrets : restaurer la configuration originale.
2. Prépare `.env` dans un fichier privé puis le remplace de façon atomique après vérification. Les mots de passe, clés et jeton sont générés avec OpenSSL; le fichier final est en permissions `600`.
3. Conserve les secrets existants. Un fichier incomplet, des valeurs `CHANGE_ME` ou des URL de base qui ne ciblent pas le service Docker `db:5432` provoquent un refus sans réécriture.
4. Construit les images et démarre la pile. Le service `migrate` applique les migrations avant le démarrage de l’application, qui utilise le rôle PostgreSQL restreint.
5. Attend l’état `healthy` de l’application. Un échec de Compose ou du contrôle de santé retourne un code d’erreur; les volumes et la configuration sont conservés.

Les identifiants de déploiement viennent de `.env`, sans exécuter ce fichier comme un script. Les variables de connexion d’un shell de développement ne remplacent pas celles du fichier. Un verrou empêche deux installateurs de modifier simultanément cette configuration.

## Options

```bash
# Préparer uniquement la configuration, sans appeler Docker ni démarrer de conteneur
./scripts/install-docker.sh --domain compta.exemple.ca --email admin@exemple.ca --prepare-only

# Attendre jusqu’à 10 minutes l’état healthy après le démarrage Compose
./scripts/install-docker.sh --domain compta.exemple.ca --email admin@exemple.ca --timeout 600
```

Le délai par défaut est de 300 secondes; il s’applique au contrôle de santé **après** la construction et le démarrage Compose. `--prepare-only` ne peut pas vérifier les ressources d’un moteur Docker : utiliser cette option seulement dans un dossier prévu pour l’installation et vérifier les volumes existants avant de démarrer.

## Premier accès et vérifications

```bash
docker compose ps
curl -fsS https://compta.exemple.ca/api/health
```

L’état `healthy` concerne l’application; vérifier séparément le DNS et le certificat HTTPS. Leur mise en place peut prendre quelques minutes. Ouvrir `/setup` et utiliser le jeton `SETUP_TOKEN` du fichier `.env` pour créer l’administrateur. Le script n’affiche pas les secrets; conserver `.env` en lieu sûr avec les éléments de sauvegarde.

Les données persistent dans les volumes Docker. **Ne pas utiliser `docker compose down -v`** pour un redémarrage ou une mise à jour : cette option supprime les volumes.

## Sauvegardes et mises à jour

Configurer et tester les [[Sauvegardes]], notamment le chiffrement et la destination hors site. Le script Docker dédié ne planifie aucune sauvegarde. Relancer l’installateur conserve les secrets, mais ne remplace pas une mise à jour avec sauvegarde.

Dans le même clone Git :

```bash
./scripts/update.sh vX.Y.Z
```

Choisir un tag publié. Pour les mises à jour depuis l’interface web, installer l’agent facultatif selon [[Mise-a-jour]]. L’EXE Windows et l’application iOS utilisent l’adresse HTTPS du serveur; voir [[Client-Windows]] et [[Application-mobile]]. Les captures de l’interface sont dans [[References-visuelles]].

En cas d’échec : `docker compose logs migrate app caddy`. Résoudre la cause puis relancer le script; ne pas supprimer les volumes ni remplacer les clés existantes. Un verrou abandonné après une interruption brutale ne doit être retiré qu’après avoir vérifié qu’aucune installation ne tourne.
