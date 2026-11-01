# Envoi des factures par courriel

Depuis une **facture client validée et non annulée**, le panneau **Envoi par courriel** permet un envoi manuel. L’accès en écriture au module Ventes est nécessaire; l’accès en lecture permet de consulter l’historique. Aucun courriel n’est envoyé lors de la validation comptable seule.

## Envoyer

1. Ouvre la facture validée, puis **Envoyer la facture**.
2. Vérifie l’adresse proposée, issue des coordonnées figées du client. Tu peux saisir une autre adresse unique; les listes de destinataires ne sont pas acceptées.
3. Choisis Français (Canada) ou Anglais pour le courriel.
4. Confirme le destinataire, puis **Confirmer et envoyer**.
5. Consulte le résultat dans le panneau. L’acceptation SMTP ne prouve ni la livraison ni la lecture du message.

Le courriel contient la facture complète en texte et HTML : numéro, émetteur et client figés à la validation, dates, référence, lignes, taxes, total en CAD et note. Il affiche le montant d’origine, pas un relevé du solde courant. Aucun lien vers une page privée, lien de paiement, PDF ou justificatif téléversé n’est joint. L’impression/enregistrement PDF dans le navigateur reste disponible depuis la facture.

## Résultats et nouvel envoi

- **Accepté par le serveur SMTP** : le relais a accepté le message; vérifier les rebonds ou pourriels auprès du fournisseur SMTP.
- **Refusé** : le relais a explicitement rejeté l’envoi.
- **Résultat incertain** : une coupure peut survenir après acceptation du message. Vérifie auprès du destinataire avant de réessayer.
- **Tentative enregistrée — résultat non confirmé** : le traitement peut être en cours, ou le processus a été interrompu avant l’enregistrement du résultat.

Aucun renvoi automatique. La répétition d’une même soumission réutilise la tentative, sans rappeler SMTP. Pour un nouvel envoi, ouvre **Envoyer de nouveau** et confirme le risque de doublon. Attends au moins une minute entre tentatives, cinq minutes lorsqu’une tentative récente n’a pas de résultat. Maximum : 20 tentatives par facture sur 24 heures. Les 20 dernières sont affichées; l’historique reste en base avec son auteur, sa date et la langue.

Une nouvelle adresse saisie ici ne modifie pas le contact ni la facture. L’historique contient des renseignements personnels (adresse du destinataire); il est protégé par entreprise et module Ventes et inclus aux sauvegardes de base. Il n’est pas purgé automatiquement. Aucun contenu de courriel ni mot de passe SMTP n’est enregistré dans cette table.

## Configuration du serveur

L’administrateur de l’instance définit les variables dans `.env`, puis recrée l’application. Ne pas copier les secrets dans Git, le wiki ou une capture.

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USER=compte-smtp
SMTP_PASSWORD=secret-du-fournisseur
SMTP_FROM=Votre entreprise <factures@example.com>
```

- `starttls` exige une montée TLS réussie (587 habituellement); aucun repli en clair.
- `tls` utilise TLS dès la connexion (465 habituellement).
- `plain` est réservé à un relais local de test ou un réseau de confiance; le message et l’authentification ne sont pas chiffrés par SMTP.
- Identifiant et mot de passe doivent être définis ensemble; ils peuvent rester vides pour un relais local sans authentification.
- Les certificats TLS restent vérifiés. Configure SPF, DKIM et DMARC avec ton fournisseur.
- Le conteneur doit pouvoir joindre le relais sur le port choisi. Un relais exécuté sur l’hôte n’est pas accessible via `localhost` depuis le conteneur : utilise son adresse réseau.

Depuis le dépôt installé, après modification de `.env` :

```bash
sudo ./scripts/up.sh
```

La connexion et la réponse sont bornées dans le temps; aucun fichier ni URL externe n’est chargé par le transport. Une configuration absente ou invalide masque le formulaire et affiche une indication aux personnes autorisées à envoyer.

Voir [[Configuration]], [[Validation-des-factures]], [[Justificatifs]] et [[Depannage]].

## Captures

![Courriel de facture — ordinateur](https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/courriel-facture-desktop.png)

<img src="https://raw.githubusercontent.com/wiki/Installation-04/Allumi/images/courriel-facture-mobile.png" alt="Courriel de facture — téléphone" width="412">
