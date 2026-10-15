# Architecture

> Document vivant. La phase 1 du développement le complète (schéma, modules, risques).

## Vue d'ensemble
```
Internet ─▶ Caddy (80/443, HTTPS auto)
              └─▶ app (Next.js standalone, :3000)
                     └─▶ db (PostgreSQL 17)
Volumes : db_data · app_storage (pièces jointes) · caddy_data (certificats)
```

## Stack
- TypeScript strict, Next.js (App Router, `output: "standalone"`)
- PostgreSQL 17, Prisma (migrations versionnées)
- Zod (validation, dont l'environnement au démarrage)
- Tailwind; interface bilingue fr-CA / en
- Tests : Vitest (moteur comptable, tests de propriétés), Playwright (parcours clés)
- Logs JSON (pino) sur stdout

## Services Docker
| Service | Rôle |
|---|---|
| `db` | PostgreSQL, volume persistant, jamais exposé publiquement |
| `migrate` | Exécute `prisma migrate deploy` puis s'arrête |
| `app` | Application, non-root, système de fichiers en lecture seule |
| `caddy` | Proxy inverse, HTTPS automatique, en-têtes de sécurité |

## Contrat d'infrastructure
Ce que l'application garantit à l'infrastructure :
- `GET /api/health` → 200 `{"status":"ok"}` si la base répond
- Configuration par variables d'environnement validées au démarrage
- Migrations appliquées par `migrate`, jamais par l'app
- Écritures disque seulement dans `/tmp`, `/app/.next/cache`, `/app/storage`
- Aucun appel Internet obligatoire au démarrage
- Page `/setup` au premier démarrage, désactivée ensuite

## Modules prévus
Plan comptable · Journal · Contacts · Factures · Paiements · Dépenses · Banque · Taxes · Rapports · Exports · Utilisateurs/rôles · Audit

## Multi-entreprise
Chaque donnée comptable porte un `company_id`. Isolation appliquée dans la couche d'accès aux données et, idéalement, par Row Level Security PostgreSQL.

Voir aussi [[Regles-comptables]].
