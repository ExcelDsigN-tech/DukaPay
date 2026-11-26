# Services: strict rules (Stellar, webhooks, PII)

- Money stays in integer stroops or `bigint`. Use `backend/src/money/`; never `parseFloat` a money value.
- Never hand-edit `money/policy.generated.ts`; regenerate from `money-policy.json` (CI: money).
- Never log PII: email, phone, names, full public keys (CI scans logger calls).
- Outbound requests to user-supplied URLs go through the webhook SSRF guard (`isPrivateHost`, `redirect: 'manual'`).
- No empty `catch` blocks (lint). Handle the error or log it with context and rethrow.
- No new dependencies without maintainer review (CODEOWNERS).
