# Authentification

## Connexion
- Courriel et mot de passe. Les mots de passe sont hachés avec **argon2id** (paramètres recommandés par l'OWASP) et ne sont jamais journalisés.
- Une adresse inconnue, un mauvais mot de passe et un compte verrouillé donnent la **même réponse** (« Courriel ou mot de passe incorrect, ou compte temporairement verrouillé »), et prennent à peu près le même temps (l'écart résiduel est de quelques millisecondes, et le nombre d'essais par courriel est limité) : deviner quels comptes existent est impraticable.
- **Limitation de débit** (dans PostgreSQL, sans service externe) : 8 essais par courriel et 30 par adresse IP en 15 minutes. Les clés sont des empreintes chiffrées : ni les adresses IP ni les courriels ne sont conservés.
- **Verrouillage** du compte pendant 15 minutes après 10 échecs de suite. Quand le verrou expire, le compteur repart à zéro. Compromis assumé : quelqu'un qui connaît ton courriel peut te faire attendre quelques minutes, mais personne ne peut deviner ton mot de passe en continu, d'où qu'il vienne.
- Chaque échec est inscrit à la piste d'audit et visible par la personne visée.

## Sessions
- Cookie `httpOnly`, `SameSite=Lax`, et `Secure` en HTTPS. En production (HTTPS), il porte le préfixe `__Host-` : il n'est valable que pour ton domaine exact.
- La base ne conserve que l'**empreinte SHA-256** du jeton : une fuite de la base ne permet pas de voler des sessions.
- Fermeture après **8 heures d'inactivité** ou **14 jours** au total.
- À la connexion depuis un navigateur qui n'a encore aucune langue choisie (nouvel appareil), la **langue enregistrée dans ton compte** est appliquée. Une langue choisie dans ce navigateur n'est jamais écrasée.
- « Se déconnecter » supprime la session côté serveur et efface le cookie.
- Activer ou désactiver la 2FA **déconnecte tous les autres appareils**, et une session vérifiée avant la désactivation ne saute pas la deuxième étape si tu réactives la 2FA.

## Vérification en deux étapes (TOTP)
Compatible avec toute application d'authentification (Aegis, Google Authenticator, 1Password, etc.).
1. **Sécurité du compte → Activer la 2FA**.
2. Scanne le code QR (ou saisis la clé), puis entre le code à 6 chiffres pour confirmer.
3. Les **10 codes de récupération** s'affichent **une seule fois** : conserve-les en lieu sûr. Chacun ne sert qu'une fois.

Détails de sécurité :
- Le secret est **chiffré** (AES-256-GCM) avec `ENCRYPTION_KEY` : voir [[Configuration]]. Perdre cette clé rend les secrets illisibles.
- Un code déjà accepté **ne peut pas être rejoué** (RFC 6238, §5.2).
- Les tentatives de code sont limitées (8 par 15 minutes).
- Pour **désactiver** la 2FA, il faut le mot de passe et un code actuel.
- Tant que la deuxième étape n'est pas faite, la session ne donne accès qu'à la page de vérification.

## Ce qui n'est pas encore là
Réinitialisation du mot de passe par courriel, invitations de membres et changement de mot de passe arrivent avec les modules suivants (voir [[Feuille-de-route]]). Si tu perds ton mot de passe et tes codes de récupération, un administrateur de l'instance doit intervenir directement dans la base.

## Rôles
Les droits sont appliqués **par la base de données**, pas seulement par l'interface :

| | Propriétaire | Comptable | Lecture seule |
|---|:-:|:-:|:-:|
| Consulter les données | ✓ | ✓ | ✓ |
| Saisir et valider | ✓ | ✓ | — |
| Gérer les membres et l'entreprise | ✓ | — | — |
| Consulter la piste d'audit | ✓ | ✓ | — |

Voir aussi [[Architecture]] et [[Securite-et-Loi-25]].
