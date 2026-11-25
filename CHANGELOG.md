# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/); versionnage [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.4.0-alpha.91] - 2026-11-25

- Nouveautés : copies imprimables/PDF complètes des budgets annuels et mensuels, avec objectifs, réel comptabilisé, écarts, couverture et comptes inactifs.
- Périodes : copie mensuelle liée à la période fiscale affichée, avec objectif annuel et état de répartition; période vide, mal formée ou répétée refusée sur page, CSV et copie.
- Impression : document paysage clair depuis FR/EN, thème sombre et mobile, en-têtes répétés et noms longs contenus; toutes les lignes jusqu’au plafond de 1 000 comptes, sans copie partielle au-delà.
- Sécurité : mêmes droits Comptabilité en lecture et instantanés SQL des rapports; réponses privées sans cache, aucune note privée, mutation, formulaire de modification ou PDF stocké sur le serveur.
- Installation : aucune migration ni nouvelle configuration; guides, README, captures et nouveautés applicatives bilingues mis à jour.

## [0.4.0-alpha.90] - 2026-11-24

- Nouveautés : configurations de prévision nommées et partagées par entreprise, avec horizon et délais clients/fournisseurs réutilisables sans enregistrer de montants.
- Interface : création FR/EN, saisie conservée après refus, application à la référence affichée et suppression confirmée; thème sombre et mobile illustrés.
- Sécurité : RLS Comptabilité + Ventes, écriture comptable pour gérer, audit, réglages immuables et plafond SQL de 20 sérialisé même en concurrence.
- Exports : application des filtres aux données recalculées; CSV/PDF conservent les hypothèses, sans nom de configuration ni instantané comptable.
- Installation : migration additive `20261125000000_cash_forecast_presets`, appliquée par le service migrate; aucune nouvelle configuration, aucun mouvement financier ni paiement programmé.

## [0.4.0-alpha.89] - 2026-11-24

- Nouveautés : simulation en lecture seule de délais additionnels clients et fournisseurs de 0, 7, 14 ou 30 jours calendaires dans la prévision de trésorerie.
- Comparaison : référence sans délai et hypothèses sélectionnées issues du même instantané, avec encaissements, décaissements, clôture, minimum et jours négatifs; montants sortant de l’horizon explicités.
- Exports : hypothèses conservées dans les liens, le CSV et la copie PDF complète; dates contractuelles et soldes comptables inchangés.
- Sécurité : valeurs et doublons contrôlés côté serveur, mêmes permissions et limites de sources, cents exacts, aucune écriture ni programmation bancaire.
- Installation : aucune migration ou configuration; FR/EN, thème sombre et mobile documentés avec captures; scénarios enregistrés et autres mouvements manuels hors périmètre.

## [0.4.0-alpha.88] - 2026-11-23

- Nouveautés : copie complète de la prévision de trésorerie avec impression et enregistrement PDF depuis le navigateur, en conservant dates et horizon.
- Rapports : toutes les échéances des filtres choisis, même depuis une page suivante; hypothèses, exclusions, contrôles, série quotidienne et soldes initiaux inclus.
- Interface : document FR/EN en paysage, noir sur fond blanc depuis les deux thèmes, en-têtes répétés, noms longs contenus et retour à la page du rapport.
- Confidentialité : mêmes droits Comptabilité et Ventes en lecture, filtres stricts et limites intégrales; aucun lien interne, note privée ou description de ligne des pièces sur papier, aucune écriture déclenchée.
- Installation : aucune migration ni configuration et aucun moteur PDF serveur; guide, captures et essais du détail au-delà de 100 factures et du PDF multipage.

## [0.4.0-alpha.86] - 2026-11-23

- Nouveautés : prévision de trésorerie par échéances sur 7, 30, 60 ou 90 jours, soldes initiaux banque/caisse et factures clients/fournisseurs ouvertes à la référence.
- Comptabilité : historique des affectations et contre-passations, retards reportés, soldes négatifs et écarts de contrôle; crédits non affectés et écritures futures exclus explicitement.
- Interface : navigation Trésorerie, recherche de rapports, graphique et tableau quotidien, détail paginé, FR/EN, thème sombre et mobile.
- Sécurité : lecture seule, droits Comptabilité et Ventes revérifiés, données isolées par entreprise, filtres stricts et export CSV complet privé avec protection contre les formules.
- Installation : aucune migration ni configuration; limites de 1 000 comptes banque/caisse et 5 000 éléments ouverts, refus intégral au-delà; documentation et captures de référence.

## [0.4.0-alpha.85] - 2026-11-23

- Nouveautés : import CSV des douze répartitions mensuelles d’un budget existant, aperçu local actuel/proposé et confirmation du remplacement des seuls comptes listés.
- Budgets : objectifs annuels et comptes absents conservés, cellules vides retirant les objectifs, zéros explicites maintenus et somme mensuelle plafonnée à l’annuel.
- Sécurité : fichier relu côté serveur, permissions et empreinte/révision revérifiées après verrouillage, remplacement atomique audité et rollback intégral même après plusieurs lots.
- Interface : modèle vierge authentifié FR/EN, dates fiscales des colonnes et captures ordinateur/mobile, dont thème sombre; un aller-retour de langue ne réactive plus un accord ancien dans les imports annuel et mensuel.
- Installation : aucune migration ni nouvelle configuration; 250 comptes / 3 000 montants par fichier UTF-8 de 256 Kio, insertions par lots et fenêtre bornée de 120 secondes; limites ordinaires inchangées.

## [0.4.0-alpha.83] - 2026-11-23

- Nouveautés : duplication des objectifs annuels et répartitions mensuelles dans un nouveau scénario/exercice de la même entreprise, après aperçu des douze correspondances fiscales.
- Budgets : cents et zéros explicites conservés, mois absents non définis, exclusions des comptes inactifs confirmées, source indépendante et aucun mouvement réel copié.
- Sécurité : permissions revérifiées, verrouillages et empreinte d’aperçu, copie atomique auditée avec refus des modifications concurrentes et aucune création partielle.
- Capacité : jusqu’à 1 000 objectifs et 12 000 montants mensuels; fenêtre transactionnelle de 120 secondes réservée à cette copie bornée, gardes SQL et audit maintenus.
- Documentation : guide et références FR/EN, thème sombre, ordinateur et mobile. Aucune migration ni nouvelle configuration; import CSV mensuel et prévisions de trésorerie hors périmètre.

## [0.4.0-alpha.80] - 2026-11-22

- Nouveautés : modèles vierges pour les cinq types de lots QuickBooks, en français/anglais et avec virgule, point-virgule ou tabulation; CSV/TSV UTF-8 compatible avec les associations de l’assistant.
- Interface : téléchargement depuis la préparation sans perdre le fichier, l’aperçu ou le consentement, FR/EN/mobile/sombre; guide et quatre nouvelles captures.
- Confidentialité : accès administrateur et session complète, paramètres stricts et réponses privées sans cache; aucune donnée d’entreprise ou ligne d’exemple dans le fichier.
- Correction : le choix Tabulation transmet désormais une vraie tabulation au lecteur CSV et au modèle TSV, avec import fournisseur tabulé vérifié.
- Installation : aucune migration ni nouvelle configuration; aucun import ou mouvement comptable créé par le téléchargement. Les conditions de bascule restent inchangées.

## [0.4.0-alpha.79] - 2026-11-22

- Sécurité : famille Prisma en 7.10.1 et dépendance Effect corrigée en 3.22.1 contre GHSA-7589-6fvf-x4pw; audit de production conservé, sans rétrogradation de Prisma ni adoption de sa préversion majeure.
- Tests : les catégories de notes de version et leurs textes sont vérifiés selon leur présence en français et en anglais, y compris les versions contenant seulement des corrections.
- Installation : aucune nouvelle migration ni configuration par rapport à alpha.77; depuis alpha.76, les deux migrations de l’assistant QuickBooks s’appliquent par la procédure habituelle. Les listes et la bascule rapprochée restent disponibles.

## [0.4.0-alpha.77] - 2026-11-17

