# Database Schema Reference

This document describes every table created by the 33 migrations in `backend/migrations/`,
their columns, indexes, and relationships.

---

## Table: `scores`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `borrower` | `varchar(255)` | `NOT NULL, UNIQUE` | Historical name `user_id`; renamed in ensure-core-tables migration |
| `score` | `integer` | `NOT NULL, DEFAULT 500` | Historical name `current_score`; renamed in ensure-core-tables migration. Clamped 300-850 |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | Added by migration 1774000000004 |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: unique on `borrower`.

**Notes**: The column names are normalized by the `ensure-core-tables` migration (1789000000000), which renames `user_id -> borrower` and `current_score -> score` if the old names still exist. All runtime queries across the backend (controllers, services, indexers, privacy DSAR, seed) use the current column names (`borrower`, `score`).

---

## Table: `contract_events` (originally `loan_events`)

Renamed from `loan_events` by migration 1788000000018. A backward-compat view named
`loan_events` is also created, mapping `address AS borrower`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `event_id` | `varchar(255)` | `NOT NULL, UNIQUE` | Soroban event ID from RPC |
| `event_type` | `varchar(50)` | `NOT NULL` | e.g. `LoanRequested`, `LoanApproved`, `LoanRepaid`, `Deposit` |
| `loan_id` | `integer` | | NULL for non-loan events (e.g. governance, pool) |
| `address` | `varchar(255)` | | Renamed from `borrower`; nullable for events without a user address |
| `amount` | `numeric` | | |
| `ledger` | `integer` | `NOT NULL` | Stellar ledger sequence number |
| `ledger_closed_at` | `timestamp` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | `NOT NULL` | |
| `contract_id` | `varchar(255)` | `NOT NULL` | |
| `topics` | `jsonb` | | Raw XDR topics as base64 |
| `value` | `text` | | Raw XDR value as base64 |
| `interest_rate_bps` | `integer` | | Added by migration 1776000000006 |
| `term_ledgers` | `integer` | | Added by migration 1776000000006 |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `contract_events_event_type_index` on `event_type`
- `contract_events_address_index` on `address`
- `contract_events_loan_id_index` on `loan_id`
- `contract_events_ledger_index` on `ledger`
- `contract_events_tx_hash_index` on `tx_hash`
- `idx_contract_events_address_type_closed_at` on `(address, event_type, ledger_closed_at)` WHERE `address IS NOT NULL`
- `idx_contract_events_address_event_type` (renamed from `idx_loan_events_borrower_event_type`)
- `idx_contract_events_loan_id_event_type` (renamed from `idx_loan_events_loan_id_event_type`)
- `idx_contract_events_event_type_loan_id` (renamed from `idx_loan_events_event_type_loan_id`)
- `idx_contract_events_pool_deposits_withdraws` (renamed from `idx_loan_events_pool_deposits_withdraws`)
- `uq_contract_events_loan_type_ledger` — UNIQUE on `(loan_id, event_type, ledger)` (added by migration 1789000000001)
- `loan_events_unique_approved_event_per_loan` — UNIQUE partial index on `loan_id` WHERE `event_type = 'LoanApproved'`
- `idx_loan_events_type_created_at` on `(event_type, created_at)` (on the `loan_events` view)

**View**: `loan_events` — SELECT from `contract_events` with `address AS borrower`.

---

## Table: `indexer_state`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `last_indexed_ledger` | `integer` | `NOT NULL, DEFAULT 0` | Renamed to `last_ledger` in ensure-core-tables migration |
| `last_indexed_cursor` | `varchar(255)` | | |
| `contract` | `varchar(255)` | `NOT NULL, UNIQUE` | Added by ensure-core-tables; default `'default'` |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Notes**: Tracks the last ledger block the event indexer has processed. Row is
inserted on first run (value 0).

---

## Table: `remittance_history`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `user_id` | `varchar(255)` | `NOT NULL` | |
| `amount` | `numeric` | `NOT NULL` | |
| `month` | `varchar(50)` | `NOT NULL` | e.g. `2024-01` |
| `status` | `varchar(50)` | `NOT NULL` | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `user_id`.

