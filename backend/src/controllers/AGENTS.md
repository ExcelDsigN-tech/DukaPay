# Controllers: strict rules (user data and money)

- A handler that takes a wallet, user, loan or record id from the request must check the caller owns it:
  `requireTenantAccess`, `requireLoanOwner`, `requireLoanBorrowerAccess`, or an explicit check like `authorizeDsar`.
  Add a test where another user gets 403.
- Throw `AppError`. Never put `error.message` or a stack trace in a response; the error handler does that safely.
- Await work that changes data. No fire-and-forget promises: a failure must reach the caller.
- A Stellar transaction is done only when the network returns `SUCCESS` (`submitSignedTx` throws otherwise).
- No `await` inside loops (N+1): batch the query or use `Promise.all` (lint: no-await-in-loop).