- Nouveautés : assistant CSV QuickBooks Online/Desktop pour clients, fournisseurs, produits/services hors inventaire et comptes, avec associations explicites et aperçu complet.
- Comptabilité : balance cible à une date de bascule, comparaison au grand livre et écriture d’ouverture des écarts ordinaires; contrôles clients/fournisseurs/taxes déjà rapprochés requis, une seule bascule par entreprise.
- Sécurité : accès administrateur, confirmation signée expirante liée au fichier/options/destination, refus des doublons et aperçus périmés, créations atomiques sous RLS/audit, provenance sans stockage du fichier brut.
- Interface : parcours FR/EN, mobile et sombre, historique des lots, colonnes ignorées explicites, guide de migration et six captures.
- Installation : deux migrations additives pour les lots immuables et leurs politiques; aucune nouvelle configuration. Historique détaillé, inventaire et fichiers natifs QuickBooks non importés.

## [0.4.0-alpha.76] - 2026-11-17

- Sécurité : Next.js et sa configuration ESLint passent en 16.4.6; la traduction utilise directement use-intl pour retirer la chaîne d’extraction picomatch vulnérable, avec cache limité à la requête, types de catalogues et fuseau préservés.

- Nouveautés : objectifs mensuels par période fiscale, répartition égale exacte proposée avant enregistrement et comparaison mensuelle au réel avec CSV privé FR/EN.
- Améliorations : champs vides distincts de zéro, reste annuel et état complet, édition atomique sur douze périodes; interface FR/EN/mobile/sombre, guide et six captures.
- Sécurité : contraintes SQL annuel/mensuel et même exercice, verrous et relecture après attente, RLS/audit/révisions contre les écrasements concurrents; baisse et retrait annuels incompatibles refusés.
- Installation : migration additive budget_monthly_target, sans nouvelle configuration ni écriture financière; duplication et import restent annuels uniquement, sans copie des répartitions mensuelles.

## [0.4.0-alpha.74] - 2026-11-17

- Nouveautés : import CSV UTF-8 des objectifs annuels vers un nouveau scénario, aperçu local complet et modèle privé français/anglais.
- Améliorations : montants exacts et zéros conservés, formats explicites, confirmation réinitialisée aux changements, limites de 256 Kio / 1 000 objectifs et erreurs sans import partiel; FR/EN/mobile/sombre, guide et quatre captures.
- Sécurité : fichier relu côté serveur, aperçu et comptes revérifiés, verrous et création atomique sous droits Comptabilité/RLS, audit par empreinte sans stockage du fichier; limite du rapport contrôlée avec l’activité existante.
- Installation : aucune migration ni nouvelle configuration; aucun budget existant écrasé, aucun réel ou mouvement comptable importé et aucun prorata automatique.

## [0.4.0-alpha.73] - 2026-11-17

- Nouveautés : duplication des objectifs annuels vers un nouveau scénario ou exercice de la même entreprise, avec aperçu et source indépendante.
- Améliorations : objectifs zéro conservés, comptes inactifs et montants exclus présentés, choix d’exclusion explicite et scénario vide annoncé; FR/EN/mobile/sombre, guide et quatre captures.
- Sécurité : confirmation atomique sous droits Comptabilité, source et comptes verrouillés, révision et empreinte contre les aperçus périmés, unicité et limite de 1 000 objectifs sans copie partielle.
- Installation : aucune migration ni nouvelle configuration; aucun réel ou mouvement comptable copié, sans prorata ni prévision automatique.

## [0.4.0-alpha.72] - 2026-11-16

- Nouveautés : scénarios de budgets annuels par exercice et objectifs par compte de revenu/charge, modifiables sans écriture financière.
- Améliorations : comparaison au réel sur l’exercice complet, objectifs absents distincts de zéro, contre-passations et comptes inactifs, export CSV exact; FR/EN/mobile/sombre, guide et quatre captures.
- Sécurité : permissions modulaires Comptabilité, isolation RLS, audit, contraintes SQL et révisions contre les écrasements concurrents; limite explicite de 1 000 comptes sans rapport partiel.
- Installation : migration additive des tables budget et budget_line appliquée par le processus habituel, sans nouvelle configuration; ventilation mensuelle et prévisions non incluses.

## [0.4.0-alpha.71] - 2026-11-16

- Nouveautés : suggestions dans la recherche d’en-tête après deux caractères, huit libellés/destinations autorisés maximum, avec navigation clavier et tactile.
- Améliorations : requêtes différées et annulables, réponses périmées ignorées, fermeture par Échap/hors champ, choix au clavier et recherche complète préservée; FR/EN/mobile/sombre, guide et quatre captures.
- Confidentialité : session complète/MFA et droits d’entreprise contrôlés à chaque requête, réponses privées sans cache, projection sans champs financiers structurés ni notes privées, destinations limitées à l’entreprise et aucun historique applicatif.
- Installation : aucune migration ni nouvelle configuration; aucun mouvement comptable ou action financière exécuté par les suggestions.

## [0.4.0-alpha.70] - 2026-11-16

- Nouveautés : 13 destinations de rapports financiers existants dans la recherche globale, noms français/anglais, synonymes explicites et liens vers leurs formulaires.
- Améliorations : type Rapport et état Disponible, recherche des noms sans accents, absence de dates/montants fictifs et filtres cohérents; FR/EN/mobile/sombre, guide et quatre captures.
- Confidentialité : combinaisons Comptabilité/Ventes/Contacts/Taxes vérifiées dans le même instantané SQL, destinations interdites exclues, liens limités à l’entreprise et aucun contenu financier dans le catalogue.
- Installation : aucune migration ni nouvelle configuration; aucun rapport enregistré ou mouvement comptable créé par la recherche.

## [0.4.0-alpha.69] - 2026-11-16

- Nouveautés : recherche globale des transactions bancaires CAD importées par libellé/bénéficiaire, date, état et montant net, avec lien direct vers la fiche.
- Améliorations : filtre exact en valeur absolue et signes affichés conservés, états non apparié/apparié/exclu, pagination stable, FR/EN/mobile/sombre, guide et quatre captures.
- Confidentialité : permissions Banque selon le module Comptabilité existant, isolation dans le même instantané SQL/RLS, métadonnées techniques et notes comptables exclues; devises étrangères non étiquetées CAD.
- Installation : aucune migration ni nouvelle configuration; aucune transaction ou écriture créée par la recherche.

## [0.4.0-alpha.68] - 2026-11-16

- Nouveautés : comparaison des codes fiscaux importés ou manuels aux taux standards officiels ARC/TVQ pour une province et une date, accessible depuis les codes et les sources.
- Améliorations : contrôle exact des composantes indépendamment de leur ordre, périodes historiques, écarts, couverture manquante, inactivité et traitements non standards explicites; FR/EN/mobile/sombre, guide et six captures.
- Confidentialité : Taxes en lecture suffit sans Comptabilité/Audit; contrôle avant le réseau et relecture locale après consultation, projection sans comptes ni données transactionnelles et isolation par entreprise.
- Installation : aucune migration ou nouvelle configuration; aucune correction automatique des taux ou pièces validées, aucune déclaration fiscale transmise.

## [0.4.0-alpha.67] - 2026-11-16

- Nouveautés : recherche globale des comptes du plan comptable et écritures manuelles/d’ouverture avec contre-passations, numéros formatés, dates, totaux exacts et états Inactif/Contre-passée.
- Améliorations : noms de comptes français/anglais, grand livre lisible des comptes inactifs et liens autorisés en lecture, gros totaux d’écritures recherchables sans augmenter les limites de saisie; filtres, pagination, FR/EN/mobile/sombre, guide et captures.
- Confidentialité : droit Comptabilité et isolation d’entreprise, notes/descriptions privées exclues, écritures des documents/paiements et leurs contre-passations exclues de ce nouveau type; source et total des débits explicités pour éviter une interprétation en mouvement net.
- Installation : aucune migration ni nouvelle configuration; extension en lecture seule sans nouvelle écriture financière ni modification de compte. Les garde-fous monétaires de saisie et de base restent inchangés.

