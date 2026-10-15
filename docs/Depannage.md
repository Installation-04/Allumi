# Dépannage

## Commandes de base
```bash
docker compose ps                  # état des services
docker compose logs --tail=100 app # logs de l'application
docker compose logs caddy          # certificat / proxy
docker compose logs migrate        # migrations
```

## Le site ne s'ouvre pas / erreur de certificat
- DNS : `dig +short ton-domaine` doit retourner l'IP du serveur.
- Ports 80 et 443 ouverts (pare-feu du serveur **et** du fournisseur infonuagique).
- `docker compose logs caddy` : les limites de Let's Encrypt (trop d'essais) se règlent en attendant.

## « POSTGRES_PASSWORD manquant »
`.env` est absent ou incomplet. Relance `install.sh` ou compare avec `.env.example`.

## Le service `app` redémarre ou est « unhealthy »
- `docker compose logs app` : variable manquante (la validation Zod nomme laquelle).
- Mot de passe dans `DATABASE_URL` différent de `POSTGRES_PASSWORD`.
- Le mot de passe PostgreSQL n'est utilisé qu'à la **création** du volume. Si tu le changes après coup : `ALTER USER allumi PASSWORD '...'` dans `psql`, ou recrée le volume (perte de données — sauvegarde d'abord).

## `migrate` échoue
Lis `docker compose logs migrate`. N'efface jamais une base de production pour « régler » une migration : restaure plutôt la dernière sauvegarde ([[Sauvegardes]]) et ouvre une issue.

## Plus d'espace disque
```bash
df -h && docker system df
docker image prune -f
```
Réduis `BACKUP_RETENTION_DAYS` ou déplace les sauvegardes hors site.

## Les courriels n'arrivent pas
Vérifie les variables `SMTP_*`, puis SPF, DKIM et DMARC de ton domaine.

## Demander de l'aide
Ouvre une issue avec : version d'Allumi, système, extraits de logs **sans secrets**.
