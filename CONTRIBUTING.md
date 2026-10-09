# Contributing to DukaPay

DukaPay runs on Stellar testnet only and has not been audited. Contracts and
backend code move money, so the rules below are strict on purpose.

For local setup, see [docs/wiki/onboarding.md](docs/wiki/onboarding.md).

## Before you start

- Work from an open issue. Read its Definition of Done before writing code.
- Folders that move money or hold user data have their own `AGENTS.md` with
  stricter rules. Read it before editing there:
  `contracts/`, `backend/migrations/`, `backend/src/controllers/`,
  `backend/src/routes/`, `backend/src/services/`, `infra/kubernetes/`.
- `money-policy.json` is the single source of money rules. Generated files
  derive from it; don't edit them by hand.

## Branches

`feat/`, `fix/`, `docs/` or `chore/` plus a short name, e.g. `fix/loan-max-units`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) with the
component as scope: `fix(contracts): ...`, `feat(frontend): ...`.

## Code

- Make the smallest change that fixes the cause.
- Reuse existing helpers and patterns before adding new ones.
- Never weaken a check to pass CI: no skipped tests, removed assertions or
  raised limits.

## Testing

Run the checks for every area you touched before opening a PR:

```bash
./scripts/ci-local.sh <area>   # e.g. backend, frontend, contracts, sdk
```

`.github/workflows/` is the source of truth. If the script and CI disagree,
CI wins.

## Pull requests

- Fill in every section of the PR template.
- Link the issue with `Closes #<number>`.
- Copy the issue's Definition of Done into the PR checklist and tick what the
  PR meets.
- Security-sensitive changes need a completed `.github/THREAT_MODEL.md` and
  maintainer review.

## Review and merge

- `main` needs one approving review, including code owners for the files you
  changed (see `.github/CODEOWNERS`).
- All required CI checks must pass. New pushes dismiss earlier approvals.
- PRs are squash-merged, so the PR title becomes the commit message.

## Security

Don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