## [0.4.0-alpha.66] - 2026-11-16

- Nouveautés : comparaison de deux périodes de taxes, par taxe et au total, avec montants perçus/récupérables, ajustements, net avant versements, versements et mouvement net; variations exactes et contrôles séparés dans un même instantané SQL.
- Améliorations : référence calendaire précédente depuis un mois/trimestre/année, quatre dates modifiables, sources détaillées conservées, CSV bilingue privé et impression/PDF navigateur, FR/EN/mobile/sombre, guide et captures.
- Fiabilité : dates ambiguës ou contradictoires refusées, taxes inactives avec mouvements conservées, contre-passations aux dates comptables et anomalies signalées même à écart nul; droits Comptabilité et Taxes, sans notes du journal ni identifiants techniques dans le CSV.
- Installation : aucune migration ni nouvelle configuration; aucun taux modifié, déclaration déposée, paiement envoyé ou écriture financière créée. Les règles de récupération partielle restent distinctes.

## [0.4.0-alpha.65] - 2026-11-16

- Nouveautés : copie comptable imprimable des remboursements fournisseurs, avec PDF navigateur, montant et date originaux, crédits d’origine complets et contre-passation datée.
- Améliorations : accès depuis la fiche en français/anglais, mobile et sombre; papier clair, commandes masquées à l’impression, origines indépendantes de la pagination et refus explicite au-delà de 1 000.
- Confidentialité : projection autorisée sans notes, motifs privés, coordonnées ni compte bancaire; fournisseur figé lisible sans Contacts/Taxes/Ventes, contrôle comptable et entreprise, copie stabilisée pendant une annulation.
- Installation : aucune migration ni nouvelle configuration; lecture seule sans écriture financière ni ordre bancaire. Guide et captures mis à jour.

## [0.4.0-alpha.64] - 2026-11-16

- Nouveautés : export CSV de tous les remboursements fournisseurs correspondant à la recherche, l’état et la période, au-delà de la page affichée; limite explicite de 10 000 résultats sans troncature silencieuse.
- Améliorations : fournisseur figé, montants exacts, état actuel et date originale, formats tableur français/anglais, interface mobile/sombre, guide et captures; accès comptable indépendant des répertoires Contacts/Taxes/Ventes.
- Sécurité : colonnes autorisées uniquement, notes et motifs privés exclus, textes de formule neutralisés, téléchargement privé non mis en cache et filtres ambigus refusés.
- Installation : aucune migration ni nouvelle configuration; export en lecture seule, sans paiement ou écriture supplémentaire.

## [0.4.0-alpha.63] - 2026-11-15

- Nouveautés : remboursements reçus sur un crédit fournisseur disponible, compte banque/encaisse/carte, numéro d’encaissement, écriture et affectation atomiques; fiche avec origines paginées et contre-passation datée idempotente.
- Améliorations : historique fournisseur recherché/filtré, nouveau lien Dépenses, accès direct depuis recherche globale et relevé fournisseur; disponible et rapports datés rapprochés, taxes inchangées, consultation sans répertoires Contacts/Taxes/Ventes. Interface FR/EN/mobile/sombre, guide et captures.
- Fiabilité : soldes revérifiés sous verrou et refus des règlements concurrents, dates antérieures aux mouvements, périodes fermées, comptes non admissibles et accès étrangers; transactions financières et numérotation vérifiées.
- Installation : aucune migration ni nouvelle configuration. Les remboursements enregistrent des montants reçus séparément et n’émettent aucun ordre bancaire; compensations historiques à résoudre séparément.

## [0.4.0-alpha.62] - 2026-11-15

- Nouveautés : section intégrée à Versions et mises à jour, avec listes françaises/anglaises des fonctions, améliorations, corrections et consignes d’installation de la version exacte; guides associés et historique des cinq dernières versions documentées, sans version future.
- Améliorations : notes lisibles sans connexion à GitHub et sans privilège serveur, interface mobile et thèmes clair/sombre; lien depuis l’administration serveur, guide et captures.
- Fiabilité des releases : préparation et publication bloquées sans notes bilingues valides ou avec un guide introuvable, avant toute modification du changelog, des manifestes ou création de tag.
- Installation : aucune migration de base ni nouvelle variable de configuration; mise à jour du serveur puis rechargement de l’application par le processus habituel.

## [0.4.0-alpha.61] - 2026-11-15

- Crédits fournisseurs : affectation partielle ou complète à une facture ouverte du même fournisseur, recherche littérale bornée, révision des soldes sous verrou, retrait daté et historique paginé; consultation indépendante des répertoires Contacts/Taxes/Ventes. Migration de gardes SQL pour la chronologie, les périodes ouvertes et l’isolation des opérations; paiements concurrents et rapports datés vérifiés, sans nouvelle écriture pour l’affectation. Interface FR/EN/mobile/sombre, guide et captures.

## [0.4.0-alpha.60] - 2026-11-15

- Rapports de taxes de vente : raccourcis mensuels, trimestriels et annuels calendaires, période personnalisée conservée, bornes bissextiles exactes et sélection commune à la page, la pagination et au CSV. Refus des paramètres invalides, répétés ou contradictoires sans repli silencieux, indication des périodes non terminées; FR/EN/mobile/sombre, guide et captures.
- Crédits fournisseurs : validation avec affectation à la source ou conservation disponible, y compris sur facture déjà payée; disponible sur fiche/liste, mêmes plafonds et taux d’origine, numérotation/journal atomiques et annulation datée. Rapports fournisseurs et taxes rapprochés, permissions/concurrence/idempotence testées, guide illustré. Aucune migration ni opération bancaire; remboursements et affectations ultérieures restent distincts.

## [0.4.0-alpha.59] - 2026-11-15

- Copies comptables des factures et crédits fournisseurs : impression/PDF navigateur FR/EN, mobile et thèmes clair/sombre, coordonnées figées et montants exacts, annulations datées. Notes, motifs privés et justificatifs exclus du HTML imprimable. Consultation des copies et fiches indépendante des répertoires Contacts/Taxes, avec libellés fiscaux facultatifs; guide et captures. Aucune migration ni nouvelle écriture.

## [0.4.0-alpha.58] - 2026-11-14

- Historique des décaissements : recherche littérale fournisseur/numéro/référence, filtres état/date et pagination conservée; export CSV complet jusqu’à 10 000 résultats, montants exacts et textes neutralisés, sans notes privées. Identités figées et consultation sans accès Contacts ou Ventes; interface FR/EN/mobile/sombre, tests de droits et guide illustré. Aucune nouvelle écriture ni migration.

- Présentation GitHub en anglais par défaut : README et bannière traduits, version française conservée avec sélecteur de langue; installation et captures bilingues préservées.

- Présentation du projet : README restructuré autour de l’application, de ses fonctions disponibles et de son installation depuis GitHub, bannière originale, captures sélectionnées et liens vers les guides; accueil du wiki harmonisé.

## [0.4.0-alpha.57] - 2026-11-14

- Envoi manuel des devis : finalisation/numérotation clarifiée, aperçu FR/EN des données figées et conditions publiques, destinataire confirmé et historique SMTP immuable. Notes internes exclues du parcours, idempotence, limites de fréquence, RLS et audit; refus des nouveaux envois après expiration ou réponse. Interface mobile/sombre, guides et captures, sans signature ni envoi planifié.

## [0.4.0-alpha.56] - 2026-11-14

- Relances clients manuelles : file paginée des factures échues, recherche sur coordonnées figées, aperçu FR/EN et confirmation SMTP avec solde revérifié sous verrou. Historique distinguant facture et relance, montant/date conservés, idempotence et limites communes, droits modulaires et contrôles SQL; interface mobile/sombre, guide et captures. Aucun envoi planifié ni écriture comptable.

## [0.4.0-alpha.55] - 2026-11-14

- Factures récurrentes : calendrier mensuel/trimestriel/annuel à jour fixe, préparation confirmée d’un brouillon par échéance due, taxes datées et arrondi source conservé. Pause/annulation, idempotence, historique après suppression et client protégé; droits modulaires, audit et guards SQL. Interface FR/EN/mobile/sombre et guide illustré; aucun envoi ni comptabilisation automatique.

