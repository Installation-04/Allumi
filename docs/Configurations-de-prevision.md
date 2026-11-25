# Configurations de prévision enregistrées

Dans **Trésorerie → Prévision de trésorerie**, ouvre **Configurations enregistrées**. Ces configurations partagées permettent de retrouver un horizon et deux délais sans les ressaisir. Elles appartiennent à l’entreprise active.

## Créer et réutiliser

1. Donne un **nom de 1 à 80 caractères**, sans caractère de contrôle ni saut de ligne. Les espaces extérieurs sont retirés; le nom doit être unique dans l’entreprise, avec distinction des majuscules/minuscules.
2. Choisis un horizon de **7, 30, 60 ou 90 jours** et des délais additionnels clients/fournisseurs de **0, 7, 14 ou 30 jours calendaires**.
3. Clique **Enregistrer la configuration**. En cas de refus, les valeurs saisies sont conservées.
4. Clique **Appliquer « nom »** pour ouvrir la prévision. La **date de référence affichée** sur la page des configurations est conservée; elle n’est pas stockée dans la configuration. Un accès direct sans date utilise la date du jour.

La projection est recalculée depuis les données comptables actuelles à la référence choisie. La configuration ne fige **aucun montant, solde ou résultat** et ne constitue pas un instantané historique. Les filtres appliqués sont visibles dans le rapport et conservés dans le CSV et l’impression/PDF. Le nom de la configuration n’est pas ajouté à ces exports.

Les règles de décalage, exclusions et rapprochements restent celles de [[Previsions-de-tresorerie]]. Les échéances contractuelles, écritures et affectations ne changent pas; aucun paiement n’est programmé.

## Droits, limites et suppression

La consultation et l’application demandent **Comptabilité en lecture + Ventes en lecture**, sans accès Contacts/Taxes nécessaire. La création et la suppression exigent **Comptabilité en écriture + Ventes en lecture**. Le rôle lecture seule reste limité à la consultation, même si une surcharge demande l’écriture. Les permissions sont revérifiées côté serveur à chaque action.

Chaque entreprise peut conserver **20 configurations**. Le plafond est aussi vérifié en base lors d’insertions concurrentes; une écriture refusée est entièrement annulée avec son audit. Les noms sont uniques uniquement dans l’entreprise concernée.

Les réglages enregistrés sont **immuables**. Pour les remplacer, ouvre **Supprimer « nom »**, confirme la suppression pour tous les membres de l’entreprise, puis crée la nouvelle configuration. Une seconde demande de suppression d’une configuration déjà retirée est signalée comme introuvable. La création et la suppression sont auditées; les mouvements financiers ne sont pas modifiés.

Ce sont des réglages réutilisables de délai et d’horizon. Les scénarios avec nouveaux montants manuels, échéanciers de paiement et automatisations restent hors de ce parcours.

## Références visuelles

![Configurations partagées et création en français](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/configurations-prevision-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/configurations-prevision-mobile.png" alt="Configuration enregistrée et application sur mobile" width="412">

![Saved forecast configurations in English dark theme](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/configurations-prevision-en-dark-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/configurations-prevision-en-dark-mobile.png" alt="Saved configurations on mobile, dark theme" width="412">
