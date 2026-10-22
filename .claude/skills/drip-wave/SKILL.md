---
name: drip-wave
description: Review and merge a Stellar Drip Wave contributor PR on DukaPay. Use when asked to review, fix, merge or triage a Wave PR, or invoked as /drip-wave <PR number>. Runs the malware screen first, then the maintainer merge rule.
---

# Drip Wave PR review and merge

Argument: a PR number on `ExcelDsigN-tech/DukaPay`. Without one, list the open PRs and review each.

Work in this order. Show the review and the plan to the maintainer and wait for "GO" before pushing, merging, closing or filing anything.

## 1. Malware screen (before approving CI or merging)

Do this first on every PR. Fork PR CI runs the PR's own code and workflow files, so do not approve `action_required` runs until the screen is clean.

Look at the full diff and the changed file list. Any of these blocks the merge:

- `.vscode/tasks.json` with a `runOn: folderOpen` task, especially one running Node, `curl` or `wget`
- `task.allowAutomaticTasks: "on"` in `.vscode/settings.json`
- Font files such as `fa-solid-500.woff2`, `fa-solid-600.eot`, `fa-solid.lik`, `fa-solid-300.ttf`
- `dist/setup.js`, or `preinstall: "node dist/setup.js"` in any `package.json`
- An `api.js` file together with `start` or `dev` scripts that run it
- Code appended to `postcss`, `tailwind`, `eslint`, `next`, `jest` or `vite` config files, especially after a long run of whitespace
- The markers `rmcej%otb%`, `Cot%3T=sthP`, `_$__1e42`
- Anything unfamiliar or outside the issue's scope: new dependencies, install or lifecycle scripts, binary files, obfuscated code, network calls to unknown hosts, workflow changes the issue doesn't ask for, removed auth or permission checks, code that doesn't match the PR description

If any indicator matches: don't merge, don't approve CI, report what you found and where. Repositories that merge confirmed malware are removed from the Wave, so when in doubt, don't merge.

## 2. Check eligibility and state

- Every issue in `Closes #X` is assigned to the PR author in the Wave. If not, the PR doesn't earn points; tell the maintainer.
- Read each issue's Definition of Done and compare it with the diff.
- Check merge conflicts and CI. Run the area checks locally: `./scripts/ci-local.sh <area>`.

## 3. Merge rule

1. Merge before the due date when CI is green and the malware screen is clean.
2. Maintainers fix small blockers themselves: lint, formatting, regenerated files (`npm run openapi:generate`), merge conflicts, a migration timestamp that sorts before the latest one on main, a compile error, a missing test for code that already exists. Run `./scripts/ci-local.sh` and prove the fix before pushing.
3. Unfinished parts still merge. Missing tests, docs or a half-built feature are not a reason to hold the PR; they become new issues (rule 4). Hold back only a part that makes something that works today worse (a regression): revert that part, merge the rest, and file an issue to bring it back safely.
4. File a new issue for every unfinished part, at merge time. Each names what's missing, links the original issue and the PR, and has its own Definition of Done. Credit stays with the contributor.
5. `Closes #X` only for issues the merged work delivers. If nothing for an issue landed, use `Refs #X` and leave it open. The maintainer can override case by case.
6. Fork PRs: never supersede the contributor's PR with a maintainer PR. Push fixes to the contributor's branch from a session whose source is their fork, so their own PR is what merges. If the push is refused, merge their PR and land the fix or revert in a maintainer PR right after.
7. Never weaken a check to get green: no skipped tests, removed assertions or raised limits. CI is always green before merge, apart from jobs that are explicitly report-only.

## 4. After merging

- Squash-merge with the issues' `Closes` lines and `Co-authored-by: <contributor>`.
- Comment on the PR: thank the contributor, list any maintainer fixes, link the follow-up issues.
- No AI attribution in commits, PR bodies or merge messages. No em dashes in issue or PR text.
