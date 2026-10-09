# Contracts: strict rules (these hold funds)

- Every function that changes state calls `require_auth()` on the address that owns the action. Add a test that calls it without auth.
- Amounts are `i128` in the asset's smallest unit. Keep `overflow-checks = true` in `Cargo.toml`.
- Never hand-edit `money/src/policy.rs`. Change `money-policy.json` and run `scripts/gen-money.ts` (CI: money).
- Clippy runs with `-D warnings`. Fix the code; no `#[allow(...)]`, no `#[ignore]` (CI: contracts).
- Each wasm stays under 256 KiB. Shrink the contract; never raise the budget (CI: contracts).
- No new crates without maintainer review (CODEOWNERS).
