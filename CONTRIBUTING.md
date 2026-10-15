# Contribuer à Allumi

Merci de ton intérêt ! Toute contribution est bienvenue : code, documentation, traduction, tests, retours de comptables.

## Avant de commencer
- Lis la page [Développement local](docs/Developpement-local.md) et les [règles comptables](docs/Regles-comptables.md).
- Pour un gros changement, ouvre d'abord une discussion ou une issue.

## Règle clean-room (obligatoire)
Ne soumets **aucun** code, texte, icône, capture ou design provenant de QuickBooks ou de tout autre logiciel propriétaire, ni issu de leur décompilation ou de leur rétro-ingénierie. Allumi se base sur les principes comptables standards, la documentation publique et des conceptions originales. Une contribution qui enfreint cette règle sera refusée et retirée.

## Processus
1. Fork, puis une branche par sujet (`feat/...`, `fix/...`, `docs/...`).
2. Commits en [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
3. Avant la PR : lint, typecheck, tests, build Docker, docs et CHANGELOG à jour, traductions fr-CA et en.
4. Ouvre la PR en décrivant le *pourquoi*. Petites PR, un sujet à la fois.

## Versions
Chaque PR ajoute une ligne sous **[Non publié]** dans `CHANGELOG.md`. Les versions (SemVer) sont publiées par les mainteneurs : voir [Versions et releases](docs/Versions-et-releases.md).

## Exigences comptables
Pas de float pour l'argent, partie double validée, écritures immuables, piste d'audit, isolation par entreprise. Tout changement au moteur comptable demande des tests (dont des tests de propriétés).

## Licence
En contribuant, tu acceptes que ton travail soit publié sous licence MIT.

## Code de conduite
Sois respectueux et constructif. Le harcèlement n'est pas toléré.
