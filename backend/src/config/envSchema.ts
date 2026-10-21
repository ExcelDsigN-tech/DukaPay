import { z } from 'zod';

/**
 * Typed view of every environment variable the backend reads.
 *
 * This module has no imports besides zod so that low-level modules (the
 * logger in particular) can depend on it without an import cycle; everything
 * else should import `env` from `./env.js`.
 *
 * Each property is a getter that parses `process.env[key]` with the schema
 * below. The parsed value is cached against the raw string, so a value is
 * parsed once and re-parsed only if `process.env` changes (tests rely on that).
 * Blank values are treated as unset.
 */

const raw = z
  .string()
  .optional()
  .transform((v) => (v !== undefined && v.trim() !== '' ? v : undefined));

const optionalString = () => raw;

const stringWithDefault = (fallback: string) => raw.transform((v) => v ?? fallback);

/** `Number.parseInt` with a default when unset; NaN when set but malformed. */
const int = (fallback: number) =>
  raw.transform((v) => (v === undefined ? fallback : Number.parseInt(v, 10)));

/** Integer or `undefined` when unset or malformed. */
const optionalInt = () =>
  raw.transform((v) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) ? n : undefined;
  });

const positiveInt = (fallback: number) =>
  raw.transform((v) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  });

const nonNegativeInt = (fallback: number) =>
  raw.transform((v) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  });

/** `Number(value)` with a default when unset. */
const number = (fallback: number) => raw.transform((v) => (v === undefined ? fallback : Number(v)));

/** Accepts 1/true/yes/on and 0/false/no/off; anything else is the default. */
const boolean = (fallback: boolean) =>
  raw.transform((v) => {
    if (v === undefined) return fallback;
    const normalized = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
  });

/** Strict opt-in flag: only the exact string "true" enables it. */
const flag = () => raw.transform((v) => v === 'true');

