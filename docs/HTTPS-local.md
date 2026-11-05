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

Le certificat public est exporté dans `local-https-root.crt`, à la racine du dépôt installé, avec permissions 644. Le script affiche son empreinte **SHA-256**. Ce fichier ne contient pas la clé privée; il peut être transféré aux appareils autorisés.

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
