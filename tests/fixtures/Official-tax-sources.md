# Fixtures des sources fiscales

`official-tax-cra.json` est un extrait des données et métadonnées publiques du jeu ARC [GST/HST rates](https://open.canada.ca/data/en/dataset/5584a2cf-12af-4b2d-aff5-418410cf5375), ressource `e8f2d0c6-ca67-43d3-862b-6267603dacf6`, consultée le 13 novembre 2026. Données sous [Licence du gouvernement ouvert – Canada](https://open.canada.ca/en/open-government-licence-canada). L’ARC fournit des taux totaux TPS/TVH; ses champs PST ne constituent pas une liste des taxes provinciales séparées.

`official-tax-rq.html` est un balisage minimal écrit pour les tests à partir des dates et taux factuels de l’[historique officiel de Revenu Québec](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/regles-de-base-relatives-a-lapplication-de-la-tpstvh-et-de-la-tvq/historique-des-taux/). Il ne reproduit pas le code de leur site.

Les tests unitaires et navigateur figent ces réponses pour rester déterministes, sans clés API ni données clients. Le module applicatif utilise des URL HTTPS fixes. Les variantes de test avec taux différents sont fictives et servent aux contrôles de changement de source.