---

## Table: `remittances`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | |
| `sender_id` | `varchar(56)` | `NOT NULL` | Stellar public key |
| `recipient_address` | `varchar(56)` | `NOT NULL` | |
| `amount` | `numeric(20,7)` | `NOT NULL` | |
| `from_currency` | `varchar(10)` | `NOT NULL` | |
| `to_currency` | `varchar(10)` | `NOT NULL` | |
| `memo` | `varchar(28)` | | |
| `status` | `varchar(20)` | `NOT NULL, DEFAULT 'pending'` | CHECK IN (`pending`, `processing`, `completed`, `failed`) |
| `transaction_hash` | `varchar(64)` | | |
| `xdr` | `text` | `NOT NULL` | Stellar transaction envelope XDR |
| `error_message` | `text` | | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `remittances_sender_id_index` on `sender_id`
- `remittances_sender_id_status_index` on `(sender_id, status)`
- `remittances_created_at_index` on `created_at`
- `remittances_transaction_hash_index` on `transaction_hash`
- `idx_remittances_sender_status_created` on `(sender_id, status, created_at)`
- `idx_remittances_sender_created` on `(sender_id, created_at)`

---

## Table: `webhook_subscriptions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `callback_url` | `text` | `NOT NULL` | |
| `event_types` | `jsonb` | `NOT NULL, DEFAULT '[]'` | Array of event type strings to subscribe to |
| `secret` | `varchar(255)` | | HMAC secret for webhook payload signing |
| `is_active` | `boolean` | `NOT NULL, DEFAULT true` | |
| `max_attempts` | `integer` | `NOT NULL, DEFAULT 5` | Added by migration 1786000000016 |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `is_active`.

---

## Table: `webhook_deliveries`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `subscription_id` | `integer` | `NOT NULL, REFERENCES webhook_subscriptions ON DELETE CASCADE` | |
| `event_id` | `varchar(255)` | `NOT NULL` | |
| `event_type` | `varchar(50)` | `NOT NULL` | |
| `payload` | `jsonb` | `NOT NULL` | Added by migration 1781000000011 |
| `attempt_count` | `integer` | `NOT NULL, DEFAULT 0` | |
| `last_status_code` | `integer` | | HTTP status code from last delivery attempt |
| `last_error` | `text` | | |
| `delivered_at` | `timestamp` | | Set when delivery succeeds |
| `next_retry_at` | `timestamp` | | Added by migration 1781000000011; NULL when delivered |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `webhook_deliveries_event_id_index` on `event_id`
- `webhook_deliveries_subscription_id_index` on `subscription_id`
- `webhook_deliveries_next_retry_at_delivered_at_index` on `(next_retry_at, delivered_at)`
- on `(next_retry_at)` WHERE `next_retry_at IS NOT NULL AND delivered_at IS NULL`
- on `(subscription_id, event_id)`

---

## Table: `user_profiles`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `public_key` | `varchar(255)` | `NOT NULL, UNIQUE` | Stellar wallet public key |
| `display_name` | `varchar(255)` | | |
| `email` | `varchar(255)` | | |
| `phone` | `varchar(50)` | | Added by migration 1787000000017 |
| `email_enabled` | `boolean` | `NOT NULL, DEFAULT true` | Initially in migration 1773000000001; added again by 1787000000017 |
| `sms_enabled` | `boolean` | `NOT NULL, DEFAULT true` | Initially in migration 1773000000001; added again by 1787000000017 |
| `metadata` | `jsonb` | | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `public_key`.

---

## Table: `loan_history`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `loan_id` | `integer` | `NOT NULL` | |
| `borrower_public_key` | `varchar(255)` | `NOT NULL` | |
| `lender_public_key` | `varchar(255)` | | |
| `principal_amount` | `numeric` | `NOT NULL` | |
| `interest_rate_bps` | `integer` | `NOT NULL` | In basis points |
| `principal_paid` | `numeric` | `DEFAULT 0` | |
| `interest_paid` | `numeric` | `DEFAULT 0` | |
| `accrued_interest` | `numeric` | `DEFAULT 0` | |
| `status` | `varchar(50)` | `NOT NULL` | |
| `due_date` | `timestamp` | | |
| `requested_at` | `timestamp` | | |
| `approved_at` | `timestamp` | | |
| `repaid_at` | `timestamp` | | |
| `defaulted_at` | `timestamp` | | |
| `metadata` | `jsonb` | | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `loan_id`, `borrower_public_key`, `lender_public_key`, `status`.

