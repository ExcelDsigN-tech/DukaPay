# Issue Creation Playbook

How maintainers draft and file issues on the DukaPay repo. Contributors can
use the Standard Issue form instead; it has the same sections minus Points.

## Key Context — DukaPay Monorepo

- **Protocol:** On-chain agent-banking float protocol on Stellar (Soroban)
- **Core Invariant:** Σ float ≤ Σ collateral × haircut
- **Stack:** Node.js/Express API (`backend/`), Next.js/React (`frontend/`), Soroban/Rust contracts (`contracts/`), TypeScript SDK (`sdk/`), PostgreSQL
- **Key Flows:** Agent onboarding (KYC + USDC bond), cash-in/out, float transfers, loan management, settlement
- **Security Model:** JWT auth, session management, CSRF protection, audit logging, encryption at rest
- **Testing:** Playwright E2E, Proptest property-based, Supertest integration, fuzz testing
- **Issue Templates:** `.github/ISSUE_TEMPLATE/` (standard, contracts_security, config). The standard form renders the same sections as the template below, minus Points; a workflow labels component, type and severity.

## Analysis Phase (Do First)

Gather evidence and classify severity — the goal is accurate findings, not a
point total.

```bash
# 1. Dedup against existing open issues
gh issue list --state open --limit 100 --json number,title,body,labels

# 2. Confirm labels exist before batch creation (create any missing ones now)
gh label list

# 3. Surface-level gaps (candidates for the 100/150 tier)
grep -r "TODO\|FIXME\|XXX" --include="*.ts" --include="*.rs" --include="*.js" .
grep -r "sk-\|api_key\|password" --include="*.ts" --include="*.rs" . | head -20
find . -name "*.test.*" -o -name "*.spec.*" | wc -l

# 4. Protocol-depth review (genuine 200-point candidates come from here, not from grep)
#    - Read contracts/ for: overflow/underflow paths, access control gaps, reentrancy,
#      and any code path that could violate Σ float ≤ Σ collateral × haircut
#    - Read auth/session/settlement flows in backend/ for the same class of issue
#    - If this pass finds few or no invariant-breaking bugs, report that honestly —
#      don't inflate other findings to compensate

# 5. Recent commits, for context on what's already in flight
git log --oneline -50
```

## Output Format — Exact Template (Non-Negotiable)

```
[{COMPONENT}] {DESCRIPTION}

**Description**: {DESCRIPTION}

**Impact**: {IMPACT}

**Suggested Fix**: {SUGGESTED_FIX}

**Points**: {POINTS}
**Type**: {TYPE}
**Severity**: {SEVERITY}

**Definition of Done**
- [ ] {CHECKLIST_ITEM_1}
- [ ] {CHECKLIST_ITEM_2}
- [ ] {CHECKLIST_ITEM_3}
- [ ] {CHECKLIST_ITEM_4}
      (can be more than 4 items, based on the issue)
- [ ] All required CI checks pass

---

📋 Before working on this issue, please read our [Contributing Guidelines]({CONTRIBUTING_URL}). It covers branching, commits, PR standards, testing and style guides.
All official decisions, reviews and coordination happen right here on GitHub.

```

### Component Prefixes (Use Exactly One)

`[backend]` `[contracts]` `[frontend]` `[sdk]` `[indexer]` `[scripts]` `[docs]` `[ci]` `[infra]` `[security]` `[tests]` `[ops]` `[product]`

### Points & Types

| Points | Complexity |
|---|---|
| 200 | High — critical security, core bugs, consensus changes |
| 150 | Medium-High — enhancements, security updates, test suites |
| 100 | Trivial/Simple — docs, cosmetic, config |

### Definition of Done — Component-Specific (pick one set)

- **Security:** No hardcoded secrets remain in source (grep scan clean) · Authentication flow verified and tested · Security headers (CSP, etc.) configured · No PII exposed in logs or error messages
- **Bug:** Bug reproduced and root cause identified · Fix implemented and tested · Edge cases covered by existing tests · No regression introduced
- **Enhancement:** Documentation verified · Lint + typecheck pass
- **Documentation:** Documentation complete and accurate · Examples and tutorials updated · Cross-reference checks complete
- **Performance:** Performance improvements implemented · Benchmarks run and passing · No regressions in performance-critical paths
- **Always last:** All required CI checks pass

### Placeholders (Fill Before Execution)

| Placeholder | Description |
|---|---|
| `{COMPONENT}` | One of the 13 prefixes above |
| `{DESCRIPTION}` | One-line issue title |
| `{IMPACT}` | Business/technical impact |
| `{SUGGESTED_FIX}` | Concrete implementation approach |
| `{POINTS}` | 200 \| 150 \| 100 |
| `{TYPE}` | bug \| feature \| enhancement \| security \| performance \| tests \| documentation \| refactor \| chore (matches the issue form) |
| `{SEVERITY}` | critical \| high \| medium \| low (definitions in CONTRIBUTING.md) |
| `{CONTRIBUTING_URL}` | https://github.com/ExcelDsigN-tech/dukapay/blob/main/CONTRIBUTING.md |
| `{CHECKLIST_ITEM_N}` | Pulled from the component-specific list above |

## Execution

```bash
gh issue create \
  --title "[{COMPONENT}] {DESCRIPTION}" \
  --body "$(cat issue_body.md)" \
  --label "{COMPONENT}" \
  --label "{TYPE}" \
  --label "severity: {SEVERITY}"
```

## Sample Issue (for calibration)

`[backend] Lender role has no distinct Row-Level Security policy family`

**Description:** `backend/src/auth/rbac.ts` defines 5 roles: `admin`, `agent`,
`borrower`, `auditor`, `lender`. The RLS migration
(`backend/migrations/1808000000000_enable-rls.cjs`) only builds policy
families for 4 of them: `borrower` (own rows), `agent` (own + assigned
borrowers via `agent_assignments`), `auditor` (read-only, all rows), `admin`
(unrestricted). `lender` has no corresponding `dukapay_request_is_lender()`-
style policy — it's unclear whether lender requests fall through
agent-shaped policies, borrower-shaped policies, or are default-denied by
Postgres RLS (deny-by-default when no policy matches).

**Impact**: If a lender-scoped request reaches a table with RLS enabled and no
matching policy, Postgres silently returns zero rows rather than erroring —
this could look like "the pool has no data" instead of a clear
access-control message, and could equally mask an unintended over- or
under-grant.

**Suggested Fix**: Trace what actually happens today for a lender-authenticated
request against an RLS-protected table (test it directly, don't assume). If
`lender` is meant to be a read-only alias of `agent` (per the comment in
`rbac.ts`), add an explicit RLS policy rather than relying on incidental
behavior. Add a test case alongside the existing `tenantAccessRbac.test.ts`
suite covering the lender role specifically.

**Points**: 150
**Type**: security
**Severity**: high

**Definition of Done**
- [ ] Actual current behavior for lender-role RLS access confirmed and documented
- [ ] Explicit RLS policy added for lender (or the role formally deprecated in favor of agent)
- [ ] Test coverage added for lender-role row access
- [ ] All required CI checks pass

---

📋 Before working on this issue, please read our [Contributing Guidelines]({CONTRIBUTING_URL}). It covers branching, commits, PR standards, testing and style guides.
All official decisions, reviews and coordination happen right here on GitHub.

