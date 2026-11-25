# Carnet de kilométrage partagé

Dans **Kilométrage → Carnet de kilométrage**, consigne les trajets professionnels et personnels de l’entreprise. La distance est **saisie manuellement**; l’application ne suit pas ta position et ne calcule pas d’itinéraire. Ce carnet est indépendant des exercices comptables.

## Créer un trajet

1. Ouvre **Nouveau trajet** et indique une date passée ou aujourd’hui, un véhicule, le départ et l’arrivée.
2. Choisis **Professionnel** ou **Personnel**. Un motif est obligatoire pour un trajet professionnel et facultatif pour un trajet personnel.
3. Saisis une distance positive entre **0,001 et 10 000 km**, avec au plus trois décimales et sans séparateur de milliers. En français, la virgule ou le point sont acceptés; en anglais, utilise le point. Les valeurs ne sont pas arrondies pour être acceptées.
4. Clique **Enregistrer le trajet**. Le détail s’ouvre; les champs restent saisis si l’enregistrement est refusé.

Les textes tiennent sur une ligne, sans caractère de contrôle : véhicule jusqu’à 80 caractères, départ/arrivée jusqu’à 160 chacun, motif jusqu’à 200. Les espaces extérieurs sont retirés. Le véhicule est un libellé libre : utilise le même identifiant pour retrouver ses trajets facilement.

La distance est conservée en **mètres entiers** puis affichée/exportée en kilomètres avec trois décimales. Exemple : 12,345 km correspond à 12 345 mètres; un trajet de 0,001 km reste distinct de zéro. Aucun mouvement comptable, paiement, taux d’indemnité ou déduction fiscale n’est calculé à partir de ces données.

## Rechercher et exporter

Choisis **Du / Au**, un texte de véhicule et un usage. Les deux dates sont inclusives; la période peut couvrir au plus **366 jours** et se terminer au plus tard aujourd’hui. Par défaut, le carnet affiche le début de l’année civile jusqu’à aujourd’hui. La recherche de véhicule est littérale, sans distinction des majuscules/minuscules : `%` et `_` ne deviennent pas des jokers.

Les totaux professionnels, personnels et globaux portent sur **tous les résultats filtrés**, même au-delà de la page de 50 trajets. Les liens de pagination conservent les filtres. Les résultats et totaux proviennent du même instantané de lecture; une nouvelle ouverture peut intégrer les changements d’un autre membre.

**Exporter le CSV complet** reprend les mêmes filtres et toutes les lignes, jusqu’à **5 000 trajets**. Réduis la période, le véhicule ou l’usage si ce plafond est dépassé; aucun export partiel n’est fourni. Le téléchargement relit les données et comprend dates, véhicule, usage, départ, arrivée, motif et kilomètres, puis nombres et totaux. Le fichier UTF-8 possède un BOM; format français avec point-virgule/virgule décimale, format anglais avec virgule/point décimal. Les textes commençant comme une formule de tableur sont neutralisés.

La recherche globale retrouve la page du carnet par « kilométrage », « mileage » ou « trajets » pour les membres autorisés. Elle ne recherche pas le contenu des trajets; les filtres du carnet servent à consulter les enregistrements.

## Imprimer ou enregistrer en PDF

**Impression / PDF complet** ouvre une copie dédiée de tous les résultats filtrés, jusqu’à 1 000 trajets, avec les mêmes totaux et droits. Le papier est paysage clair depuis les deux thèmes; le retour conserve la page et les filtres. Voir [[Impression-du-kilometrage]].

## Modifier, supprimer et partager

**Voir le trajet** ouvre son détail. Un membre autorisé peut ouvrir **Modifier le trajet** puis enregistrer les changements. Si une autre personne a modifié la fiche depuis son ouverture, le remplacement est refusé et ta saisie est conservée : recharge le trajet avant de réessayer. La suppression demande une confirmation et refuse aussi une fiche devenue périmée.

**Voir les trajets de cette année** affiche l’année civile de la fiche, jusqu’à aujourd’hui pour l’année courante. Après suppression, le carnet revient à cette même année.

Le carnet est **partagé dans l’entreprise**. Les membres ayant **Comptabilité en lecture** peuvent consulter et exporter tous les trajets, y compris personnels. La création, la modification et la suppression exigent **Comptabilité en écriture**. Le rôle lecture seule reste plafonné à la lecture, même avec une surcharge demandant l’écriture. Aucun accès Contacts, Ventes ou Taxes n’est nécessaire. Voir [[Utilisateurs-et-permissions]].

Les permissions et l’appartenance sont revérifiées côté serveur et en base. Les réponses/CSV sont privés et sans cache. Toutes les créations, modifications et suppressions sont auditées; supprimer une fiche ne retire pas son historique d’audit.

## Références visuelles

![Carnet partagé en français](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-mobile.png" alt="Totaux et trajets sur téléphone" width="412">

![Mileage log in English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/kilometrage-en-dark-mobile.png" alt="Mileage log totals and trips on mobile, dark theme" width="412">