- Documentation : correction du lien du guide Devis vers la validation des factures dans le wiki.

## [0.4.0-alpha.54] - 2026-11-14

- Devis commerciaux : brouillons, remise manuelle numérotée, acceptation/refus, annulation, copie et impression privée sans notes internes. Conversion concurrente vers une facture brouillon avec recalcul fiscal daté, client protégé et reprise après suppression du brouillon. Droits modulaires, audit et invariants SQL; recherche globale, écrans FR/EN/mobile/sombre et guide illustré. Les notes internes du devis ne sont pas copiées dans la facture. Contraste des tableaux imprimables corrigé en thème sombre. Consultation des factures conservée avec les droits Ventes lorsque les répertoires Contacts ou Taxes sont masqués.

## [0.4.0-alpha.52] - 2026-11-14

- Connexions officielles ARC et Revenu Québec : consultation TPS/TVH par province et date, TVQ historique, création confirmée d’un code fiscal et de ses taux avec comptes choisis, provenance et empreintes en audit. Contrôle du schéma, des changements depuis l’aperçu, des droits et de l’atomicité; aucune modification des pièces validées. Parcours FR/EN/mobile/sombre documentés.
- Catalogue : les droits de gestion des produits sont indépendants de l’écriture fiscale; les références comptables/fiscales existantes sont conservées sans droit de lecture, leurs changements exigent les droits correspondants. Consultation des taxes sans accès obligatoire au plan comptable.

## [0.4.0-alpha.51] - 2026-11-13

- Outillage : exclusion des résultats et rapports générés par Playwright du lint, pour éviter un parcours concurrent de leurs répertoires temporaires.

- Recherche globale des données de l’entreprise depuis l’en-tête : contacts, catalogue et neuf types de pièces/paiements, références et montants exacts, filtres type/statut/date/montant, pagination bornée et liens directs. Isolation entreprise et permissions modulaires à chaque lecture, catalogue consultable sans droits fiscaux et conservation des montants lors du changement de langue; interfaces FR/EN, mobile et sombre documentées avec captures.

- Relevé de compte fournisseur daté : soldes créditeurs exacts, factures/crédits/paiements et contre-passations, recherche bornée, pagination, CSV complet et impression/PDF navigateur. Permissions Comptabilité/Contacts, exclusion des comptes clients et notes internes, parcours FR/EN/mobile/sombre illustrés; aucune nouvelle écriture ni migration.

## [0.4.0-alpha.50] - 2026-11-13

- Restauration : validation des chemins, types, doublons et répertoires de contrôle de l’archive interne des pièces jointes avant arrêt ou modification de la base; remplacement des anciens fichiers cachés et extraction sans réseau avec racine en lecture seule. Correction de l’appel Compose de création du proxy avant restauration de l’autorité; régressions et restauration HTTPS réelle en CI native AMD64/ARM64.

## [0.4.0-alpha.49] - 2026-11-05

- HTTPS local : contrôle de la configuration Compose rendue avant démarrage, changement de version et interruption par l’agent hôte récent; refus des surcharges incompatibles et isolation des variables du shell. Validation des archives avant restauration et protection des destinations `.env`/certificat public contre les liens symboliques ou répertoires. La copie privilégiée de l’agent reste à actualiser explicitement après revue.

## [0.4.0-alpha.48] - 2026-11-05

- HTTPS local par IP proposé par défaut aux nouvelles installations, via Caddy optionnel et autorité privée persistante, sans domaine public ni publication des ports 80/443. Conversion explicite des instances existantes, export du certificat public avec empreinte SHA-256 et guides de confiance Windows/iOS; mode HTTP explicite conservé.

## [0.4.0-alpha.47] - 2026-11-05

- Installateur Docker : activation par défaut de l’agent de mise à jour web après démarrage sain sur Linux en root avec Python 3 et systemd actif; option `--no-web-updates`, aucune activation en préparation seule et avertissement sur les hôtes non compatibles. Activation gérée relançable sans écraser les configurations Compose personnalisées; montage de contrôle conservé aux redémarrages et helpers de mise à jour rechargés. Les installations de nouvelles versions restent soumises à la demande et à la confirmation d’un administrateur autorisé.

## [0.4.0-alpha.46] - 2026-11-05

- Mise à jour serveur accessible depuis l’administration et la page Versions : release publiée plus récente, confirmation de sauvegarde et d’interruption, suivi des étapes et reconnexion après redémarrage. Activation de l’agent hôte toujours volontaire; compatibilité avec les anciens états simples et guides illustrés FR/EN/mobile/sombre.

## [0.4.0-alpha.45] - 2026-11-04

- Remboursement partiel ou complet du disponible d’un encaissement sans avoir, avec écriture de sortie, compensation liée, contrôle du disponible revu et reprises idempotentes; annulation par contre-passation qui rétablit le disponible sans changer les affectations aux factures. Historiques et origines paginés, recherche du numéro d’encaissement source, permissions modulaires et guides illustrés FR/EN/mobile/sombre. Migration `20261110000000_customer_receipt_refunds` : dates, droits, concurrence et écriture exacte des remboursements renforcés en base.

## [0.4.0-alpha.44] - 2026-11-04

- Encaissements au compte client sans facture, comptabilisés une seule fois par soumission, puis affectables partiellement à plusieurs factures du même client sans nouvelle écriture; désaffectations datées, disponible net, recherche bornée, historique paginé et contrôles des deux soldes, dates, périodes et permissions. Guides illustrés FR/EN/mobile/sombre. Migration `20261109000000_customer_account_receipts`.
- Fiches de factures : soldes, encaissements et actions comptables respectent les permissions modulaires; consultation, impression et courriels conservés quand les références de taxes sont masquées.

## [0.4.0-alpha.43] - 2026-11-04

- Affectation partielle ou complète d’un avoir disponible à une facture ouverte du même client, sans transfert de fonds ni nouvelle écriture : recherche bornée, contrôle des deux soldes, désaffectation datée et historique paginé FR/EN/mobile/sombre. Droits Ventes/Comptabilité et contrôles SQL renforcés sur dates, périodes et concurrence; migration `20261108000000_customer_credit_applications`.

## [0.4.0-alpha.42] - 2026-11-03

- Historiques des encaissements et remboursements clients : recherche littérale client/numéro/référence, filtres de dates inclusives et d’état, pagination conservée, réinitialisation et états sans résultat FR/EN/mobile/sombre.
- Consultation des encaissements sans relation Contact obligatoire : identité figée des pièces et repli facultatif pour les anciens paiements sans pièce; permissions Ventes/Comptabilité explicites sur services, écrans et navigation.

## [0.4.0-alpha.41] - 2026-11-03

- Fiche d’avoir consultable avec le module Taxes désactivé : montants conservés et libellé générique pour les références fiscales masquées, sans droit supplémentaire.

- Avoir disponible sur facture déjà payée, remboursements clients partiels ou complets et annulation comptabilisée avec libération du disponible; permissions modulaires, vérification du solde revu et historique conservé.
- Relevé de compte client daté : recherche bornée, soldes et mouvements dans un même instantané, pagination, CSV et impression complète sans notes internes; écrans FR/EN, mobile et sombre, guides illustrés.
- Annulation d’encaissement protégée contre un ancien instantané après dépôt concurrent : READ COMMITTED imposé par le trigger PostgreSQL, avec reproduction déterministe sur deux connexions.
- Diagnostics navigateur CI conservés séparément pour ordinateur/mobile et étapes métier nommées et actions bornées à 30 s; délai global de 300 s et assertions conservés.

## [0.4.0-alpha.40] - 2026-11-03

- Dépôts bancaires groupés des encaissements en fonds non déposés : sélection et total exact, références, historique, annulation par contre-passation, navigation et écrans FR/EN adaptatifs. Contrôles en base des écritures exactes, doubles dépôts, dates de libération, permissions et courses entre appariement/pointage et annulation.

## [0.4.0-alpha.39] - 2026-11-03

