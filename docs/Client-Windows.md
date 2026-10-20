# Client Windows

Le client Windows affiche votre serveur Allumi dans une fenêtre dédiée. Il requiert une connexion au serveur et ne contient pas de base comptable locale. Windows 10/11 x64 est la cible de cette préversion. macOS est hors périmètre.

## Installation

Télécharger le fichier **Allumi-…-win-x64.exe** depuis la [release officielle](https://github.com/Installation-04/Allumi/releases), puis lancer l’installateur. Les versions de test sont **non signées** : SmartScreen peut afficher un avertissement. Comparer le résultat de `Get-FileHash .\Allumi-…-win-x64.exe -Algorithm SHA256` dans PowerShell à `SHA256SUMS.txt` de la même release.

Au premier lancement, saisir l’origine HTTPS de votre serveur, par exemple `https://compta.exemple.ca`. Un certificat TLS valide est nécessaire. Les URL avec identifiant, chemin ou paramètres sont refusées. HTTP est accepté uniquement sur localhost pour le développement.

Se connecter avec le même compte que sur le web. Le menu **Allumi → Serveur** permet de changer d’adresse. Les fenêtres externes et les navigations vers d’autres domaines sont bloquées; ouvrir le wiki et les téléchargements dans votre navigateur habituel.

## Mises à jour

**Allumi → Mises à jour du client** recherche une version dans GitHub Releases. Confirmer le téléchargement, puis le redémarrage lorsque le travail est enregistré. Le téléchargement et l’installation ne se déclenchent pas sans confirmation. Une préversion peut recevoir d’autres préversions; une version stable reste sur le canal stable. Aucun retour à une version antérieure n’est autorisé.

La mise à jour du client ne met pas à jour le serveur. **Allumi → Version du serveur** ouvre la même page que le lien Version du site : voir [[Mise-a-jour]].

Le build Windows et les règles de navigation sont vérifiés en CI. L’installation interactive, SmartScreen et le passage entre deux versions installées demandent encore une validation sur un PC Windows réel.
