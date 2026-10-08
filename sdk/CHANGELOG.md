# Changelog

All notable changes to `@dukapay/sdk` are documented here. This file is
maintained automatically by semantic-release.

## 0.1.0 (unreleased)

- Removed `scores.leaderboard()` and the `Leaderboard` / `LeaderboardEntry`
  types. The backend no longer serves `GET /score/leaderboard`, which published
  the top 50 wallet addresses with their credit scores.

- Initial SDK: `DukaPayClient` with `auth`, `loans`, `pool`, `scores`,
  `remittance` resources.
- Wallet adapters: `FreighterAdapter`, `AlbedoAdapter`, `WalletAdapter` interface.
- `ContractHelpers` for stroop/bps/address conversions.
- React hooks: `DukaPayProvider`, `useWallet`, `useLoans`, `useFloat`.
- Automatic retry with backoff and normalised `DukaPayError`.

### Fixed: request paths that never existed on the backend

Seven calls were pointed at routes the API does not serve, so they returned 404
to every integrator. Paths are now matched against
`backend/src/swagger/openapi.json`, and a contract test
(`src/resources.openapi.test.ts`) fails CI on any future drift. These are
breaking signature changes, made before 1.0:

- `loans.list()` now calls `GET /loans/borrower/{borrower}` and takes a required
  `borrower`, plus `status`/`from`/`to`/`limit`/`cursor` instead of
  `page`/`pageSize`. It returns `BorrowerLoans` (`{ success, borrower, loans }`).
- `loans.buildRepay(loanId, amount, borrowerPublicKey)` now calls
  `POST /loans/{loanId}/repay` (there is no `build-repay` route) and returns
  `RepayTransaction`. `amount` is a positive integer in the asset's base units
  and `borrowerPublicKey` must match the authenticated wallet — both are required
  by the API. Previously it took a decimal string and hit a 404.
- `scores.get(address)` now calls `GET /score/{userId}` (the route is mounted at
  `/score`, singular) and returns `Score`
  (`{ success, userId, score, band, factors }`).
- `remittance.list()` now calls `GET /remittances` (plural) with keyset
  pagination (`limit`/`cursor`/`status`/`from`/`to`/`q`) and returns
  `RemittanceList` (`{ success, data, page }`).
- `remittance.get(id)` now calls `GET /remittances/{id}` and returns
  `RemittanceEnvelope` (`{ success, data }`).
- `remittance.buildSend()` now calls `POST /remittances` (there is no
  `build-send` route) and returns `RemittanceCreated`. It takes
  `{ recipient, amount, fromCurrency, toCurrency, memo? }`; the sender comes
  from the session, so the previous `from` argument was dropped, and `amount` is
  a positive integer rather than a decimal string. Sign `data.xdr` and pass it to
  the new `remittance.submit(id, signedXdr)` to settle the transfer.

The `Remittance` type now mirrors the API's record (`senderId`,
`recipientAddress`, `fromCurrency`/`toCurrency`, `status` of
`pending | processing | completed | failed`) instead of the previous NFT-shaped
fields, which the API never returned. `useLoans` returns `BorrowerLoan[]` and its
`repay(loanId, amount)` takes a positive integer amount.