- Règles bancaires par entreprise : création depuis une opération, conditions littérales et montants exacts, priorité, modification et pause, aperçu borné, suggestions FR/EN et confirmation explicite. Application atomique avec contrôle de révision, comptes actifs, permissions modulaires, audit et protection des doubles confirmations; aucun calcul de taxe ni paiement de facture automatique.

## [0.4.0-alpha.37] - 2026-11-02

- Sélection de compte du grand livre et de ses CSV refusée lorsqu’elle est invalide, inconnue, étrangère ou répétée, sans repli involontaire vers tous les comptes; validation partagée avec le suivi de trésorerie.

- Suivi de trésorerie BANK/CASH par période et compte : soldes exacts, virements purs séparés, écritures mixtes signalées en brut, contrôle du grand livre et détail paginé dans un même instantané, avec CSV FR/EN complet sous permissions Comptabilité. Disponibilités des espaces d’activité corrigées.

## [0.4.0-alpha.36] - 2026-11-01

- Grand livre par contact : lignes et soldes filtrés, pagination et raccourcis conservés, recherche bornée des contacts historiques et exports CSV FR/EN contextualisés. Le filtre respecte les permissions Comptabilité et Contacts et refuse les contacts invalides ou étrangers.

## [0.4.0-alpha.35] - 2026-11-02

- Impression et enregistrement PDF via le navigateur pour les résultats, le bilan et leurs comparatifs : identité de l’entreprise et devise, contrôles masqués, papier blanc en thème sombre et comparatifs en paysage, sans nouveau calcul ni dépendance PDF serveur.

## [0.4.0-alpha.34] - 2026-11-02

- Comparaison de deux bilans : soldes cumulatifs, écarts et pourcentages exacts, répartition des résultats selon chaque exercice, contrôles d’équilibre distincts et export CSV FR/EN dans un même instantané comptable, sous permissions Comptabilité.

## [0.4.0-alpha.33] - 2026-11-01

- État des résultats comparatif sur deux périodes libres : comptes alignés, écarts exacts, pourcentages sur références positives, lecture cohérente dans un instantané, consultation et CSV FR/EN intégrés au rapport existant sous permissions Comptabilité.

## [0.4.0-alpha.32] - 2026-11-01

- Sommaire TPS/TVQ et autres taxes par période : montants comptabilisés perçus/récupérables, ajustements et versements séparés, contrôle cohérent du grand livre, anomalies signalées, détail paginé et CSV FR/EN intégral sous droits Comptabilité et Taxes. Aucune déclaration ni écriture créée.

## [0.4.0-alpha.31] - 2026-11-01

- Âge des comptes fournisseurs à une date donnée : factures par tranche, crédits/paiements non affectés, annulations historiques, contrôle du grand livre dans un même instantané, consultation FR/EN et export CSV sous permissions Comptabilité.

## [0.4.0-alpha.28] - 2026-11-01

- Envoi manuel des factures validées par SMTP en français/anglais : coordonnées figées, destinataire confirmé, historique protégé par les permissions Ventes, soumissions idempotentes, limites et résultats incertains sans renvoi automatique. Configuration TLS explicite.

## [0.4.0-alpha.26] - 2026-11-01

- Justificatifs des factures et avoirs clients : dépôt/téléchargement sous permissions Ventes, retrait sur brouillons, conservation après validation et portée immuable en base pour isoler ventes et comptabilité.

- CI : un seul worker pour la suite de tests, afin d’isoler le garde chronométré des écritures de la concurrence entre bases de tests; seuil et assertions inchangés.

## [0.4.0-alpha.24] - 2026-11-01

- Justificatifs privés sur les factures fournisseurs, crédits et dépenses : PDF/PNG/JPEG jusqu’à 4 Mo, permissions Comptabilité, téléchargement contrôlé avec vérification SHA256, retrait limité aux brouillons et conservation sur les pièces comptabilisées.

## [0.4.0-alpha.23] - 2026-10-31

- Dépenses immédiatement payées : brouillons, choix banque/encaisse/carte et mode de paiement, validation directe des charges/taxes contre le compte choisi, annulation et contrôle exact des écritures en base.

## [0.4.0-alpha.22] - 2026-10-31

- Crédits fournisseurs : validation et application intégrale à la facture d’origine, contrôles cumulés par ligne/taxe en base, écriture exacte, annulation par contre-passation et historique des affectations.

## [0.4.0-alpha.21] - 2026-10-31

- Brouillons de crédits fournisseurs liés aux factures : montants par ligne, taux d’origine, modification et suppression avec contrôle de version, permissions Comptabilité. Sans comptabilisation ni réduction du solde à ce stade.

## [0.4.0-alpha.20] - 2026-10-31

- Paiements fournisseurs partiels ou complets, solde à payer sur les factures, historique et annulation par contre-passation, permissions Comptabilité.

## [0.4.0-alpha.19] - 2026-10-31

- Factures fournisseurs : brouillons, référence unique par fournisseur, validation vers comptes fournisseurs et taxes entièrement récupérables, annulation par contre-passation, permissions Comptabilité et parcours FR/EN sur ordinateur/mobile.

## [0.4.0-alpha.18] - 2026-10-27

- Version imprimable des factures validées : coordonnées figées, lignes/taxes/totaux exacts, annulation visible et impression/enregistrement PDF via le navigateur, protégés par les droits de vente.

## [0.4.0-alpha.17] - 2026-10-27

- Espace Paramètres et administration : profil et préférences fiscales, comptabilité, permissions, sécurité, intégrations, sauvegardes/serveur, apparence et mises à jour regroupés selon les droits du compte.

## [0.4.0-alpha.16] - 2026-10-27

- Navigation par domaine : suppression du menu global dupliqué en haut, onglets contextuels Ventes/Banque/Comptabilité/Rapports et sélection du domaine sur les pages de détail. Recherche et accès mobiles conservés selon les permissions.

## [0.4.0-alpha.15] - 2026-10-26

- Recherche des sections dans le menu ordinateur et mobile : accents et casse ignorés, compteur et état vide, effacement, français/anglais et respect des permissions.

- Navigation : menus, onglets et espaces filtrés selon les permissions modulaires; intégrations réservées aux admins, âge clients soumis aux ventes et à la comptabilité, accès direct aux espaces interdits refusé. Contrôles navigateur de révocation et de rétablissement des accès sur ordinateur et téléphone.

## [0.4.0-alpha.14] - 2026-10-26

- Tests : vérifier les index valides du grand livre dans le catalogue PostgreSQL plutôt que le choix de plan sur un petit jeu de données; le test de durée des écritures reste inchangé.

- Rapports (phase 6, lot 6c) : âge des comptes clients (Rapports et Ventes → Âge des comptes clients) : ce que chaque client doit à un jour donné, par tranche de jours écoulés depuis l'échéance (courant, 1–30, 31–60, 61–90, 91 et plus), avec le détail des pièces et leurs liens, une colonne pour les avoirs et encaissements non appliqués, et la concordance avec le solde des comptes clients du grand livre. Le rapport d'un jour passé redonne ce qu'il était alors (paiements et avoirs comptés à partir du jour où ils ont été appliqués, pièces annulées jusqu'à la veille). Export CSV d'une ligne par pièce ouverte (mêmes règles d'encodage et de protection que les autres exports). Correction : un jour impossible comme `2026-13-01` donne maintenant le refus « période invalide » dans les rapports au lieu d'une erreur inattendue. Aucune migration.

- Rapports (phase 6, lot 6b) : grand livre (Rapports et Comptabilité → Grand livre) : le détail d'un compte sur une période, soit son solde d'ouverture, chaque ligne du journal (date, écriture liée au journal, description, contact, débit, crédit) avec le solde qui suit, et son solde de clôture, dans le sens habituel du compte; lignes par date, numéro d'écriture et numéro de ligne, lues par pages de 100 avec des soldes qui se suivent; écritures contre-passées signalées. Export CSV à plat d'un compte ou de tous les comptes qui ont bougé (lignes d'ouverture et de clôture, mêmes règles d'encodage et de protection que les autres exports; au plus 200 000 lignes). Les champs de date des rapports suivent désormais la page quand on choisit un exercice. Aucune migration.

