# Allumi — Wiki

Allumi est un logiciel de comptabilité **open source** (MIT) et **auto-hébergeable** pour les PME et travailleurs autonomes du Québec et du Canada. Français par défaut, anglais disponible.

> **État : pré-alpha.** L'infrastructure, le squelette de l'application (premier démarrage, connexion, 2FA, FR/EN), le moteur comptable (plan comptable, journal, périodes, audit) et la documentation sont prêts; les contacts, le module taxes/catalogue et la préparation et la validation des factures sont disponibles, de même que les avoirs et les encaissements de factures; les remboursements, les dépôts et les paiements fournisseurs arrivent ensuite. Ne l'utilise pas pour de la comptabilité réelle avant une version stable.

## Pour installer et exploiter
- [[Proxmox]] — tester dans une VM Ubuntu dédiée
- [[Client-Windows]] — installateur et mises à jour du client
- [[Application-mobile]] — ajout iOS depuis Safari
- [[Installation]] — installer sur un serveur Ubuntu en une commande
- [[Premier-demarrage]] — créer l'entreprise et l'administrateur (`/setup`)
- [[Authentification]] — connexion, sessions, vérification en deux étapes, rôles
- [[Configuration]] — toutes les variables d'environnement
- [[Sauvegardes]] — sauvegarder et restaurer (chiffré, hors site)
- [[Mise-a-jour]] — mettre à jour et revenir en arrière
- [[Versions-et-releases]] — numéros de version, tags et releases
- [[Securite-et-Loi-25]] — durcissement, vie privée, hébergement canadien
- [[Depannage]] — problèmes fréquents
- [[FAQ]]

## Pour utiliser l'application
- [[Guide-utilisateur]] — parcours complet, du premier compte à la fermeture des périodes
- [[Appearance-and-language]] — English guide, light/dark/system themes
- [[Interface-et-navigation]] — tableau de bord, navigation et web mobile
- [[References-visuelles]] — captures de référence ordinateur et téléphone
- [[Fonctionnalites-et-limites]] — fonctions livrées, en revue et planifiées
- [[Plan-comptable]] — comptes, types, comptes système
- [[Journal-et-ecritures]] — écritures, contre-passation, balance de vérification
- [[Exercices-et-periodes]] — exercices, verrouillage, réouverture protégée
- [[Piste-d-audit]] — qui a fait quoi, quand

## Pour comprendre le projet
- [[Architecture]] — stack, modules, infrastructure
- [[Regles-comptables]] — les règles que le moteur comptable ne doit jamais enfreindre
- [[Schema-de-donnees]] — tables, contraintes, triggers de partie double, isolation par entreprise
- [[Plan-de-tests]] — comment le moteur comptable est testé (tests de propriétés inclus)
- [[Feuille-de-route]] — ce qui est prévu

## Pour contribuer
- [[Developpement-local]] — environnement de dev
- [[Developpement-cloud]] — développer en environnement cloud
- [[Publication-du-wiki]] — publier les pages et renouveler les captures
- Voir aussi `CONTRIBUTING.md` et `SECURITY.md` dans le dépôt.

## Avertissement
Allumi ne remplace pas un comptable. Vérifie les taux et règles de taxes auprès de Revenu Québec et de l'Agence du revenu du Canada.

Le répertoire clients et fournisseurs (lot 4.1 livré) est décrit dans [[Contacts]].

Taxes et produits/services : [[Taxes-et-catalogue]].

- [[Entreprise]]