---

## Table: `indexed_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `event_id` | `varchar(255)` | `NOT NULL, UNIQUE` | |
| `event_type` | `varchar(50)` | `NOT NULL` | |
| `contract_id` | `varchar(255)` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | `NOT NULL` | |
| `ledger` | `integer` | `NOT NULL` | |
| `ledger_closed_at` | `timestamp` | `NOT NULL` | |
| `topics` | `jsonb` | | |
| `value` | `text` | | |
| `processed` | `boolean` | `NOT NULL, DEFAULT false` | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `event_type`, `contract_id`, `ledger`, `tx_hash`, `processed`.

---

## Table: `notifications`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `user_id` | `varchar(255)` | `NOT NULL` | |
| `type` | `varchar(50)` | `NOT NULL` | e.g. `loan_approved`, `repayment_due`, `repayment_confirmed`, `loan_defaulted`, `score_changed` |
| `title` | `varchar(255)` | `NOT NULL` | |
| `message` | `text` | `NOT NULL` | |
| `loan_id` | `integer` | | |
| `read` | `boolean` | `NOT NULL, DEFAULT false` | Legacy; superseded by `status` |
| `status` | `varchar(20)` | `NOT NULL, DEFAULT 'unread'` | Added by migration 1783000000013; CHECK IN (`unread`, `read`, `archived`) |
| `action_url` | `varchar(500)` | | Added by migration 1794000000000; deep-link URL |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `notifications_user_id_index` on `user_id`
- `notifications_read_index` on `read`
- `notifications_user_id_read_index` on `(user_id, read)`
- `notifications_created_at_index` on `created_at`
- `notifications_status_index` on `status`
- `idx_notifications_status_created_at` on `(status, created_at)`
- `idx_notifications_user_type_status_created` on `(user_id, type, status, created_at)`
- `idx_notifications_user_created` on `(user_id, created_at)`

---

## Table: `quarantine_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `event_id` | `varchar(255)` | `NOT NULL, UNIQUE` | |
| `ledger` | `integer` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | `NOT NULL` | |
| `contract_id` | `varchar(255)` | `NOT NULL` | |
| `raw_xdr` | `jsonb` | `NOT NULL` | Full event payload as base64-encoded XDR |
| `error_message` | `text` | `NOT NULL` | Why parsing failed |
| `quarantined_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `ledger`, `quarantined_at`.

---

## Table: `transaction_submissions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `tx_hash` | `varchar(64)` | `NOT NULL, UNIQUE` | |
| `status` | `varchar(50)` | `NOT NULL` | |
| `submitted_at` | `timestamp with time zone` | `NOT NULL, DEFAULT NOW()` | |
| `submitted_by` | `varchar(56)` | | Stellar public key of submitter |
| `transaction_type` | `varchar(20)` | `NOT NULL, DEFAULT 'loan'` | |
| `result_xdr` | `text` | | Result XDR from transaction |
| `created_at` | `timestamp with time zone` | `DEFAULT NOW()` | |
| `updated_at` | `timestamp with time zone` | `DEFAULT NOW()` | Auto-updated by trigger |

**Indexes**: on `submitted_at`, `submitted_by`, `status`, `transaction_type`.

---

## Table: `audit_logs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `actor` | `varchar(255)` | `NOT NULL` | Admin address or `SYSTEM` |
| `action` | `varchar(255)` | `NOT NULL` | e.g. `ADMIN_CONFIG_*`, `loan_approved` |
| `target` | `varchar(255)` | | e.g. `contract:0x...`, `loan:42` |
| `payload` | `jsonb` | | Structured event details |
| `ip_address` | `varchar(50)` | | HTTP request IP (null for on-chain actions) |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `actor`, `action`, `created_at`.

