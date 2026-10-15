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
- PostgreSQL accessible seulement dans le réseau Docker interne.
- HTTPS automatique avec HSTS, en-têtes de sécurité (Caddy).
- Secrets uniquement dans `.env` (600).

## Données et vie privée (Loi 25 — Québec)
Une instance d'Allumi contient des renseignements personnels (clients, fournisseurs, employés). Si tu l'exploites pour une organisation ou pour d'autres, tu es responsable de leur protection. Points à considérer :
- **Responsable de la protection des renseignements personnels** désigné (par défaut la personne à la direction).
- **Hébergement** : privilégier une région canadienne; si les données sortent du Québec, une évaluation des facteurs relatifs à la vie privée est requise.
- **Sauvegardes** : chiffrées et hors site dans une juridiction acceptable.
- **Incidents de confidentialité** : tenir un registre et aviser la Commission d'accès à l'information et les personnes touchées en cas de risque de préjudice sérieux.
- **Conservation** : les pièces comptables ont des durées de conservation légales (consulte Revenu Québec et l'ARC).
- **Politique de confidentialité** publiée si tu collectes des renseignements auprès du public.

## Comptes et accès
- Active la 2FA pour tous les comptes propriétaire et comptable.
- Principe du moindre privilège : rôle « lecture seule » pour les observateurs.
- Retire immédiatement les accès des personnes qui partent.

## Signaler une faille
Voir `SECURITY.md` : ne publie pas de faille dans une issue publique.
