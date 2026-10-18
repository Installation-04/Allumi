# Premier démarrage

Après l'installation ([[Installation]]), ouvre l'adresse de ton instance. Tant qu'aucun utilisateur n'existe, toutes les pages mènent à **`/setup`**.

## Créer l'entreprise et l'administrateur
Le formulaire demande d'abord le **jeton d'installation** : `install.sh` l'affiche à la fin et le garde dans `.env` (`SETUP_TOKEN`). Il empêche une autre personne d'atteindre l'adresse avant toi et de créer l'administrateur (les certificats HTTPS sont publics, les robots surveillent les nouveaux domaines). Sans `SETUP_TOKEN`, le champ n'apparaît pas en développement local; sur un serveur public (production, HTTPS), la page reste **fermée** et t'invite à définir `SETUP_TOKEN` dans `.env`.

Il demande ensuite :
- le **nom de l'entreprise** et le **premier mois de l'exercice financier** (ex. avril pour un exercice du 1er avril au 31 mars);
- ton **nom**, ton **courriel** et un **mot de passe** d'au moins 12 caractères (une phrase de passe longue vaut mieux qu'un mot de passe compliqué);
- la **langue** de l'interface (français canadien ou anglais; modifiable en tout temps avec le sélecteur en haut de page).

Une seule transaction crée l'administrateur de l'instance et l'entreprise dont il est propriétaire. Puis la page `/setup` se **désactive pour de bon** : elle renvoie vers la connexion.

> Si deux personnes ouvrent `/setup` en même temps, une seule réussit. Le nombre d'essais par adresse est limité. Une fois la configuration faite, le jeton ne sert plus à rien : tu peux le laisser dans `.env` (`install.sh` et `update.sh` en remettent un nouveau s'il manque, sans effet une fois `/setup` fermé).

## Active ensuite la vérification en deux étapes
Va dans **Sécurité du compte** (lien au bas du tableau de bord) : voir [[Authentification]]. Elle est recommandée pour tous les comptes propriétaire et comptable.

## Et après ?
L'application est en pré-alpha ([[Feuille-de-route]]). À cette étape, le tableau de bord de l'entreprise affiche seulement ton rôle : le plan comptable, le journal et les périodes arrivent à la phase 3.

Besoin d'aide ? [[Depannage]].
