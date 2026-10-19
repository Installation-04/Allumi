# Plan, avancement et checklist

Dernière mise à jour : 19 octobre 2026. Cette page est le carnet de reprise du mandat; elle est mise à jour avec chaque lot. Les cases cochées indiquent un résultat vérifié, pas une simple intention. Voir aussi [[Feuille-de-route]], [[Fonctionnalites-et-limites]] et [[References-visuelles]].

## État de livraison

- [x] PR #5 : web mobile intégré à `main`.
- [x] PR #6 : espace comptable et wiki illustré intégrés à `main`.
- [x] Contacts : création, consultation, modification, recherche, pagination, archivage/restauration.
- [x] Contacts : isolation, rôles, audit, anonymisation et conservation des références vérifiés.
- [x] PR #7 initiale : CI tests, navigateur et Docker verte.
- [ ] PR #7 : intégrer à `main` après validation de la navigation étendue.
- [x] README avec captures intégrées; wiki publié (29 pages, 22 images avant ce lot).

## Lot actif — navigation par activité

Objectif : retrouver les domaines visibles dans la référence de l’utilisateur, avec des destinations honnêtes et une navigation mobile utilisable.

- [x] Inventorier les écarts : ventes, dépenses, banque, trésorerie, rapports, taxes, comptabilité, projets, paie, kilométrage et applications.
- [x] Ajouter les entrées et leurs pages d’accueil bilingues.
- [x] Relier les pages aux outils disponibles : contacts, journal, comptes, balance et exercices.
- [x] Distinguer explicitement les capacités prévues des capacités disponibles.
- [x] Barre latérale défilante; téléphone avec Accueil, Contacts, Journal et Menu complet.
- [x] Prévoir fermeture du menu au clavier et restauration du focus.
- [x] Vérifier lint, types, build et parcours navigateur après modifications.
- [x] Actualiser les captures ordinateur/téléphone et le README (25 images, 30 pages de wiki).
- [x] Publier et vérifier la synchronisation de ce nouveau lot dans le wiki (55 fichiers identiques).
- [ ] Vérifier la CI sur le nouveau commit, notamment Docker.

## Prochains lots, dans l’ordre

1. **4.2 Taxes et catalogue** : calcul TPS/TVQ, taux datés, codes de taxe, produits/services; calcul exact, arrondis et tests domaine/base avant saisie de factures.
2. **4.3 Ventes** : brouillons de factures, validation et avoirs; numérotation, journal et immutabilité.
3. **4.4 Achats** : factures fournisseurs, crédits et dépenses.
4. **4.5 Paiements** : encaissements, décaissements, affectations partielles et dépôts.
5. **4.6 Pièces jointes** : stockage, validation et permissions.
6. **Phase 5** : imports CSV/OFX et rapprochement bancaire.
7. **Phase 6** : bilan, résultats, grand livre, âges, sommaire fiscal et exports.
8. **Phase 7** : bêta, administration restante, essais Safari iOS et appareils physiques.

Projets et kilométrage : périmètre à définir. Paie et intégrations : hors MVP. Leur présence dans le menu ne signifie pas que ces fonctions sont livrées.

## Checklist de livraison de chaque lot

- [ ] Parcours réel complet sur ordinateur et téléphone.
- [ ] Permissions et isolation de l’entreprise côté serveur et en base.
- [ ] Calculs monétaires exacts, invariants comptables et audit lorsque concernés.
- [ ] Erreurs explicites et saisie conservée après refus.
- [ ] Traductions françaises et anglaises, clavier, focus, absence de débordement.
- [ ] Tests pertinents, lint, types, build et CI Docker verts.
- [ ] Guide utilisateur, limites, changelog, captures et README actualisés.
- [ ] Wiki synchronisé et vérifié; PR avec validation et limites connues.

## Journal d’avancement

### 19 octobre 2026 — Contacts

Fusion des PR #5 et #6. Création de la PR #7 pour les clients/fournisseurs. Validation locale : 509 tests réussis, un échec attendu existant; parcours Chromium ordinateur et téléphone réussis. CI ensuite entièrement verte. Publication et comparaison du wiki : 51 fichiers identiques aux sources (29 pages et 22 images).

### 19 octobre 2026 — Menu et suivi

Demande utilisateur : compléter les options du menu latéral et maintenir un plan, des notes et une checklist. Ajout des domaines d’activité, de pages indiquant les outils utilisables et les fonctions prévues, et d’un menu complet sur téléphone. Aucun solde, graphique ou bouton de facturation fictif ajouté. Lint, types, build et parcours Chromium ordinateur/téléphone réussis. Les tests vérifient aussi la navigation vers Ventes, l’état non disponible, le menu complet et le retour du focus après Échap. Captures mises à jour : 25 images. CI du nouveau commit à confirmer.

La CI du menu a détecté une clé de traduction vide, sans usage dans la page Comptabilité. La clé a été supprimée dans les deux langues; nouvelle validation en cours.
