# FAQ

**Allumi est-il prêt pour de la vraie comptabilité ?**
Non, pas encore (pré-alpha). Suis la [[Feuille-de-route]].

**Est-ce un clone de QuickBooks ?**
Non. Allumi est développé en « clean-room » : à partir des principes comptables standards, de la documentation publique et d'un design original. Aucun code, texte, icône ni design d'un logiciel propriétaire n'est copié.

**Puis-je l'utiliser gratuitement, même commercialement ?**
Oui, licence MIT.

**Où héberger ?**
Un VPS Ubuntu dans une région canadienne est le plus simple ([[Installation]]). Un serveur maison convient pour tester.

**Pourquoi pas Kubernetes ?**
Docker Compose suffit largement pour une instance de PME et reste simple à exploiter.

**Les taxes (TPS/TVQ) sont-elles à jour ?**
Le moteur de taxes et les taux datés sont prévus pour la phase 4; ils ne sont pas encore disponibles dans l’interface. Vérifie les règles applicables auprès de Revenu Québec et de l’ARC.

**Les données peuvent-elles être exportées ?**
Les sauvegardes PostgreSQL sont disponibles. Les exports utilisateurs CSV/PDF sont prévus pour la phase 6 et ne sont pas encore livrés. Voir [[Fonctionnalites-et-limites]].

**Comment contribuer ?**
Voir `CONTRIBUTING.md` et [[Developpement-local]].
