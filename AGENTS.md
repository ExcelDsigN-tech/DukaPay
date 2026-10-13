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
- Replace, don't layer. When changing a feature, delete the old version in the same change: no `v2`, fallback path or "kept for compatibility" copy. Exceptions: migrations, deployed contract storage and interfaces, and clients we don't control. For those, say why the old path stays and when it goes.
- Push, don't poll. Data that changes on an event reaches the frontend over the existing SSE streams (`/api/events/stream`, `/api/notifications/stream`). Poll only as the fallback while a stream is down.
- One API prefix: every backend router mounts under `/api`. Don't add a second tree.

Folders that move money or hold user data have their own stricter `AGENTS.md`. Read it before editing there.
