# Politique de sécurité

## Signaler une vulnérabilité
**Ne crée pas d'issue publique.** Utilise le signalement privé de GitHub (onglet *Security* → *Report a vulnerability*) ou écris à l'adresse indiquée dans le profil du mainteneur.

Inclus : description, étapes de reproduction, version, impact. Nous accusons réception sous 7 jours et visons un correctif rapide, avec divulgation coordonnée.

## Versions supportées
Pendant la pré-alpha, seule la branche `main` reçoit des correctifs.

## Portée
Sont visées : failles d'authentification, d'isolation entre entreprises, d'injection, de fuite de données, de configuration Docker par défaut. Ne sont pas visées : attaques nécessitant un accès root au serveur, déni de service volumétrique, ingénierie sociale.

## Bonnes pratiques pour les exploitants
Voir [Sécurité et Loi 25](docs/Securite-et-Loi-25.md).