---

## Table: `loan_disputes`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `loan_id` | `integer` | `NOT NULL, REFERENCES loan_events(loan_id)` | |
| `borrower` | `text` | `NOT NULL` | |
| `reason` | `text` | `NOT NULL` | |
| `status` | `text` | `NOT NULL, DEFAULT 'open'` | `open`, `resolved`, `rejected` |
| `admin_note` | `text` | | |
| `resolution` | `text` | | |
| `created_at` | `timestamp with time zone` | `DEFAULT NOW()` | |
| `resolved_at` | `timestamp with time zone` | | |

**Indexes**: on `status`, `borrower`, `loan_id`.

---

## Table: `user_notification_preferences`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | `varchar(255)` | `PRIMARY KEY` | |
| `digest_frequency` | `varchar(20)` | `NOT NULL, DEFAULT 'off'` | Added by migration 1793000000000; CHECK IN (`off`, `daily`, `weekly`) |

**Notes**: Originally seeded as notification preference fields on `user_profiles`.
This table stores per-user digest frequency settings independently.

---

## Table: `pause_state`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `bigint` | `PRIMARY KEY` | Always 1 (single row table) |
| `is_paused` | `boolean` | `NOT NULL, DEFAULT false` | Whether contracts are currently paused |
| `paused_at` | `timestamp with time zone` | | Timestamp when pause was activated |
| `reason` | `text` | | Reason for pause |
| `contracts` | `text[]` | `DEFAULT '{}'` | Array of contract IDs that are paused |
| `updated_at` | `timestamp with time zone` | `NOT NULL, DEFAULT NOW()` | Timestamp of last update |

**Notes**: Tracks global pause state across all Soroban contracts for cross-contract pause coordination.

---

## Table: `agent_float_transfer_limits`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `from_agent` | `varchar(255)` | `NOT NULL` | |
| `to_agent` | `varchar(255)` | `NOT NULL` | |
| `daily_limit` | `numeric` | `NOT NULL, DEFAULT '100000'` | |
| `weekly_limit` | `numeric` | `NOT NULL, DEFAULT '500000'` | |
| `created_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |
| `updated_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |

**Indexes**: on `from_agent`, `to_agent`.
**Constraints**: UNIQUE on `(from_agent, to_agent)`.

---

## Table: `agent_float_transfers`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `varchar(255)` | `PRIMARY KEY` | |
| `from_agent` | `varchar(255)` | `NOT NULL` | |
| `to_agent` | `varchar(255)` | `NOT NULL` | |
| `amount` | `numeric` | `NOT NULL` | |
| `reason` | `varchar(255)` | | |
| `status` | `varchar(50)` | `NOT NULL, DEFAULT 'PENDING_APPROVAL'` | |
| `required_approvals` | `integer` | `NOT NULL, DEFAULT 2` | |
| `approval_count` | `integer` | `NOT NULL, DEFAULT 1` | |
| `created_by` | `varchar(255)` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | | |
| `created_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |
| `updated_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |

**Indexes**: on `from_agent`, `to_agent`, `status`, `created_at`.

---

## Table: `agent_float_transfer_approvals`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `transfer_id` | `varchar(255)` | `NOT NULL, REFERENCES agent_float_transfers ON DELETE CASCADE` | |
| `approver` | `varchar(255)` | `NOT NULL` | |
| `role` | `varchar(50)` | `NOT NULL` | |
| `approved_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |

**Indexes**: on `transfer_id`.
**Constraints**: UNIQUE on `(transfer_id, approver)`.

---

## Table: `audit_epochs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `bigserial` | `PRIMARY KEY` | |
| `epoch_start` | `timestamptz` | `NOT NULL, UNIQUE` | |
| `epoch_end` | `timestamptz` | `NOT NULL` | |
| `merkle_root` | `varchar(64)` | `NOT NULL` | |
| `leaf_count` | `integer` | `NOT NULL` | |
| `anchor_status` | `varchar(20)` | `NOT NULL, DEFAULT 'pending'` | CHECK IN (`pending`, `anchored`, `failed`) |
| `stellar_tx_hash` | `varchar(64)` | | |
| `anchored_at` | `timestamptz` | | |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |

