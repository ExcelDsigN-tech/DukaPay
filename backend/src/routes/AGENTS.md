# Routes: strict rules

- Every route that touches user data has `requireJwtAuth` (or `requireApiKey` for admin/internal) plus an ownership or role check.
- Register fixed paths before parameter paths (`/dsar/pending` before `/dsar/:dsarId`).
- After changing a route or its swagger comment, run `npm run openapi:generate` and commit `src/swagger/openapi.json` (CI: openapi-spec).
