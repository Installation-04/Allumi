# Codex instructions — Allumi

Read `CLAUDE.md` before making changes. It is the shared source of truth for project conventions, security, accounting invariants, infrastructure, and review requirements. Follow it even when working with Codex.

## Cloud setup
- Run `./scripts/cloud-setup.sh` in the Codex environment setup phase.
- This provisions a disposable local PostgreSQL instance, development-only credentials, npm dependencies, Prisma client and migrations.
- Do not run Docker inside the cloud session; GitHub Actions validates Docker builds.
- Never use real customer/accounting data or production credentials in this environment.

## Checks
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build` when relevant
- Check GitHub Actions, especially Docker and e2e jobs, before merging.

## Collaboration with Claude Code
- Create work on dedicated `codex/*` branches. Never commit directly to `main`.
- Check recent changes before editing and avoid touching Claude's active branch.
- Open a pull request for review; do not automatically merge.
- Follow the Conventional Commits convention.
- Update `CHANGELOG.md` under [Non publié] and relevant French documentation for code changes.
- Preserve all accounting and tenant-isolation invariants defined in `CLAUDE.md`.