---

## Table: `audit_merkle_leaves`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `epoch_id` | `bigint` | `NOT NULL, REFERENCES audit_epochs ON DELETE RESTRICT` | |
| `log_id` | `integer` | `NOT NULL, UNIQUE, REFERENCES audit_logs ON DELETE RESTRICT` | |
| `leaf_index` | `integer` | `NOT NULL` | |
| `leaf_hash` | `varchar(64)` | `NOT NULL` | |

**Constraints**: UNIQUE on `(epoch_id, leaf_index)`.

---

## Table: `compliance_profiles`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `subject_id` | `varchar(56)` | `PRIMARY KEY` | |
| `provider` | `varchar(40)` | `NOT NULL` | |
| `provider_reference` | `varchar(255)` | | |
| `status` | `varchar(20)` | `NOT NULL` | CHECK IN (`approved`, `review`, `rejected`) |
| `country_code` | `char(2)` | | |
| `sanctions_match` | `boolean` | `NOT NULL, DEFAULT false` | |
| `pep_match` | `boolean` | `NOT NULL, DEFAULT false` | |
| `adverse_media_match` | `boolean` | `NOT NULL, DEFAULT false` | |
| `screened_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |
| `next_screening_at` | `timestamptz` | `NOT NULL` | |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |
| `updated_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |

---

## Table: `compliance_audit_log`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `bigserial` | `PRIMARY KEY` | |
| `subject_id` | `varchar(56)` | | |
| `event_type` | `varchar(60)` | `NOT NULL` | |
| `decision` | `varchar(30)` | `NOT NULL` | |
| `provider_reference` | `varchar(255)` | | |
| `reason_codes` | `jsonb` | `NOT NULL, DEFAULT '[]'` | |
| `metadata` | `jsonb` | `NOT NULL, DEFAULT '{}'` | |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |

**Indexes**: on `(subject_id, created_at)`.
**Notes**: Append-only table enforced by `compliance_audit_log_immutable` trigger.

---

## Table: `transaction_monitoring_alerts`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY` | |
| `subject_id` | `varchar(56)` | `NOT NULL` | |
| `transaction_reference` | `uuid` | | |
| `risk_score` | `integer` | `NOT NULL` | |
| `rule_codes` | `jsonb` | `NOT NULL` | |
| `status` | `varchar(20)` | `NOT NULL, DEFAULT 'open'` | |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |

**Indexes**: on `(subject_id, created_at)`.

---

## Table: `sar_reports`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY` | |
| `alert_id` | `uuid` | `NOT NULL, REFERENCES transaction_monitoring_alerts` | |
| `subject_id` | `varchar(56)` | `NOT NULL` | |
| `narrative` | `text` | `NOT NULL` | |
| `filing_status` | `varchar(30)` | `NOT NULL, DEFAULT 'pending_submission'` | |
| `provider_reference` | `varchar(255)` | | |
| `generated_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |
| `filed_at` | `timestamptz` | | |

---

## Table: `cross_contract_reconciliation`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `intent_key` | `varchar(255)` | `NOT NULL, UNIQUE` | Deterministic idempotency key: `${operation}:${loan_id}:${event_id}` |
| `loan_id` | `integer` | | |
| `borrower` | `varchar(255)` | `NOT NULL` | |
| `operation` | `varchar(16)` | `NOT NULL` | CHECK IN (`approve`, `repay`, `default`) |
| `disbursement_ledger` | `integer` | | |
| `disbursement_tx_hash` | `varchar(255)` | | |
| `expected_score_delta` | `integer` | `NOT NULL, DEFAULT 0` | Expected credit-score change (0 = none expected) |
| `score_applied` | `boolean` | `NOT NULL, DEFAULT false` | |
| `score_ledger` | `integer` | | |
| `state` | `varchar(16)` | `NOT NULL, DEFAULT 'pending'` | CHECK IN (`pending`, `half_applied`, `reconciled`, `failed`) |
| `attempts` | `integer` | `NOT NULL, DEFAULT 0` | |
| `last_checked_at` | `timestamp` | | |
| `created_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |
| `updated_at` | `timestamp` | | |