/** Comma-separated list, entries trimmed, empty entries dropped. */
const list = () =>
  raw.transform((v) =>
    (v ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

export const envShape = {
  NODE_ENV: optionalString(),
  PORT: int(3001),
  LOG_LEVEL: optionalString(),
  LOG_REDACTION: optionalString(),
  EXPOSE_STACK_TRACES: flag(),
  GIT_SHA: stringWithDefault('unknown'),
  BUILD_TIME: stringWithDefault('unknown'),

  // Database
  DATABASE_URL: optionalString(),
  DB_POOL_MAX: int(10),
  DB_POOL_MIN: int(2),
  DB_IDLE_TIMEOUT_MS: int(30000),
  DB_CONN_TIMEOUT_MS: int(10000),
  DB_STATEMENT_TIMEOUT_MS: int(30000),
  DB_SLOW_QUERY_THRESHOLD_MS: int(100),

  // Redis
  REDIS_URL: stringWithDefault('redis://localhost:6379'),

  // HTTP / auth
  FRONTEND_URL: optionalString(),
  CORS_ALLOWED_ORIGINS: list(),
  JWT_SECRET: optionalString(),
  JWT_COOKIE_NAME: stringWithDefault('dukapay_jwt'),
  REFRESH_COOKIE_NAME: stringWithDefault('dukapay_refresh'),
  CSRF_COOKIE_NAME: stringWithDefault('XSRF-TOKEN'),
  ACCESS_TOKEN_TTL_SECONDS: int(15 * 60),
  REFRESH_TOKEN_TTL_SECONDS: int(7 * 24 * 60 * 60),
  CHALLENGE_EXPIRES_IN_MS: int(5 * 60 * 1000),
  INTERNAL_API_KEY: optionalString(),

  // Role wallets
  SUPER_ADMIN_WALLETS: list(),
  OPS_WALLETS: list(),
  SUPPORT_WALLETS: list(),
  ADMIN_WALLETS: list(),
  AGENT_WALLETS: list(),
  AUDITOR_WALLETS: list(),
  LENDER_WALLETS: list(),

  // Stellar / contracts
  LOAN_MANAGER_CONTRACT_ID: optionalString(),
  LENDING_POOL_CONTRACT_ID: optionalString(),
  REMITTANCE_NFT_CONTRACT_ID: optionalString(),
  MULTISIG_GOVERNANCE_CONTRACT_ID: optionalString(),
  SETTLEMENT_NETTER_CONTRACT_ID: optionalString(),
  AGENT_VAULT_CONTRACT_ID: optionalString(),
  POOL_TOKEN_ADDRESS: optionalString(),
  LOAN_MANAGER_ADMIN_SECRET: optionalString(),
  SCORE_RECONCILIATION_SOURCE_SECRET: optionalString(),
  STELLAR_EXPLORER_URL: stringWithDefault('https://stellar.expert/explorer/testnet'),
  STELLAR_USDC_ISSUER: optionalString(),
  STELLAR_EURC_ISSUER: optionalString(),
  STELLAR_PHP_ISSUER: optionalString(),
  PAUSE_STATE_REFRESH_MS: int(30000),

  // Governance
  GOVERNANCE_SIGNERS: list(),
  GOVERNANCE_CURRENT_ADMIN: optionalString(),
  ADMIN_PUBLIC_KEY: optionalString(),
  GOVERNANCE_THRESHOLD: optionalInt(),

  // Loans and scoring
  DEFAULT_TERM_LEDGERS: int(17280),
  DEFAULT_INTEREST_RATE_BPS: int(1200),
  DEFAULT_FEE_RATE_BPS: int(100),
  LEDGER_CLOSE_SECONDS: int(5),
  /**
   * Mirrors `LoanManager::DEFAULT_TERM_LEDGERS` in `contracts/loan_manager/src/lib.rs`.
   * Used to estimate on-chain due ledgers from indexed `LoanApproved` events.
   */
  LOAN_TERM_LEDGERS: positiveInt(17_280),
  DEFAULT_CREDIT_SCORE: optionalInt(),
  SCORE_DELTA_REPAY: int(15),
  SCORE_DELTA_DEFAULT: int(50),
  SCORE_DELTA_LATE: int(5),
  SCORE_DECAY_CRON: stringWithDefault('0 0 * * *'),
  SCORE_DECAY_HALF_LIFE_REPAID: optionalInt(),
  SCORE_DECAY_HALF_LIFE_APPROVED: optionalInt(),
  SCORE_DECAY_HALF_LIFE_DEFAULTED: optionalInt(),

  // Default checker
  DEFAULT_CHECK_BATCH_SIZE: positiveInt(25),
  DEFAULT_CHECK_BATCH_TIMEOUT_MS: positiveInt(5 * 60 * 1000),
  DEFAULT_CHECK_MAX_LOANS_PER_RUN: positiveInt(500),
  DEFAULT_CHECK_POLL_ATTEMPTS: positiveInt(30),
  DEFAULT_CHECK_POLL_SLEEP_MS: positiveInt(1_000),
  DEFAULT_CHECK_CONCURRENCY: positiveInt(3),
  DEFAULT_CHECK_INTERVAL_MS: positiveInt(30 * 60 * 1000),

  // Score reconciliation
  SCORE_RECONCILIATION_BATCH_SIZE: positiveInt(25),
  SCORE_RECONCILIATION_MAX_BORROWERS_PER_RUN: positiveInt(500),
  SCORE_RECONCILIATION_AUTOCORRECT_ENABLED: boolean(false),
  SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD: nonNegativeInt(50),
  SCORE_RECONCILIATION_INTERVAL_MS: positiveInt(60 * 60 * 1000),

  // Cross-contract reconciliation
  CROSS_RECONCILE_MAX_ROWS_PER_RUN: positiveInt(500),
  CROSS_RECONCILE_STALE_ATTEMPTS: positiveInt(3),
  CROSS_RECONCILE_AUTOCORRECT_ENABLED: boolean(false),
  CROSS_RECONCILE_PARTIAL_ALERT_MS: positiveInt(60 * 60 * 1000),
  CROSS_RECONCILE_INTERVAL_MS: positiveInt(5 * 60 * 1000),

  // Indexer
  INDEXER_POLL_INTERVAL_MS: int(30000),
  INDEXER_BATCH_SIZE: int(100),
  /** No shared default: the HTTP indexer uses 0, the managed indexer and health check use 5. */
  INDEXER_FINALITY_DEPTH: optionalInt(),
  INDEXER_LAG_ALERT_THRESHOLD: int(100),
  INDEXER_HEALTH_LAG_LIMIT: int(100),
  QUARANTINE_ALERT_THRESHOLD: positiveInt(25),
  REINDEX_MAX_RANGE: number(25000),

  // Compliance
  KYC_ENFORCEMENT_ENABLED: flag(),
  AML_HIGH_RISK_COUNTRIES: list(),
  AML_REPORTING_THRESHOLD: number(10_000),
  AML_DAILY_TX_LIMIT: number(10),
  COMPLYADVANTAGE_API_KEY: optionalString(),
  COMPLYADVANTAGE_API_URL: stringWithDefault('https://api.complyadvantage.com'),
  COMPLYADVANTAGE_SEARCH_PROFILE: optionalString(),
  SAR_FILING_API_URL: optionalString(),
  SAR_FILING_API_TOKEN: optionalString(),

  // Audit anchoring
  AUDIT_ANCHOR_ENABLED: flag(),
  AUDIT_ANCHOR_CONTRACT_ID: optionalString(),
  AUDIT_ANCHOR_SOURCE_SECRET: optionalString(),

  // PII / privacy
  PII_KEK_KEY: optionalString(),
  PII_KEK_ID: stringWithDefault('default-kek'),
  PII_KMS_ENDPOINT: stringWithDefault(''),
  ANONYMIZATION_HASH_SALT: stringWithDefault('dukapay-anon-default'),

  // Notifications
  TWILIO_ACCOUNT_SID: optionalString(),
  TWILIO_AUTH_TOKEN: optionalString(),
  TWILIO_PHONE_NUMBER: optionalString(),
  SENDGRID_API_KEY: optionalString(),
  FROM_EMAIL: optionalString(),
  ADMIN_EMAIL: optionalString(),
  ADMIN_WEBHOOK_URL: optionalString(),
  NOTIFICATION_RETENTION_DAYS: int(90),
  READ_NOTIFICATION_RETENTION_DAYS: int(30),
  NOTIFICATION_CLEANUP_INTERVAL_MS: int(24 * 60 * 60 * 1000),

  // Webhooks
  WEBHOOK_SECRET: optionalString(),
  WEBHOOK_ROTATION_SECRETS: list(),
  WEBHOOK_REQUEST_TIMEOUT_MS: positiveInt(30 * 1000),
  WEBHOOK_MAX_PAYLOAD_BYTES: positiveInt(64 * 1024),
} satisfies Record<string, z.ZodType>;

export const envSchema = z.object(envShape);

export type Env = z.output<typeof envSchema>;
type EnvKey = keyof Env;

const cache = new Map<EnvKey, { raw: string | undefined; value: unknown }>();

function read<K extends EnvKey>(key: K): Env[K] {
  const rawValue = process.env[key];
  const hit = cache.get(key);
  if (hit && hit.raw === rawValue) return hit.value as Env[K];
  const value = envShape[key].parse(rawValue) as Env[K];
  cache.set(key, { raw: rawValue, value });
  return value;
}

export const env = {} as Readonly<Env>;
for (const key of Object.keys(envShape) as EnvKey[]) {
  Object.defineProperty(env, key, { enumerable: true, get: () => read(key) });
}