- Intégration des rapports avec les permissions modulaires : contrôle d’accès aux pages et exports, test de révocation du module comptable.

- Rapports (phase 6, lot 6a) : état des résultats (revenus, coût des ventes, charges, autres éléments, bénéfice brut, bénéfice d'exploitation et résultat net d'une période, du jour au jour inclus, par défaut l'exercice en cours) et bilan (actif, passif et capitaux propres à un jour, avec les résultats des exercices précédents et celui de l'exercice en cours, puisqu'aucune écriture de clôture n'est passée), sous Rapports et Comptabilité; tous les membres qui lisent le journal les consultent. Calculés à l'ouverture depuis le grand livre en cents exacts; le bilan confirme que l'actif égale le passif plus les capitaux propres. Export CSV de chacun : UTF-8 avec marque d'ordre des octets, séparateur et décimale selon la langue (point-virgule et virgule en français), montants exacts sans séparateur de milliers, protection des noms de compte contre l'injection de formule, jamais mis en cache. Aucune migration.

## [0.4.0-alpha.13] - 2026-10-26

- Banque (phase 5, lot 5c) : rapprochement bancaire (Banque et transactions → Rapprochement bancaire; propriétaires et comptables agissent, tous consultent). On commence un rapprochement par compte de banque, de caisse ou de carte de crédit avec la date et le solde finaux du relevé (le solde dû pour une carte), on pointe les lignes du journal que le relevé confirme (une case par ligne, ou d'un clic toutes celles qu'apparient des transactions) avec le solde du relevé, le total compté et l'écart en direct, et on le termine quand l'écart est exactement nul. Un rapprochement terminé est figé et fige les appariements de ses lignes; seul le dernier d'un compte se rouvre, avec un motif consigné à la piste d'audit; on peut abandonner celui qui est en cours. Une ligne n'est comptée que par un rapprochement, sur son compte, au plus le jour du relevé; au plus 5 000 lignes par feuille. Les règles sont celles du domaine, du service et de la base (gardes déjà en place). Migration `20261028000000_bank_reconciliation` : seul un rapprochement terminé fige un appariement (les coches d'un rapprochement en cours se changent librement). Aucune écriture n'est créée ni changée.

- Banque (phase 5, lot 5b) : appariement des transactions bancaires (Transactions bancaires → Traiter; propriétaires et comptables). Allumi propose l'écriture probable de chaque ligne (même compte, montant exact, sept jours, la plus proche) et l'apparie en un clic; une fiche permet d'apparier une ligne à une ou plusieurs lignes du journal cochées (un dépôt de plusieurs chèques, un paiement Stripe brut moins les frais) avec le total courant, d'enregistrer une ligne contre un autre compte (écriture de deux lignes de source Banque, datée de la transaction) ou de lier deux lignes de montants opposés sur deux comptes en un virement (une écriture, datée de la plus ancienne). Le total apparié est exactement le montant de la transaction (domaine, service et base); une ligne du journal ne s'apparie qu'à une transaction, même sous deux demandes simultanées; une transaction n'a jamais deux écritures non contre-passées; défaire un appariement est refusé tant qu'un rapprochement compte la ligne. Les écritures de source Banque se contre-passent comme les écritures manuelles. Migration `20261027000000_bank_matching` (garde sur `bank_match`); le rapprochement de fin de période suit.

