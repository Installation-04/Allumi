# Installation Ubuntu

La pile fournit l’application HTTP et PostgreSQL privé, avec un service ponctuel de migrations. Le guide principal, y compris l’assistant et les captures, est [[Installation-Docker]].

Sur une VM Ubuntu 22.04/24.04 dédiée, ce script installe aussi Docker et configure les sauvegardes planifiées :

```bash
git clone https://github.com/Installation-04/Allumi.git /opt/allumi
cd /opt/allumi
sudo ./scripts/install.sh --interactive
```

Choisir l’URL de la VM, par exemple `http://192.168.1.20:28080`. Options hôte : `--no-firewall`, `--no-cron`; les autres options sont celles de [[Installation-Docker]]. OpenSSL doit être disponible pour préparer les secrets. Le pare-feu ouvre SSH et le port HTTP choisi; les ports publiés par Docker peuvent contourner UFW, donc filtrer l’accès au niveau du réseau/pare-feu Proxmox lorsque nécessaire.

Ouvrir l’URL indiquée puis saisir le jeton affiché à la fin de l’installation (ligne « Jeton »; aussi `SETUP_TOKEN` dans `.env`) pour créer l’administrateur. Voir [[Premier-demarrage]], [[Sauvegardes]] et [[Mise-a-jour]]. Aucun domaine ni certificat n’est demandé. Le script ne doit pas être exécuté sur l’hôte Proxmox.
