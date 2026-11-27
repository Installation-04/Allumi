# Carnet de temps partagé

Ouvre **Projets → Carnet de temps**, puis **Nouvelle saisie de temps**. Le carnet est partagé dans l’entreprise : les personnes autorisées voient les mêmes saisies. Les droits **Comptabilité** pilotent l’accès : lecture pour consulter/exporter, écriture pour créer, modifier ou supprimer. Un rôle lecture seule reste plafonné même si une surcharge demande l’écriture.

## Enregistrer les heures

Renseigne la date du travail, le **Projet ou dossier**, l’**Intervenant déclaré**, l’activité, une note interne facultative et le caractère **Facturable** ou **Non facturable**. Les noms de projet et d’intervenant sont des libellés libres; ils ne créent pas de registre de projets, salariés ou clients.

La durée accepte **h:mm** ou des minutes entières : `1:30` et `90` représentent exactement 90 minutes. Les heures décimales comme `1,5` ou `1.5` sont refusées. Chaque saisie est limitée à **1 minute à 24:00**. La date ne peut pas dépasser aujourd’hui à Toronto. Les calculs utilisent des minutes entières, sans arrondi monétaire.

Les libellés projet/intervenant/activité sont limités à 120/80/200 caractères; la note est facultative et limitée à 200 caractères. Les caractères de contrôle sont refusés. Après une erreur, les champs restent renseignés.

## Filtrer et exporter

Choisis une plage inclusive de 366 jours maximum, un libellé de projet et/ou le type de facturation. La recherche projet ignore la casse et traite les caractères `%`, `_` et `\` littéralement. Les totaux facturable/non facturable portent sur **tout le filtre**, même lorsque la liste dépasse une page. L’écran affiche les durées en h:mm et 50 lignes par page.

**Exporter le CSV complet** reprend toutes les lignes filtrées, jusqu’à 5 000. Le CSV UTF-8 est privé, dans la langue de l’interface, avec **durées et totaux en minutes entières**. Les libellés et notes internes y figurent : conserve le fichier de façon appropriée. L’export est bloqué au-delà du plafond; réduis alors les filtres.

## Modifier ou supprimer

La fiche permet la modification ou une suppression avec confirmation explicite. Les créations, modifications et suppressions sont auditées. Une révision empêche d’écraser la modification d’un collègue : recharge une fiche périmée avant de réessayer. La note saisie reste disponible après refus. La suppression conserve la piste d’audit et ne touche pas aux écritures comptables.

## Limites

Le carnet ne crée ni facture, paiement, salaire ou écriture. Aucun tarif ni valorisation financière n’est calculé. Il ne comporte pas de chronomètre, d’heures de début/fin, de contrôle de chevauchement ou de total quotidien par personne, de validation des heures ou de registre de projets. Plusieurs saisies peuvent donc représenter plus de 24 heures pour un même libellé de personne; ce carnet est déclaratif. Facturation, paie, coûts et rentabilité de projets restent des fonctionnalités distinctes.

## Références visuelles

![Carnet de temps partagé](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/carnet-temps-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/carnet-temps-mobile.png" alt="Carnet de temps sur téléphone" width="412">

![Time log in English and dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/carnet-temps-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/carnet-temps-en-dark-mobile.png" alt="Time log on mobile in English" width="412">

Toutes les captures utilisent des données fictives. Voir aussi [[Utilisateurs-et-permissions]] et [[Piste-d-audit]].

[[Impression-du-temps]] : copie filtrée complète jusqu’à 1 000 saisies, toutes pages et notes internes incluses, durées exactes, papier paysage clair et PDF navigateur. Les données sont relues à l’ouverture, sous Comptabilité lecture.
