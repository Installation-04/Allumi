# HTTPS local par adresse IP

Allumi peut servir HTTPS sur une adresse IP du réseau local, sans domaine public et sans ouverture vers Internet. Les nouvelles installations choisissent ce mode par défaut; une installation existante conserve son protocole et son URL tant qu’une conversion explicite n’est pas demandée.

Le service Caddy de `compose.https.yaml` utilise une autorité de certification locale persistante. Seul le port TLS choisi, **28080** par défaut, est publié. L’application HTTP et PostgreSQL restent privés dans Docker; ce mode ne publie ni le port 80 ni le port 443 et ne demande pas de certificat ACME public. Compose **2.24.4 ou plus récent** est requis pour retirer la publication HTTP de l’application.

## Nouvelle installation

Choisir une adresse LAN stable de la VM, par exemple `192.168.1.20`. Ne pas utiliser `127.0.0.1` ou `localhost` pour un accès depuis d’autres appareils.

```bash
sudo ./scripts/install-docker.sh --local-https --app-url https://192.168.1.20:28080
```

Remplacer l’adresse d’exemple par celle de votre serveur. L’assistant demande l’adresse d’accès lorsque nécessaire. Le mode explicite `--http` et une URL `--app-url http://…` permettent de conserver HTTP pour les essais ou un proxy externe. Un domaine public et un certificat public restent une configuration distincte : [[Configuration]].

## Convertir une installation existante

Sauvegarder la base, le stockage et la configuration avant de changer le protocole. Depuis le clone installé :

```bash
sudo ./scripts/enable-local-https.sh --host 192.168.1.20 --port 28080
```

Le helper prépare le mode local et redémarre les services concernés; les secrets et données comptables restent conservés. Utiliser `--prepare-only` pour préparer sans appeler Docker, ou `--check` pour vérifier en lecture seule. Le changement de protocole exige de rouvrir la nouvelle URL et de se reconnecter; mettre aussi à jour l’adresse du client Windows et de l’icône iOS si nécessaire.

## Exporter et vérifier le certificat public

Après le démarrage de Caddy :

```bash
sudo ./scripts/enable-local-https.sh --export-ca
```

Le certificat public est exporté dans le fichier exact `local-https-root.crt`, à la racine du dépôt installé, avec permissions 644. Un répertoire à cet emplacement est refusé. Si un lien symbolique y existe, l’export remplace le lien lui-même sans écrire dans sa cible. Le helper refuse un `.env` non régulier ou symbolique : la configuration ne doit jamais être écrite à travers un lien vers une autre destination. Le script affiche son empreinte **SHA-256**. Ce fichier ne contient pas la clé privée; il peut être transféré aux appareils autorisés.

Le script affiche aussi le SHA-256 du fichier pour vérifier son transfert. Sur Windows, exécuter `Get-FileHash .\local-https-root.crt -Algorithm SHA256` dans PowerShell et comparer la valeur avec celle du fichier affichée sur le serveur. Cette somme du fichier est distincte de l’empreinte du certificat lui-même.

Transférer ce certificat par un canal fiable, par exemple une connexion SSH déjà vérifiée. Comparer son empreinte avec celle affichée sur le serveur, par un canal distinct de la page HTTPS qui n’est pas encore approuvée. Ne pas récupérer puis approuver aveuglément un certificat proposé par une page affichant un avertissement. Ne jamais copier les clés privées de Caddy sur les clients, ni partager son répertoire de données.

L’approbation d’une autorité permet de faire confiance aux certificats qu’elle signe. Installer uniquement celle de votre propre instance vérifiée, sur les appareils qui doivent l’utiliser. Ne pas contourner les erreurs TLS ni désactiver la vérification des certificats.

## Windows : navigateur et client

Ouvrir le fichier public `.crt` vérifié, choisir **Installer le certificat**, puis le magasin **Autorités de certification racines de confiance**. Selon la politique du poste, choisir l’utilisateur courant ou demander à l’administrateur l’installation pour l’ordinateur local. Vérifier le magasin avant de terminer l’importation.

