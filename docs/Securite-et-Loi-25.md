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
- **Politique CSP stricte par nonce** sur les pages : chaque réponse reçoit un nonce neuf (128 bits aléatoires), et les scripts comme les styles ne s’exécutent qu’avec ce nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`). Aucun `unsafe-inline` ni `unsafe-eval` pour les scripts en production : un HTML injecté (script inline, gestionnaire `onerror=`…) est bloqué par le navigateur. S’y ajoutent `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'` et `img-src 'self' data: blob:` (le code QR de la 2FA est une image `data:`). Pas de `upgrade-insecure-requests` : Allumi est servi en HTTP direct par conception, et cette directive casserait la page. Les fichiers statiques (images, icônes) gardent la politique ciblée `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`.
- Limites de cette politique : `'strict-dynamic'` fait confiance aux scripts déjà autorisés, donc elle ne bloque pas une injection faite *par* un script de confiance; `style-src-attr 'unsafe-inline'` reste nécessaire pour l’unique attribut `style` de la page d’erreur globale; elle ne remplace ni l’échappement des données ni les revues de dépendances. Le client Windows charge les mêmes pages et applique la même politique. En développement (`npm run dev`), `unsafe-eval` et les WebSockets sont autorisés pour le rechargement à chaud. Le parcours navigateur échoue à la moindre ressource bloquée par la politique.
- Le compte affiche ses appareils connectés et permet de les déconnecter; le changement de mot de passe exige l’actuel et déconnecte les autres appareils ([[Authentification]]).
- La connexion en attente de 2FA expire après dix minutes; consommation du code et autorisation de session sont atomiques. Les changements du facteur sont sérialisés ([[Authentification]]).
- Secrets uniquement dans `.env` (600).

## Données et vie privée (Loi 25 — Québec)
Une instance d'Allumi contient des renseignements personnels (clients, fournisseurs, employés). Si tu l'exploites pour une organisation ou pour d'autres, tu es responsable de leur protection. Points à considérer :
- **Responsable de la protection des renseignements personnels** désigné (par défaut la personne à la direction).
- **Hébergement** : privilégier une région canadienne; si les données sortent du Québec, une évaluation des facteurs relatifs à la vie privée est requise.
- **Sauvegardes** : chiffrées et hors site dans une juridiction acceptable.
- **Piste d'audit et droit à l'effacement** : la piste d'audit est en ajout seulement, mais le propriétaire peut en caviarder les renseignements personnels d'un contact anonymisé (fonction `audit_redact`, elle-même journalisée); les champs comptables ne sont jamais touchés.
- **Intégrations (Stripe, PayPal)** : les clés d'API sont chiffrées, lisibles du propriétaire seulement, et jamais copiées dans l'audit ni les journaux. Seules les données de transaction sont importées : aucun nom, courriel ni adresse de client (PayPal n'est interrogé que pour `transaction_info`); la description fournie par le service est conservée telle quelle. Pour une page de paiement Stripe, seuls le montant du solde, la devise, le libellé « Facture F-… » et l'identifiant interne du lien sont envoyés : jamais le nom ou les coordonnées du client. Le paiement en ligne ne demande aucune adresse publique ni webhook. Voir [[Integrations]]. **Relevés bancaires** ([[Import-de-releves]]) : le fichier n'est pas conservé (nom, empreinte SHA-256, format et nombre de lignes seulement); les lignes gardent les noms de bénéficiaires et les descriptions écrits par la banque, sous l'isolation par entreprise, nettoyés et bornés. **Appariement** ([[Appariement-bancaire]]) : réservé aux propriétaires et aux comptables (droit de gérer la banque, et de passer des écritures pour en créer une); chaque appariement et chaque écriture est consigné dans la piste d'audit.
- **Incidents de confidentialité** : tenir un registre et aviser la Commission d'accès à l'information et les personnes touchées en cas de risque de préjudice sérieux.
- **Conservation** : les pièces comptables ont des durées de conservation légales (consulte Revenu Québec et l'ARC).
- **Politique de confidentialité** publiée si tu collectes des renseignements auprès du public.

## Comptes et accès
- Active la 2FA pour tous les comptes propriétaire et comptable ([[Authentification]]).
- Principe du moindre privilège : rôle « lecture seule » pour les observateurs.
- Retire immédiatement les accès des personnes qui partent.

## Signaler une faille
Voir `SECURITY.md` : ne publie pas de faille dans une issue publique.