**Indexes**: on `state`, `borrower`, `loan_id`.

---

## Table: `decay_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `borrower` | `varchar(255)` | `NOT NULL` | |
| `event_type` | `varchar(64)` | `NOT NULL` | |
| `event_timestamp` | `timestamp` | `NOT NULL` | |
| `initial_score` | `integer` | `NOT NULL` | |
| `half_life_days` | `integer` | `NOT NULL, DEFAULT 30` | |
| `decay_factor` | `numeric` | | |
| `decayed_score` | `integer` | | |
| `created_at` | `timestamp` | `NOT NULL, DEFAULT current_timestamp` | |

**Indexes**: on `(borrower, event_timestamp)`, `event_type`.
**Constraints**: UNIQUE on `(borrower, event_type, event_timestamp)`.

---

## Table: `dsar_requests`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | |
| `public_key` | `text` | `NOT NULL` | |
| `type` | `text` | `NOT NULL` | CHECK IN (`access`, `deletion`, `anonymization`) |
| `status` | `text` | `NOT NULL, DEFAULT 'pending'` | CHECK IN (`pending`, `processing`, `completed`, `rejected`) |
| `reason` | `text` | `NOT NULL` | |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |
| `completed_at` | `timestamptz` | | |

**Indexes**: on `public_key`, `status`, `created_at`.

---

## Table: `ledger_checkpoints`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `contract` | `text` | `NOT NULL` | |
| `range_start` | `bigint` | `NOT NULL` | |
| `range_end` | `bigint` | `NOT NULL` | |
| `status` | `text` | `NOT NULL, DEFAULT 'verified'` | CHECK IN (`verified`, `suspect`) |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `idx_ledger_checkpoints_contract_range_end` on `(contract, range_end)`
- `idx_ledger_checkpoints_contract_status` on `(contract, status)` WHERE `status = 'suspect'`
**Constraints**: `range_end >= range_start`.

---

## Table: `pii_access_log`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | |
| `actor` | `text` | `NOT NULL` | |
| `record_id` | `text` | `NOT NULL` | |
| `field` | `text` | `NOT NULL` | |
| `reason` | `text` | `NOT NULL` | |
| `request_id` | `text` | `NOT NULL` | |
| `created_at` | `timestamptz` | `NOT NULL, DEFAULT NOW()` | |

**Indexes**: on `(record_id, created_at)`, `(actor, created_at)`.

---

## Entity Relationships

```
scores (1:1 with address) ──> user identified by user_id/borrower
contract_events (many per loan) ──> referenced by loan_id
remittances (many per sender) ──> sender_id
notifications (many per user) ──> user_id
webhook_deliveries (many per subscription) ──> subscription_id -> webhook_subscriptions
loan_disputes (1:1 per disputed loan) ──> loan_id -> contract_events(loan_id)
user_profiles (1:1 per address) ──> public_key
audit_merkle_leaves (many per epoch) ──> epoch_id -> audit_epochs
audit_merkle_leaves (1:1 per log) ──> log_id -> audit_logs
sar_reports (1:1 per alert) ──> alert_id -> transaction_monitoring_alerts
agent_float_transfer_approvals (many per transfer) ──> transfer_id -> agent_float_transfers
```

### Event Flow
```
Stellar Soroban contract emits event
  -> indexer polls Stellar RPC
    -> stored in contract_events
      -> scores updated (score deltas applied)
        -> webhooks dispatched
          -> SSE broadcast to connected clients
            -> notifications created for users
```

### Historical Renames

| Old Name | Current Name | Migration |
|---|---|---|
| `loan_events` (table) | `contract_events` | 1788000000018 |
| `loan_events` (backward-compat view) | `loan_events` (view) | 1788000000018 |
| `borrower` column | `address` | 1788000000018 |
| `user_id` column (scores) | `borrower` | 1789000000000 |
| `current_score` column (scores) | `score` | 1789000000000 |
| `last_indexed_ledger` (indexer_state) | `last_ledger` | 1789000000000 |
