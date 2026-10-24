# Sécurité et Loi 25

> Cette page est une aide technique, pas un avis juridique. Consulte un professionnel pour ta situation.

## Durcissement du serveur
- Connexion SSH par clé uniquement (`PasswordAuthentication no`), pas de connexion root directe.
- Pare-feu : seulement SSH, 80, 443 (`install.sh` configure ufw).
- Mises à jour de sécurité automatiques (`unattended-upgrades`).
- `fail2ban` recommandé pour SSH.
- Surveillance : un moniteur externe sur `/api/health`.

## Durcissement fourni par la pile
- Conteneur applicatif non-root, système de fichiers en lecture seule, toutes les capacités Linux retirées, `no-new-privileges`.
- L'application se connecte à PostgreSQL avec un **rôle restreint** (sans droit de contourner la sécurité par ligne) et ne reçoit jamais les identifiants du propriétaire de la base. L'isolation entre entreprises, les rôles et l'immuabilité du journal sont appliqués par la base elle-même ([[Architecture]]).
- Sessions à jeton opaque (seule l'empreinte est stockée), mots de passe argon2id, limitation de débit et verrouillage de compte.
- PostgreSQL accessible seulement dans le réseau Docker interne.
- HTTP direct sur réseau privé, HTTPS/HSTS à configurer sur un proxy externe pour un accès sécurisé. Aucun certificat intégré. L’application sert ses en-têtes de sécurité même sans proxy : `nosniff`, refus des iframes, `Referer` limité à l’origine pour les liens HTTPS vers un autre site (pas de chemin ni de paramètres), caméra/microphone/géolocalisation désactivés.
- Politique CSP ciblée : `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`. Elle interdit l’intégration dans un autre site, les objets embarqués et les formulaires vers une autre origine. Elle ne constitue pas encore une politique stricte de scripts par nonce et ne garantit pas l’absence de XSS.
- La connexion en attente de 2FA expire après dix minutes; consommation du code et autorisation de session sont atomiques. Les changements du facteur sont sérialisés ([[Authentification]]).
- Secrets uniquement dans `.env` (600).

## Données et vie privée (Loi 25 — Québec)
Une instance d'Allumi contient des renseignements personnels (clients, fournisseurs, employés). Si tu l'exploites pour une organisation ou pour d'autres, tu es responsable de leur protection. Points à considérer :
- **Responsable de la protection des renseignements personnels** désigné (par défaut la personne à la direction).
- **Hébergement** : privilégier une région canadienne; si les données sortent du Québec, une évaluation des facteurs relatifs à la vie privée est requise.
- **Sauvegardes** : chiffrées et hors site dans une juridiction acceptable.
- **Piste d'audit et droit à l'effacement** : la piste d'audit est en ajout seulement, mais le propriétaire peut en caviarder les renseignements personnels d'un contact anonymisé (fonction `audit_redact`, elle-même journalisée); les champs comptables ne sont jamais touchés.
- **Incidents de confidentialité** : tenir un registre et aviser la Commission d'accès à l'information et les personnes touchées en cas de risque de préjudice sérieux.
- **Conservation** : les pièces comptables ont des durées de conservation légales (consulte Revenu Québec et l'ARC).
- **Politique de confidentialité** publiée si tu collectes des renseignements auprès du public.

## Comptes et accès
- Active la 2FA pour tous les comptes propriétaire et comptable ([[Authentification]]).
- Principe du moindre privilège : rôle « lecture seule » pour les observateurs.
- Retire immédiatement les accès des personnes qui partent.

## Signaler une faille
Voir `SECURITY.md` : ne publie pas de faille dans une issue publique.