Fermer puis rouvrir le navigateur et le client Allumi, et saisir `https://192.168.1.20:28080`. Le client Windows utilise la confiance du système sans exception TLS ni contournement des erreurs de certificat. Si le navigateur conserve son propre magasin de confiance, suivre sa procédure d’importation de cette autorité. Voir [[Client-Windows]].

## iPhone et iPad : Safari

1. Transférer le certificat public vérifié à l’appareil, puis ouvrir le fichier pour préparer son installation.
2. Dans **Réglages → Général → VPN et gestion de l’appareil**, ouvrir le profil téléchargé, vérifier l’autorité puis **Installer**. Les intitulés peuvent varier selon la version d’iOS et la politique de gestion du téléphone.
3. Dans **Réglages → Général → Informations → Réglages des certificats**, activer explicitement la confiance complète pour cette autorité et confirmer.
4. Rouvrir l’adresse HTTPS dans Safari. Une fois la connexion approuvée sans avertissement, utiliser **Partager → Sur l’écran d’accueil** : [[Application-mobile]].

L’installation du profil seule ne suffit pas toujours : la confiance complète doit aussi être activée. Un appareil géré peut exiger l’intervention de son administrateur.

## macOS et autres navigateurs

Sur macOS, importer le certificat public vérifié dans **Trousseaux d’accès**, puis régler sa confiance pour les connexions TLS selon la politique du poste. Rouvrir le navigateur; certains navigateurs disposent de leur propre magasin. Cela concerne l’accès web uniquement : aucun installateur de client macOS n’est fourni.

## Persistance, restauration et dépannage

L’autorité doit être conservée avec les données HTTPS lors d’une migration ou restauration : [[Sauvegardes]]. Une nouvelle autorité nécessite une nouvelle vérification et approbation sur chaque appareil. Si l’adresse IP change, adapter la configuration explicitement et vérifier que le certificat présenté correspond à la nouvelle adresse; ne pas ignorer un avertissement de nom ou de confiance.

HTTPS chiffre la connexion, mais ne rend pas l’instance accessible depuis Internet. Le routage, le pare-feu et les permissions Allumi restent applicables. Pour Proxmox, installer dans une VM dédiée : [[Proxmox]].


## Configuration refusée avant démarrage ou mise à jour

Les scripts vérifient le rendu Compose en mode HTTPS local avant de créer, démarrer, redémarrer ou remettre en service les conteneurs. Ils utilisent la configuration du déploiement plutôt que des variables Compose ou réseau injectées par le shell appelant. Une surcharge qui réexpose HTTP ou invalide la publication TLS est refusée; supprimer cette vérification ne constitue pas une réparation.

En cas de refus, conserver la configuration et le message d’erreur, examiner les fichiers Compose et corriger la surcharge concernée. Puis vérifier sans appliquer de changement :

```bash
sudo ./scripts/enable-local-https.sh --check
```

Ce contrôle est en lecture seule. Relancer l’opération voulue seulement une fois la configuration acceptée. Lorsqu’un contrôle préalable échoue avant l’opération, aucune nouvelle version ni autorité de certification n’est installée en remplacement. Les scripts `up.sh` et `update.sh` effectuent ce contrôle avant de modifier les choix d’images ou la copie Git.

Conserver une seule déclaration de `ALLUMI_NETWORK_MODE`, `ALLUMI_TLS_HOST` et `COMPOSE_FILE`, sans préfixe `export`, dans un `.env` UTF-8 sans BOM. Supprimer seulement le marqueur HTTPS ne constitue pas une conversion HTTP : des réglages TLS restants sont refusés pour éviter de réexposer l’application. Utiliser l’option explicite `--http` de l’installateur pour cette conversion.

L’agent hôte récent contrôle aussi HTTPS avant d’arrêter l’application ou de lancer la sauvegarde. Une configuration refusée apparaît comme une erreur de validation; l’application déjà en service reste en fonctionnement. Cette protection nécessite une copie récente de l’agent privilégié : une mise à jour du site ne remplace pas automatiquement cette copie. Voir [[Mise-a-jour]] pour son actualisation explicite.

Ces contrôles valident la configuration observée au moment du lancement. Ils ne remplacent pas le contrôle des droits d’écriture sur l’hôte ni la confiance dans son administrateur.
