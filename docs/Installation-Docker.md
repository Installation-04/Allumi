# Installation avec Docker Compose

Le script `scripts/install-docker.sh` installe Allumi dans la pile Docker du dépôt : PostgreSQL 17, migrations, application et Caddy pour HTTPS. Node.js n’est pas nécessaire sur l’hôte : les images sont construites par Docker à partir de la version choisie.

## Prérequis

- Une VM Linux dédiée, par exemple Ubuntu 24.04 sur Proxmox. Ne pas installer sur l’hôte Proxmox.
- Docker Engine et le plugin Docker Compose v2 déjà installés; le compte doit pouvoir exécuter `docker info` et `docker compose version`.
- Bash, OpenSSL et Git. Prévoir initialement 4 vCPU, 8 Go de RAM et 40 Go de disque pour les builds et essais; ce n’est pas une mesure de capacité.
- Un nom DNS dirigé vers la VM et les ports choisis disponibles pour Caddy (28080/28443 par défaut pour une nouvelle installation via cet assistant). Le certificat doit être reconnu par les clients Windows/iPhone.

Docker absent sur Ubuntu? Le script `sudo ./scripts/install.sh --domain … --email …` installe aussi le moteur, configure le pare-feu et planifie les sauvegardes. Voir [[Installation]]. Le script Docker dédié ne modifie ni les paquets, ni le pare-feu, ni les tâches planifiées de l’hôte.

## Installer une version publiée

Dans la VM, avec un compte autorisé à utiliser Docker :

```bash
git clone https://github.com/Installation-04/Allumi.git allumi
cd allumi
git checkout v0.4.0-alpha.8
./scripts/install-docker.sh
```

Répondre aux questions du terminal. Utiliser seulement des données fictives pendant cette préversion. Le script utilise `.env` à la racine du dépôt; ce fichier est exclu des images Docker. Le projet Compose se nomme `allumi` par défaut : une seule installation par défaut sur ce moteur. Ne pas créer un deuxième dossier pour mettre à jour une instance existante.

## Assistant interactif

Sans argument dans un terminal, l’assistant propose :

1. **Installation standard** : réglages existants ou ports 28080/28443 pour une nouvelle installation.
2. **Options avancées** : adresse IPv4 d’écoute, ports HTTP/HTTPS distincts (1 à 65535) et délai du contrôle de santé.

Les deux parcours demandent le domaine, le courriel HTTPS, la langue initiale (`fr-CA` ou `en`), puis le choix entre démarrer Docker ou préparer seulement `.env`. La langue initiale ne remplace pas les préférences des utilisateurs existants.

Un récapitulatif présente l’URL complète et les réglages. **Entrée seule à la confirmation annule**; `o` confirme. Une fin de saisie ou `Ctrl+C` avant confirmation ne modifie pas `.env`. Les valeurs incorrectes sont redemandées. Les secrets ne sont jamais demandés ni affichés.

![Exemple de dialogue de l’installateur](images/assistant-docker.png)

La capture reproduit la sortie d’un essai avec données fictives. Le script agit dans la VM Linux; il ne crée pas de VM/LXC, ne configure pas Proxmox et ne modifie pas le pare-feu.

Pour forcer le dialogue avec des valeurs préremplies :

```bash
./scripts/install-docker.sh --interactive --domain compta.exemple.ca --email admin@exemple.ca
```

Avec des arguments et sans `--interactive`, le script ne pose aucune question : le mode automatisé existant reste disponible. Sans terminal et sans argument, il échoue au lieu de lancer une installation ou d’attendre une saisie.

### Ports personnalisés et HTTPS

Avec HTTP `8080` et HTTPS `8443`, l’URL générée devient `https://compta.exemple.ca:8443`. Caddy conserve ce port dans la redirection HTTP. Les ports internes de la base et de l’application restent privés. L’adresse `0.0.0.0` expose les ports sur toutes les interfaces IPv4; `127.0.0.1` limite l’accès à la VM elle-même. IPv6 n’est pas proposé dans cet assistant.

Les certificats publics exigent toujours un DNS valide et un challenge ACME accessible depuis Internet sur **80 ou 443**. Modifier les ports locaux ne change pas cette exigence : configurer le routeur/proxy, par exemple le port public 80 vers le port 8080 de la VM. L’installateur ne le fait pas. Un test `healthy` ne valide pas le certificat. Si le port public HTTPS diffère du port local, adapter `APP_URL` dans `.env` avant de démarrer; le modèle guidé suppose qu’ils sont identiques.

Une réinstallation sans préciser les nouvelles options conserve les ports, l’adresse et la langue enregistrés. Les mises à jour utilisent ces réglages persistants. Ne pas employer la relance de l’installateur pour une mise à jour sans sauvegarde : voir [[Mise-a-jour]].

## Ce que fait le script

1. Vérifie les arguments, OpenSSL, Docker et Compose. Si des conteneurs ou volumes du projet existent sans `.env`, il refuse de générer de nouveaux secrets : restaurer la configuration originale.
2. Prépare `.env` dans un fichier privé puis le remplace de façon atomique après vérification. Les mots de passe, clés et jeton sont générés avec OpenSSL; le fichier final est en permissions `600`.
3. Conserve les secrets existants. Un fichier incomplet, des valeurs `CHANGE_ME` ou des URL de base qui ne ciblent pas le service Docker `db:5432` provoquent un refus sans réécriture.
4. Construit les images et démarre la pile. Le service `migrate` applique les migrations avant le démarrage de l’application, qui utilise le rôle PostgreSQL restreint.
5. Attend l’état `healthy` de l’application. Un échec de Compose ou du contrôle de santé retourne un code d’erreur; les volumes et la configuration sont conservés.

Les identifiants de déploiement viennent de `.env`, sans exécuter ce fichier comme un script. Les variables de connexion d’un shell de développement ne remplacent pas celles du fichier. Un verrou empêche deux installateurs de modifier simultanément cette configuration.

## Options

```bash
# Installation automatisée avec ports personnalisés
./scripts/install-docker.sh --domain compta.exemple.ca --email admin@exemple.ca \
  --http-port 8080 --https-port 8443 --bind 0.0.0.0 --locale en

# Afficher toutes les options
./scripts/install-docker.sh --help
```


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

## Architectures et ports par défaut

Le serveur Docker prend en charge **Linux AMD64 (x86_64)** et **Linux ARM64 (aarch64, système 64 bits)**. Compose construit les images pour l’architecture native du moteur Docker; aucune option `platform: linux/amd64` n’est imposée. La CI démarre la pile, applique les migrations et vérifie la santé et `/setup` sur les deux architectures. Les images de release de l’application et des migrations sont publiées avec un manifeste commun AMD64/ARM64 à partir de la prochaine version. L’installateur Windows reste x64.

Une nouvelle installation par `install-docker.sh` utilise HTTP **28080** et HTTPS **28443** : `https://compta.exemple.ca:28443`. Ces ports évitent les ports web habituels, sans garantir qu’ils sont libres sur votre machine. L’assistant permet de les changer. Une configuration existante garde ses ports; les anciennes configurations sans clés de ports gardent **80/443**. Les valeurs de repli Compose et `.env.example` restent 80/443 pour préserver les installations manuelles et l’installateur Ubuntu historique.

Les ports personnalisés ne remplacent pas le routage nécessaire aux certificats ACME : par exemple, rediriger le port public 80 vers 28080 sur la VM. Pour accéder directement à l’URL avec `:28443`, ce port doit également être accessible aux clients.
