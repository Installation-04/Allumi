# Publication du wiki

Le dossier `docs/` du dépôt est la source de vérité du wiki GitHub. Les pages sont rédigées en français et utilisent des liens `[[Home]]`. Les captures sont versionnées dans `docs/images/` avec les pages qui les expliquent.

## Première activation

Un administrateur GitHub doit activer **Settings → General → Features → Wikis**, puis créer une première page **Home** depuis l’onglet Wiki. Cela initialise le dépôt `Allumi.wiki.git`. Un jeton capable de pousser le code peut ne pas avoir le droit de modifier les paramètres du dépôt.

## Publier

Depuis une révision relue du dépôt :

```sh
./scripts/sync-wiki.sh https://github.com/Installation-04/Allumi.wiki.git
```

Le script remplace le contenu du wiki par `docs/`, y compris les images. Les modifications faites directement dans le wiki seront donc remplacées : reporte-les dans le dépôt avant la prochaine publication. La branche par défaut du wiki est conservée. Aucun jeton ne doit être inscrit dans les URL ou les fichiers.

Après publication, vérifier **Home**, la barre latérale, les liens internes et au moins une capture desktop/mobile dans [[References-visuelles]]. Une erreur 403 ou « Repository not found » demande de vérifier les droits, l’activation et l’initialisation du wiki.

## Régénérer les captures

Utiliser uniquement l’entreprise fictive du parcours Playwright, jamais une base contenant des données réelles :

```sh
npm run build
ALLUMI_SCREENSHOTS=1 npm run test:e2e
ALLUMI_SCREENSHOTS=1 E2E_MOBILE=1 npm run test:e2e
```

Si Chromium est installé par le système, ajouter `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`. Chaque exécution recrée la base dédiée `allumi_e2e` et capture les pages de test. Ne jamais définir `DATABASE_URL` vers une base de production pour ces commandes. Les deux parcours s’exécutent séparément.

Les images ne montrent aucun secret d’installation, QR code 2FA, code de récupération ni identifiant de connexion. Le nom d’entreprise et les montants sont fictifs. La date comptable suit le mois du test; il s’agit de références visuelles, pas de comparaisons pixel à pixel. Refaire les captures après chaque modification visible majeure.
