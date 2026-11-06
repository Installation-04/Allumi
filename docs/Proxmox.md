# Tester Allumi sur Proxmox

Allumi peut être testé dans une **VM Ubuntu 24.04 dédiée**, avec Docker Compose. Ne pas exécuter l’installateur sur l’hôte Proxmox. Cette préversion sert aux essais avec des données fictives; elle n’est pas destinée à votre comptabilité réelle.

## VM et accès

Prévoir initialement 4 vCPU, 8 Go de RAM et 40 Go de disque, à ajuster selon les pièces jointes et sauvegardes. Relier la VM à votre pont réseau et lui attribuer une adresse stable. Ces valeurs sont un point de départ, pas un résultat de mesure de capacité. Sur une version étiquetée, les images sont téléchargées et non compilées (voir [[Installation-Docker]]); le build local, plus gourmand en mémoire, ne sert qu’aux branches et aux essais de développement.

Accès par défaut des nouvelles installations : `https://ADRESSE_VM:28080`, avec une adresse LAN stable et l’autorité locale à approuver sur les appareils : [[HTTPS-local]]. Aucun domaine public ni ouverture Internet ne sont requis. HTTP reste possible explicitement; PostgreSQL reste privé.

## Installation d’une version publiée

Dans la VM, installer Git, puis récupérer le dépôt officiel :

```bash
sudo apt update
sudo apt install -y git
sudo git clone https://github.com/Installation-04/Allumi.git /opt/allumi
cd /opt/allumi
# Préversion de test; utiliser uniquement des données fictives.
sudo git checkout v0.4.0-alpha.49
sudo ./scripts/install.sh --interactive
```

Choisir un tag d’une release publiée, pas une branche en développement. Le script installe Docker, génère les secrets, démarre la base et les migrations, configure HTTPS et les sauvegardes. Voir [[Installation]] et conserver la clé de sauvegarde hors de la VM.

Exporter et approuver le certificat public selon [[HTTPS-local]], puis ouvrir l’adresse HTTPS et créer l’entreprise fictive et son administrateur. Tester la connexion, les contacts, une écriture équilibrée et la balance de vérification. `https://ADRESSE_VM:28080/api/health` doit retourner `status: ok` et la version attendue. Consulter [[Fonctionnalites-et-limites]] pour les fonctions encore en préparation.

## Option Docker déjà installé

Dans la même VM dédiée, avec Docker Engine et Compose disponibles :

```bash
cd /opt/allumi
sudo ./scripts/install-docker.sh --local-https --app-url https://192.168.1.20:28080
```

Ce script ne modifie pas le pare-feu et ne planifie pas de sauvegardes. Voir [[Installation-Docker]] pour la préparation seule, les contrôles et la persistance des données.

## Clients et mises à jour

Le navigateur et l’iPhone utilisent cette même adresse ([[Application-mobile]]). L’EXE Windows demande également cette adresse ([[Client-Windows]]).

L’installateur active l’agent de mise à jour web après démarrage sain lorsqu’il est exécuté en root avec systemd actif. Pour une ancienne installation ou une activation omise, l’activer manuellement :

```bash
cd /opt/allumi
sudo ./scripts/enable-web-updates.sh
```

Voir [[Mise-a-jour]] pour les permissions, l’interruption temporaire et la restauration. Un snapshot VM avant les essais complète les sauvegardes chiffrées, sans les remplacer. Aucun déploiement sur votre Proxmox ni test sur votre matériel n’a été effectué par la CI.

## Configuration guidée dans la VM

Lancer `./scripts/install-docker.sh` sans argument dans le terminal ouvre l’assistant standard/avancé : URL d’accès, langue, port d’accès, adresse d’écoute, préparation seule et confirmation. Docker/Compose doivent déjà être installés. Voir [[Installation-Docker]] pour les ports personnalisés et le proxy externe facultatif. Ce script ne doit pas être lancé sur l’hôte Proxmox.