- Banque (phase 5, lot 5a) : import de relevés bancaires et de cartes de crédit en CSV et en OFX/QFX (Transactions bancaires → Importer un relevé; propriétaires et comptables). Le navigateur lit le fichier avec le code du serveur pour l'aperçu (format, nombre de transactions, dates, entrées et sorties, premières lignes, choix des colonnes d'un CSV : date et son ordre, description, montant en une colonne signée ou en deux colonnes sorties/entrées, séparateur décimal, signes inversés pour une carte); le serveur relit le fichier avant d'enregistrer. Montants en cents exacts, UTF-8 et Windows-1252, 4 Mo et 20 000 lignes au plus; un fichier ou une ligne illisible refuse l'import entier. Un fichier déjà importé est refusé (SHA-256) et une ligne déjà connue est laissée telle quelle (identifiant de la banque pour l'OFX; date, montant, description et rang pour le CSV), donc des relevés qui se chevauchent s'importent sans doublon, même simultanément. Le fichier n'est pas conservé; les colonnes choisies sont retenues par compte. La page des transactions importées devient « Transactions bancaires » : tous les comptes, relevés et services (Stripe, PayPal) ensemble, avec filtres et recherche. Aucune écriture comptable, aucune migration; l'appariement et le rapprochement suivent.

- Paiement en ligne des factures (Stripe) : le propriétaire crée, pour une facture validée, un lien de paiement hébergé par Stripe (une page, un paiement, pour le solde du moment; aucune adresse publique ni webhook : Allumi appelle Stripe et, sur demande, regarde si la page a été payée). Un paiement réglé s'enregistre en une transaction : encaissement au montant brut sur le compte de la connexion, appliqué à la facture, et frais de traitement dans une écriture à part (compte de charges choisi sur la connexion), de sorte que le solde du compte égale le net versé par Stripe. Rien ne s'enregistre deux fois (session unique, lien verrouillé, clés d'idempotence à la création); ce que les livres refusent (solde changé, facture annulée, période verrouillée, autre devise de règlement) met le lien « À vérifier » avec sa raison, sans rien écrire. Annulation d'un lien (page fermée chez Stripe, paiement arrivé entre-temps enregistré). La base refuse les mêmes cas que le domaine (gardes `payment_link_guard` et `online_payment_guard`, un seul lien en cours par facture, rien ne se supprime ni ne change une fois payé). Dollars canadiens, 0,50 $ à 999 999,99 $; PayPal et les remboursements viendront après. Appels non essayés contre un vrai compte Stripe : voir la page Intégrations. Migration `20261026000000_online_payments`; dépend des encaissements (#31) et des intégrations (#32).

- Administration serveur : capacité globale déléguée par le super admin, confirmation du mot de passe, paramètres non secrets et santé, agent optionnel pour les sauvegardes et leur rétention, inventaire et journal d’opérations filtré. Aucun socket Docker ni archive exposé au web.

- Loi 25 : le propriétaire peut anonymiser un contact depuis sa fiche. Réservé au propriétaire, avec la vérification en deux étapes et un code saisi à ce moment (un code de récupération convient), un motif tiré d’une liste fixe et une confirmation. En une seule transaction : la fiche perd nom, coordonnées, adresse, notes et numéros de taxes; ces champs sont retirés de toute la piste d’audit de la fiche (`audit_redact`); `contact.anonymize` et `privacy.redact` consignent qui, quand et pourquoi, sans renseignement personnel. Les factures validées gardent la copie figée de leur client (pièce comptable). Un test de classification oblige à décider du sort de toute nouvelle colonne de `contact`. Nouvelle permission `contact.anonymize`. Aucune migration.

- Encaissements de factures (lot 4.5) : une facture validée affiche son état (non payée, partiellement payée, payée), ses encaissements et, pour le propriétaire et les comptables, un formulaire qui propose le solde restant. Un encaissement crée en une transaction l’écriture (débit du compte de réception : banque, caisse ou fonds non déposés; crédit des comptes clients), l’encaissement numéroté sans trou (`E-00001`) et l’affectation à la facture. Le solde vu par le formulaire est vérifié sous verrou : un double envoi, un formulaire périmé ou deux encaissements simultanés ne dépassent jamais le solde. Nouvelle page Ventes → Encaissements (liste et fiche) et annulation motivée (écriture inverse, affectation retirée, solde rétabli); une facture ne s’annule plus tant qu’un encaissement lui est appliqué. Ni remboursement, ni dépôt groupé, ni trop-perçu, ni paiement fournisseur dans ce lot. Aucune migration.

- Intégrations (Stripe et PayPal) : le propriétaire connecte un service (clés vérifiées auprès du service, puis chiffrées en AES-256-GCM, liées à la connexion, lisibles du propriétaire seul et jamais copiées dans l’audit) et importe ses transactions (paiements, frais, remboursements, virements) dans une boîte de réception : Banque et transactions → Intégrations et Transactions importées. Montants en cents exacts (brut, frais, net), devise conservée (pas de conversion), devises sans cents ignorées et comptées; réponse inattendue refusée sans rien importer. Synchronisation manuelle, idempotente, par fenêtres de 31 jours reprises là où elles s’arrêtent, un passage à la fois. Aucune écriture comptable ni donnée de client importée. Architecture prête pour d’autres services (Square, flux bancaires, Shopify/WooCommerce…). Les connecteurs suivent la documentation officielle mais n’ont pas été essayés contre un vrai compte : voir la page Intégrations. Migration `20261025000000_integrations`; `ENCRYPTION_KEY` protège désormais aussi ces clés.

- Gestion des utilisateurs : invitations à usage unique, rôles admin/utilisateur/lecteur/comptable externe et permissions modulaires appliquées côté serveur et par RLS.

## [0.4.0-alpha.12] - 2026-10-25

- Publication : démarrage réel des images téléchargées depuis GHCR sur AMD64 et ARM64 avant publication des fichiers de release.

- Sécurité : politique CSP stricte par nonce sur les pages (scripts et styles seulement avec un nonce neuf à chaque réponse, `strict-dynamic`, aucun `unsafe-inline` ni `unsafe-eval` en production), générée par `src/proxy.ts` à partir de `src/platform/csp.ts`. Sans `upgrade-insecure-requests` (HTTP direct par conception). Les images et icônes gardent la politique ciblée. Le parcours navigateur échoue à la moindre ressource bloquée. Aucune migration.

- Installation : le jeton de première configuration est affiché à la fin de l’installation (`install-docker.sh`, donc aussi `get.sh --docker-only`, et `install.sh`), avec ce à quoi il sert. Il n’apparaît que si la page `/setup` est encore ouverte, vérifiée sur la vraie page dans le conteneur : une instance déjà configurée n’affiche plus un secret inutile, et sans réponse le script renvoie vers `.env`. `install.sh` l’affichait toujours; il utilise maintenant la même vérification, sans doublon. C’est le seul secret imprimé.

- Sécurité du déploiement : `update.sh` et `up.sh` ignorent désormais les variables de déploiement exportées par le shell (`DATABASE_URL`, `APP_DATABASE_URL`, `ALLUMI_APP_IMAGE`, etc.), comme le faisait déjà `install-docker.sh`. Compose donne la priorité à l’environnement sur `.env` : un shell de développement pouvait faire migrer et servir la mauvaise base. Fonction commune `isolate_deployment_env` dans `lib.sh`.

- Nouveau logo, original : une flamme (« allumé ») posée sur un signe égal (débit = crédit), à la place de la lettre « a » sur fond vert. Logo dessiné dans l’en-tête et le menu, icône d’onglet (SVG et `favicon.ico`, jusque-là absentes), icônes iOS et PWA avec variante « maskable » pour Android, icône de l’installateur Windows. Tout est généré par `npm run icons` à partir d’une seule définition; tests de cohérence ajoutés. Les captures ordinateur et téléphone du README et du wiki ont été régénérées avec ce logo.

- Images déjà construites : une copie placée sur une version étiquetée télécharge les images publiées par la release (application et migrations, AMD64/ARM64) au lieu de les compiler. `install-docker.sh`, `update.sh` (donc aussi la mise à jour depuis l’interface) et le nouveau `up.sh` choisissent seuls; repli sur la construction si les images sont introuvables, pour une branche ou des fichiers modifiés, ou avec `--build`. Le Compose lit `ALLUMI_APP_IMAGE`/`ALLUMI_MIGRATE_IMAGE` (noms locaux par défaut : développement et CI inchangés). La première mise à jour depuis une version antérieure construit encore sur place.

## [0.4.0-alpha.11] - 2026-10-25

- Documentation : captures ordinateur/téléphone de l’écran Sécurité du compte (appareils connectés et changement de mot de passe).

- Documentation : cadrage mobile ciblé, références dans le README et génération des captures par préfixe.
- Installation en une commande : `scripts/get.sh` (POSIX sh, utilisable avec `curl … | sh`) détecte le système, le processeur (AMD64/ARM64), la mémoire, le disque, la virtualisation, les droits et Docker, puis lance `install.sh` ou `install-docker.sh`. `--check` ne modifie rien; confirmation avant d’agir; dépôt cloné sur la dernière version, sans écraser de modifications locales. Tests dans la CI.

- Sécurité du compte : liste des appareils connectés avec déconnexion d’un appareil ou de tous les autres, et changement de mot de passe (mot de passe actuel exigé, politique de longueur, essais limités, autres appareils déconnectés, piste d’audit). FR/EN, sans migration.

## [0.4.0-alpha.10] - 2026-10-24

- Docker : application HTTP directe sur 28080 et PostgreSQL privé, sans Caddy ni SSL intégré; assistant par URL/IP, transition documentée avec conservation des données, tests natifs AMD64/ARM64. En accès direct, ignorer les en-têtes IP transférés; première configuration protégée par jeton en production HTTP comme HTTPS.

## [0.4.0-alpha.9] - 2026-10-24

- Docker : ports initiaux 28080/28443, conservation des anciens ports, CI native AMD64/ARM64 et publication des images serveur/migrations avec manifestes multiarchitecture.

- Assistant Docker interactif standard/avancé : domaine, courriel, langue, ports, adresse IPv4, délai et préparation seule; récapitulatif avant confirmation, conservation des réglages et secrets. Ports Compose persistants et redirection HTTP respectant le port HTTPS configuré.

## [0.4.0-alpha.8] - 2026-10-24

- Dépendance transitive `fast-uri` mise à jour de 3.1.8 à 3.1.9 pour corriger les avis de sécurité sur la normalisation des URI.

- Sécurité : sérialisation des changements 2FA, vérification et autorisation de session atomiques, expiration après dix minutes des connexions en attente de 2FA; protections HTTP et CSP ciblée servies aussi sans Caddy.

## [0.4.0-alpha.7] - 2026-10-24

- Annulation atomique des avoirs : retrait daté des affectations d’origine, contre-passation exacte, motif et historique FR/EN sur ordinateur et mobile; refus des remboursements actifs et affectations à une autre facture.

## [0.4.0-alpha.6] - 2026-10-24

### Ajouté
- Installateur Docker Compose dédié : préparation seule, génération atomique de configuration privée, conservation des secrets, refus des configurations de développement et des volumes orphelins, contrôle de santé avec code d’échec. Tests du script et démarrage réel de la pile dans la CI; guide Docker/Proxmox.

## [0.4.0-alpha.5] - 2026-10-24

### Ajouté
- Validation et affectation intégrale des avoirs à leur facture : numérotation atomique, écritures inversées exactes, limites cumulées de lignes/taxes, contrôles de solde et de concurrence, consultation FR/EN et mobile. Migration `20261024000000_credit_posting`.

## [0.4.0-alpha.4] - 2026-10-23

### Ajouté
- Brouillons d’avoirs partiels liés aux factures : montants par ligne, taux historiques, contrôle des révisions, consultation et suppression; parcours FR/EN, sombre et mobile. Aucun effet comptable avant une future validation.

## [0.4.0-alpha.3] - 2026-10-23

### Ajouté
- Annulation confirmée des factures avec motif, date de contre-passation, écriture inverse exacte et historique conservé. Contrôles des périodes, paiements/avoirs liés, permissions et doubles demandes; parcours FR/EN et mobile.

## [0.4.0-alpha.2] - 2026-10-23

### Corrigé
- Le sélecteur d’apparence conserve visuellement le thème enregistré après l’action serveur.

### Ajouté
- Validation atomique des factures : numéro définitif, journal équilibré, contrôle SQL des comptes de revenus et taxes, coordonnées figées, consultation FR/EN et mobile des factures verrouillées. Requêtes répétées sans double comptabilisation; annulations, avoirs, envoi et paiements non disponibles dans l’interface.

## [0.4.0-alpha.1] - 2026-10-22

### Ajouté
- Brouillons de factures FR/EN et mobile : clients, articles, lignes libres, calcul exact des taxes, recherche, modification et suppression confirmée, audit et protection contre les modifications périmées. Aucun effet comptable ni numéro définitif; validation et avoirs à venir.

## [0.3.0-alpha.2] - 2026-10-21

### Ajouté
- Fiche Entreprise FR/EN et mobile : identité, coordonnées, numéros fiscaux normalisés et réglages de documents; propriétaire seul en modification, consultation par les membres, audit et captures documentées. Reprise adaptée du travail de Claude dans la PR #4.

## [0.3.0-alpha.1] - 2026-10-21

### Ajouté
- Taxes et catalogue bilingues et adaptatifs : taux datés, codes fiscaux, simulation exacte, fiches produits/services, recherche et archivage, droits par rôle et audit.
- Migration de protection des prix et des types de comptes des articles et taxes; sauvegarder avant la mise à jour. Les anciennes données incompatibles doivent être corrigées explicitement.

## [0.2.0-alpha.2] - 2026-10-20

### Ajouté
- Choix de thème clair, sombre ou système, mémorisé par navigateur et appliqué dès le rendu serveur; contrastes des contacts et onglets corrigés.
- Parcours anglais et thèmes vérifiés sur ordinateur/téléphone; manifeste iOS localisé et guide anglais illustré.

### Documentation
- Guides alignés sur la préversion v0.2.0-alpha.1 : contacts intégrés, installation Proxmox épinglée et liens clients.

## [0.2.0-alpha.1] - 2026-10-20
### Modifié
- Suivi du développement transféré dans Notion; retrait du carnet et de ses liens du wiki, du README et de l’interface.
- Interface affinée selon les références visuelles : barre latérale sombre pleine hauteur, en-tête et onglets compacts sur ordinateur; navigation fixe en bas et résumés en cartes sur téléphone.
- Migration `deposit_needs_items` : un dépôt bancaire doit contenir au moins un paiement (un dépôt vide sortait son montant des fonds non déposés sans déposer de paiement).
- `restore.sh` crée les rôles PostgreSQL de l'application avant `pg_restore` (les rôles ne sont pas dans la sauvegarde), restaure en une transaction et recalcule les statistiques.

### Ajouté
- Client Windows EXE avec sélection du serveur HTTPS et mises à jour depuis les releases; publication des installateurs, métadonnées de mise à jour et sommes SHA-256.
- Installation iOS depuis Safari sur l’écran d’accueil : manifeste, icônes et affichage autonome, en ligne.
- Page Versions et agent serveur facultatif : demande réservée à l’administrateur, sauvegarde obligatoire, versions publiées et plus récentes uniquement; guides Windows, iOS et Proxmox.
- Navigation par activité avec pages d’accueil explicites, menu complet sur téléphone et barre latérale défilante.
- Contacts (phase 4.1) : clients/fournisseurs, recherche, pagination, fiches adaptatives, archivage/restauration, permissions et audit; guide et captures ordinateur/téléphone.
- Wiki enrichi : guide utilisateur, état des fonctionnalités, références visuelles ordinateur/mobile, procédure de publication et synchronisation des images.
- Refonte de l’espace comptable : navigation latérale sur ordinateur, navigation tactile horizontale, identité verte, cartes de soldes réels du grand livre, dernières écritures et accès rapides; reprise du mandat et découpage de la phase 4 dans la feuille de route.
- Web mobile : saisie des écritures en lignes adaptatives, contrôles tactiles agrandis, navigation et espacement adaptés aux téléphones; vérification du parcours comptable à largeur mobile.
- L'activation de la vérification en deux étapes demande le mot de passe du compte, comme sa désactivation : un témoin de session volé ne permet plus d'enrôler l'application d'un tiers.
- Moteur comptable (phase 3) : plan comptable (plan de départ canadien de 47 comptes, bilingue, comptes système), journal avec écritures manuelles et soldes d'ouverture (partie double vérifiée par l'application et par la base, numérotation sans trou, contre-passation), exercices et périodes mensuelles (verrouillage, fermeture, réouverture réservée au propriétaire avec 2FA, motif et audit), balance de vérification, consultation de la piste d'audit; écrans, messages français et anglais, pages du wiki ([[Plan-comptable]], [[Journal-et-ecritures]], [[Exercices-et-periodes]], [[Piste-d-audit]]). Rouvrir une période ou un exercice demande en plus un code de l'application d'authentification saisi à ce moment. Tests : propriétés (P1, P2, P3, P5, P7, P8, P11, P13), test à états, accord domaine/base, et les cas SQL de la phase 1 portés en Vitest. Nouvelle variable de test `ALLUMI_TEST_TEMPLATE`.
- Infrastructure Docker Compose (PostgreSQL, migrations, application, Caddy).
- Scripts : installation Ubuntu, sauvegarde chiffrée, restauration, mise à jour, publication du wiki.
- Wiki complet dans `docs/`, CONTRIBUTING, SECURITY.
- Prompt de développement Claude Code et conventions (`CLAUDE.md`).
- Environnement de développement cloud (`scripts/cloud-setup.sh`) et CI GitHub Actions.
- Versionnage SemVer : `scripts/release.sh`, workflow Release (release GitHub + image GHCR), version dans `/api/health`.
- Squelette de l'application (phase 2) : Next.js 16, TypeScript strict, Prisma 7, Tailwind 4; page `/setup` de premier démarrage (se désactive ensuite), connexion (argon2id, sessions à jeton haché, limitation de débit, verrouillage de compte), vérification en deux étapes TOTP avec codes de récupération, interface en français canadien et en anglais, `GET /api/health`.
- **Nouvelles variables d'environnement `APP_DB_PASSWORD` et `APP_DATABASE_URL`** : l'application se connecte avec un rôle PostgreSQL restreint (`allumi_app`) et ne reçoit plus les identifiants du propriétaire de la base. `install.sh` et `cloud-setup.sh` les génèrent; le service `migrate` configure le rôle à chaque démarrage.
- Tests : unitaires (dont propriétés), intégration sur une vraie base avec le rôle restreint, parcours Playwright; jobs `e2e` et `docker` de la CI, vérification de dérive Prisma.
- **Nouvelles variables facultatives `SETUP_TOKEN` et `TRUSTED_PROXY_HOPS`** : le jeton d'installation (généré par `install.sh`) empêche la première personne qui atteint l'adresse de créer l'administrateur; `TRUSTED_PROXY_HOPS` dit combien de proxys de confiance précèdent l'application, pour que la limitation de débit ne se fie pas à une adresse que le client peut forger.
- Revue d'exactitude de la phase 2 : le formulaire `/setup` conserve le mois d'exercice et la langue choisis après une erreur; le code de récupération se saisit au clavier d'un téléphone; les codes de récupération restent affichés si on change de langue; erreurs inattendues en message traduit plutôt qu'en page brute; contraste, focus, titres de page et en-tête étroit; sauvegardes qui conservent les propriétaires (la fonction de caviardage de la Loi 25 ne casse plus après une restauration); `update.sh vX.Y.Z`; `/setup` reste fermé en production sans `SETUP_TOKEN`.
- Revue de sécurité de la phase 2 : le verrouillage de compte repart à zéro quand il expire, une réponse identique pour un compte verrouillé et un compte inconnu, déconnexion qui efface bien le cookie `__Host-`, autres sessions fermées lors d'un changement de 2FA, purge des compteurs de limitation, clés distinctes pour les compteurs (`AUTH_SECRET`) et les codes de récupération (`ENCRYPTION_KEY`).
- Conception de la phase 1 (wiki) : architecture finale et découpage en modules, schéma de données complet (45 tables, contraintes, triggers de partie double, isolation par entreprise avec RLS liée à l'adhésion, rôles appliqués par la base), plan de tests du moteur comptable et liste des risques. Schéma révisé après une revue adversariale (sécurité, comptabilité, PostgreSQL, complétude).
