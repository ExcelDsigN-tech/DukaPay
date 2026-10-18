# Migrations: strict rules

- Never modify, rename or delete a migration that is on `main`. Add a new one (CI: check-migrations-immutable).
- Every migration has a working `down` (CI runs down and up again).
- Personal-data columns are stored encrypted. Never remove a name from `PII_COLUMNS` or rename a column to avoid the check.
- A new lookup on a large table (`contract_events`, `audit_logs`, `remittances`, `notifications`) ships with an index for it.
