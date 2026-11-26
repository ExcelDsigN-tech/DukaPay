# Contributing to DukaPay

DukaPay runs on Stellar testnet only and has not been audited. Contracts and
backend code move money, so the rules below are strict on purpose.

For local setup, see [docs/wiki/onboarding.md](docs/wiki/onboarding.md).

## Before you start

- Work from an open issue. Read its Definition of Done before writing code.
- Comment on the issue and wait to be assigned before you start. PRs for
  unassigned issues, or issues assigned to someone else, may be closed.
- Small fixes (typos, broken links, small docs corrections) don't need an
  issue. Open a PR directly.
- For paid programs such as the Drip Wave, apply on the issue through the
  program. Points go only to the assigned contributor.
- Folders that move money or hold user data have their own `AGENTS.md` with
  stricter rules. Read it before editing there:
  `contracts/`, `backend/migrations/`, `backend/src/controllers/`,
  `backend/src/routes/`, `backend/src/services/`, `infra/kubernetes/`.
- `money-policy.json` is the single source of money rules. Generated files
  derive from it; don't edit them by hand.

## Issues and severity

File issues with the Standard Issue form. It labels the issue with its
component, type and severity. Pick the severity that fits; a maintainer
sets the final one during triage.

| Severity | Meaning |
|---|---|
| Critical | Funds can be lost or stolen, auth bypassed, or user data leaked |
| High | A core money flow (loan, repay, deposit, withdraw, remittance) is broken with no workaround, or amounts are wrong |
| Medium | A feature is broken but has a workaround, or shows wrong non-financial data |
| Low | Cosmetic, docs, copy, minor UX |

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

Install the git hooks once. They fix formatting in the files you stage on
every commit:

```bash
./scripts/setup-hooks.sh
```

Before you push, apply every auto-fixer (formatting, lint fixes, the OpenAPI
spec and money-policy generated files), then run the checks for every area you
touched:

```bash
./scripts/ci-local.sh fix
./scripts/ci-local.sh <area>   # e.g. backend, frontend, contracts, sdk
```

If a CI job fails, its summary names the area to run locally.

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

## Security gates

Pull requests run the automated security scans in [`.github/workflows/security-gates.yml`](.github/workflows/security-gates.yml). All four scans below set `continue-on-error: ${{ github.event_name != 'pull_request' }}`, so they **block PRs** when findings fail and **report only** on scheduled weekly runs (`schedule`, feeding the automated weekly vulnerability report issue).

Median runtimes over the last 10 executed PR runs ([45576977353](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45576977353), [45573308014](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45573308014), [45566474561](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566474561), [45566470652](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566470652), [45563149279](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45563149279), [45559964879](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559964879), [45559511281](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559511281), [45524468893](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45524468893), [45523864297](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45523864297), [45484806715](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45484806715)):

| Gate | Workflow job | PR behavior | Scheduled behavior | Median runtime (10 PR runs) | Source runs |
|---|---|---|---|---|---|
| Semgrep | `Semgrep SAST` | Blocks PRs | Report only | 24s | [22s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45576977353/job/139077201168), [23s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45573308014/job/139066413668), [25s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566474561/job/139042400744), [27s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566470652/job/139042387893), [20s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45563149279/job/139033942406), [23s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559964879/job/139021037478), [26s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559511281/job/139019553164), [31s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45524468893/job/138904233772), [23s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45523864297/job/138902215338), [28s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45484806715/job/138767228478) |
| Trivy | `Trivy filesystem scan` | Blocks PRs | Report only | 16s | [16s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45576977353/job/139077201336), [14s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45573308014/job/139066413646), [13s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566474561/job/139042401067), [14s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566470652/job/139042388222), [12s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45563149279/job/139033942307), [16s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559964879/job/139021037234), [24s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559511281/job/139019553176), [16s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45524468893/job/138904234071), [23s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45523864297/job/138902215189), [24s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45484806715/job/138767227864) |
| npm audit | `npm audit` (`backend`, `frontend`, `scripts`, `sdk` in parallel) | Blocks PRs | Report only | 68.5s wall-clock (`scripts`: 10s, `backend`: 49s, `sdk`: 51.5s, `frontend`: 68.5s) | [66s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45576977353), [76s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45573308014), [71s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566474561), [82s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566470652), [66s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45563149279), [57s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559964879), [71s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559511281), [63s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45524468893), [82s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45523864297), [62s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45484806715) |
| cargo audit | `cargo audit` | Blocks PRs | Report only | 19s | [19s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45576977353/job/139077201249), [22s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45573308014/job/139066413721), [19s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566474561/job/139042401110), [22s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45566470652/job/139042388196), [19s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45563149279/job/139033941841), [16s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559964879/job/139021037779), [18s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45559511281/job/139019552905), [19s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45524468893/job/138904233853), [23s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45523864297/job/138902215286), [14s](https://github.com/ExcelDsigN-tech/DukaPay/actions/runs/45484806715/job/138767228236) |

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
