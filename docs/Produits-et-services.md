# Produits et services

Un **produit ou service** est une ligne que l'on met souvent sur une facture ou une dépense : on y garde un prix, des comptes et un code de taxe par défaut. Écran : **Produits et services** (`/c/<entreprise>/produits`).

## Un produit ou service
- **Code** (facultatif, unique dans l'entreprise), **nom** (obligatoire), **description**.
- **Prix unitaire** (facultatif) : jusqu'à **six décimales**, négatif pour un rabais. Il s'écrit dans la langue de l'écran (`85,5` ou `85.50`). Le montant d'une ligne de document sera `quantité × prix`, arrondi au cent demi s'éloignant de zéro (quantités à quatre décimales).
- **Compte de revenus** : un compte de produits actif, pour les ventes.
- **Compte de dépenses** : un compte de charges actif, pour les achats.
- **Code de taxe par défaut** ([[Taxes]]).

Les comptes de clients, de fournisseurs et de taxes ne sont pas des comptes de produit : les écritures de documents s'en occupent d'elles-mêmes ([[Regles-comptables]]).

## Désactiver, supprimer
Désactiver retire le produit des listes de choix; supprimer n'est possible que s'il n'est utilisé sur aucune ligne de document.

## Qui peut faire quoi
Le propriétaire et le comptable gèrent les produits; le membre en lecture seule les consulte.

Voir aussi : [[Contacts]], [[Plan-comptable]].
