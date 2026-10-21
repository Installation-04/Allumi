# Tester Allumi sur Proxmox

Allumi peut être testé dans une **VM Ubuntu 24.04 dédiée**, avec Docker Compose. Ne pas exécuter l’installateur sur l’hôte Proxmox. Cette préversion sert aux essais avec des données fictives; elle n’est pas destinée à votre comptabilité réelle.

## VM et accès

Prévoir initialement 4 vCPU, 8 Go de RAM et 40 Go de disque, à ajuster selon les pièces jointes et sauvegardes. Relier la VM à votre pont réseau et lui attribuer une adresse stable. Ces valeurs sont un point de départ pour le build et les essais, pas un résultat de mesure de capacité.

Prévoir un nom DNS et un certificat HTTPS reconnu par l’iPhone et Windows. L’installation standard utilise Caddy et demande que les ports 80/443 du domaine soient accessibles pour la délivrance du certificat. Pour un serveur privé derrière votre reverse proxy, configurer ce proxy et le TLS selon [[Configuration]]; un certificat auto-signé non reconnu ne convient pas au client Windows. PostgreSQL ne doit pas être exposé sur Internet.

## Installation d’une version publiée

Dans la VM, installer Git, puis récupérer le dépôt officiel :

```bash
sudo apt update
sudo apt install -y git
sudo git clone https://github.com/Installation-04/Allumi.git /opt/allumi
cd /opt/allumi
# Préversion de test; utiliser uniquement des données fictives.
sudo git checkout v0.3.0-alpha.1
sudo ./scripts/install.sh --domain compta.exemple.ca --email admin@exemple.ca
```

Choisir un tag d’une release publiée, pas une branche en développement. Le script installe Docker, génère les secrets, démarre la base et les migrations, configure HTTPS et les sauvegardes. Voir [[Installation]] et conserver la clé de sauvegarde hors de la VM.

Ouvrir l’adresse HTTPS et créer l’entreprise fictive et son administrateur. Tester la connexion, les contacts, une écriture équilibrée et la balance de vérification. `https://compta.exemple.ca/api/health` doit retourner `status: ok` et la version attendue. Consulter [[Fonctionnalites-et-limites]] pour les fonctions encore en préparation.

## Clients et mises à jour

Le navigateur et l’iPhone utilisent cette même adresse ([[Application-mobile]]). L’EXE Windows demande également cette adresse ([[Client-Windows]]).

Pour les mises à jour déclenchées depuis le web, installer une fois l’agent facultatif après le premier démarrage :

```bash
cd /opt/allumi
sudo ./scripts/enable-web-updates.sh
```

Voir [[Mise-a-jour]] pour les permissions, l’interruption temporaire et la restauration. Un snapshot VM avant les essais complète les sauvegardes chiffrées, sans les remplacer. Aucun déploiement sur votre Proxmox ni test sur votre matériel n’a été effectué par la CI.
