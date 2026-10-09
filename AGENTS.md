# DukaPay: guide for AI coding tools

Agent-banking and lending protocol on Stellar/Soroban. Testnet only; no audit yet.

## Layout

- `contracts/`: Soroban contracts (Rust). Hold funds.
- `backend/`: Express + TypeScript + Postgres. Migrations in `backend/migrations/`.
- `frontend/`: Next.js app. `sdk/`: TypeScript SDK. `indexer/`: Rust indexer.
- `money-policy.json`: single source of money rules; generated files derive from it.

## Rules everywhere

- Branch `feat/`, `fix/`, `docs/`, `chore/` + short name. Conventional Commits.
- Smallest change that fixes the cause. Reuse existing helpers and patterns.
- Never weaken a check to pass CI: no skipped tests, removed assertions or raised limits.
- Run `./scripts/ci-local.sh <area>` before opening a PR. `.github/workflows/` is the source of truth.

Folders that move money or hold user data have their own stricter `AGENTS.md`. Read it before editing there.
