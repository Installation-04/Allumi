.PHONY: release help dev-up dev-down up down logs backup update wiki test e2e db-migrate

help: ## Affiche l'aide
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

dev-up: ## Démarre PostgreSQL + Mailpit (dev)
	docker compose -f docker-compose.dev.yml up -d

dev-down: ## Arrête les services de dev
	docker compose -f docker-compose.dev.yml down

up: ## Démarre la pile de production (images publiées de la version, sinon construites)
	./scripts/up.sh

down: ## Arrête la pile de production
	docker compose down

logs: ## Suit les logs de l'application
	docker compose logs -f app

test: ## Lint, types, tests unitaires et d'intégration
	npm run lint && npm run typecheck && npm test

e2e: ## Parcours navigateur (lance « npm run build » avant)
	npm run test:e2e

db-migrate: ## Applique les migrations et configure le rôle de l'application
	npm run db:migrate

release: ## Prépare une version (make release V=0.1.0)
	./scripts/release.sh $(V)

backup: ## Sauvegarde maintenant
	./scripts/backup.sh

update: ## Met à jour Allumi
	./scripts/update.sh

wiki: ## Publie docs/ sur le wiki GitHub
	./scripts/sync-wiki.sh
