.PHONY: help dev-up dev-down up down logs backup update wiki

help: ## Affiche l'aide
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

dev-up: ## Démarre PostgreSQL + Mailpit (dev)
	docker compose -f docker-compose.dev.yml up -d

dev-down: ## Arrête les services de dev
	docker compose -f docker-compose.dev.yml down

up: ## Démarre la pile de production
	docker compose up -d --build

down: ## Arrête la pile de production
	docker compose down

logs: ## Suit les logs de l'application
	docker compose logs -f app

backup: ## Sauvegarde maintenant
	./scripts/backup.sh

update: ## Met à jour Allumi
	./scripts/update.sh

wiki: ## Publie docs/ sur le wiki GitHub
	./scripts/sync-wiki.sh
