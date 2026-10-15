# DukaPay MVP

DukaPay is on-chain agent banking: local shops act as agents that swap cash for
stablecoin and back, with their solvency enforced by a Soroban contract. Loans,
remittances and the lending pool are built on that agent network. They are not
a separate product.

The MVP is the smallest loop that proves this to a real user on Stellar
testnet. Anything outside that loop waits until after the MVP, even if the code
already exists.

## The MVP loop

| # | Step | Contract | Backend | Frontend | Indexed |
|---|---|---|---|---|---|
| 1 | An agent registers with a KYC reference and a USDC bond, and is activated by the operator | `agent_registry`: `register`, `top_up_bond`, `activate` | No | No | No |
| 2 | The agent locks USDC collateral and does cash-in / cash-out, with `float ≤ collateral × haircut` checked on every action | `agent_vault`: `deposit_collateral`, `mint_float`, `burn_float` | No | No | No |
| 3 | A sender's remittance lands with a receiving agent as e-money for the recipient, and the recipient redeems it for cash | `agent_vault`: `mint_float` on arrival, `burn_float` at cash-out | Send: yes. Receiving agent and redemption: no | Send: yes. Receiving agent and redemption: no | No |
| 4 | An agent takes a working-capital loan from the pool and repays it | `loan_manager`: `request_loan`, `repay`; `lending_pool`: `deposit`, `disburse` | Yes | Yes | Yes |
| 5 | Repaying raises the agent's credit score; a default lowers it | `remittance_nft`: `apply_score_delta` | Yes, but the sign is wrong (#746) | Yes | Yes |
| 6 | Anyone can check `Σ float ≤ Σ collateral` without trusting the operator | `agent_vault`: `check_invariant`, `check_invariants` | No | No | No |

The contracts for every step exist and are tested. The gap is off-chain: steps
1, 2, 3 (cash-out) and 6 have no backend, frontend or indexer support yet. The
lending steps (4 and 5) are the only ones a user can complete in the app today.

## Done when

The MVP is done when all of these hold on Stellar testnet:

- [ ] The contracts in the loop are deployed with constructors and recorded in `scripts/contract-registry.json` (#757, #754, #758)
- [ ] The backend indexes the agent contracts and the `agent_vaults` table exists (#774)
- [ ] An agent can register and be activated from the app (step 1, #775)
- [ ] An agent can manage collateral and do cash-in / cash-out from the app (step 2, #776)
- [ ] A remittance is credited to a recipient as agent e-money and redeemed for cash (step 3, #778)
- [ ] An agent can borrow from the pool and repay (step 4)
- [ ] Repayment and default move the score in the right direction, including after a reorg (#746, #770)
- [ ] The app shows the solvency check for any agent, read-only (step 6, #777)
- [ ] Money values stay exact end to end (#748, #767, #727)
- [ ] The full loop runs as one Playwright e2e test in CI

Every step now has an issue.

## Not in the MVP

The code for these exists and stays. No new work goes into them until the MVP
is done.

- **Gamification:** XP, achievements, Kingdom tiers, level-up modal, sounds
- **Notifications beyond in-app:** email (SendGrid) and SMS (Twilio)
- **Agent-to-agent float transfer** (`transfer_float`, `agentFloatRoutes.ts`)
- **Batch net settlement** (`settle_net`)
- **Admin extras:** webhooks, analytics, contract-upgrade approval in the UI
- **Mainnet:** deployment, KYC/AML enforcement and audit anchoring turned on, and the external audit

Oracle, circuit breaker and audit anchor are in launch scope, which is mainnet.
They are deployed and wired in #758, but the MVP loop does not depend on them.

## Decided: how a remittance is cashed out

A remittance is credited to the recipient as e-money issued by a receiving
agent and backed by that agent's collateral, not paid out as USDC to the
recipient's wallet. The receiving agent's float rises when the money arrives
(`mint_float`) and falls when the recipient redeems it (`burn_float`), so the
solvency rule covers money waiting to be collected.

For the MVP (#778):

- **Recipient balances** are kept in an off-chain ledger in the backend. The
  vault only stores each agent's total float, not who it is owed to.
  Per-customer balances on-chain come later, inside the audit scope.
- **The mint is signed by the operator key** on the server. Letting receiving
  agents mint against their own collateral comes later.
- **Routing** picks an active agent in the recipient's region with enough
  collateral headroom, or rejects the remittance before the sender pays.

Still open:

- **Licensing.** Issuing e-money that people hold is regulated in the target
  markets. Check before mainnet.

## Open decisions

- **Who can be an agent?** Registration is operator-gated (`activate`). The
  MVP keeps that; permissionless onboarding stays out of scope.
- **Is the borrower always an agent?** The landing copy says "micro-loans for
  shop owners". The MVP assumes loans go to agents (working capital). Loans to
  non-agent users are possible in the contracts but not part of the MVP story.
- **Success targets.** `docs/SUCCESS_METRICS.md` still has TBD targets. The
  MVP does not need them to be done, but they are needed before launch.

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md): the solvency model
- [CONTRACTS.md](../CONTRACTS.md): contract invariants
- [docs/SUCCESS_METRICS.md](SUCCESS_METRICS.md): launch targets
- [docs/deployed-contracts.md](deployed-contracts.md): deployment status
