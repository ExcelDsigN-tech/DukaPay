/**
 * Domain types for the DukaPay API.
 *
 * These are hand-maintained to match `backend/src/swagger` / the Zod schemas.
 * Run `npm run gen:types` (see README) to regenerate from the live OpenAPI spec
 * once the backend publishes one.
 */

export type Address = string;
/** Integer amount in stroops (1 XLM = 10_000_000 stroops), as a decimal string. */
export type Stroops = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface Challenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface Session {
  token: string;
  expiresAt: string;
  address: Address;
  scopes: string[];
}

// ── Loans ─────────────────────────────────────────────────────────────────────

export type LoanStatus =
  | 'pending'
  | 'active'
  | 'repaid'
  | 'defaulted'
  | 'liquidated'
  | 'cancelled';

export interface Loan {
  id: number;
  borrower: Address;
  principal: Stroops;
  outstanding: Stroops;
  interestRateBps: number;
  status: LoanStatus;
  originatedAt: string;
  dueAt: string | null;
}

export interface LoanConfig {
  minScore: number;
  maxLoanAmount: Stroops;
  minRepayment: Stroops;
  interestRateBps: number;
  defaultTermLedgers: number;
  gracePeriodLedgers: number;
}

/** `status` filter accepted by `GET /loans/borrower/{borrower}`. */
export type BorrowerLoanStatus =
  | 'active'
  | 'repaid'
  | 'defaulted'
  | 'liquidatable'
  | 'pending'
  | 'all';

/** A loan as returned by `GET /loans/borrower/{borrower}`. */
export interface BorrowerLoan {
  loanId: number;
  principal: number;
  accruedInterest: number;
  totalRepaid: number;
  totalOwed: number;
  nextPaymentDeadline: string;
  status: 'active' | 'repaid' | 'defaulted';
  borrower: Address;
  approvedAt?: string | null;
}

/** Response envelope for `GET /loans/borrower/{borrower}`. */
export interface BorrowerLoans {
  success: boolean;
  borrower: Address;
  loans: BorrowerLoan[];
}

/** Response of `POST /loans/{loanId}/repay` — an unsigned XDR to be signed. */
export interface RepayTransaction {
  success: boolean;
  loanId: number;
  unsignedTxXdr: string;
  networkPassphrase: string;
}

/** Base64 XDR transaction envelope the wallet must sign and submit. */
export interface UnsignedTransaction {
  xdr: string;
  network: 'testnet' | 'mainnet';
}

/** Simulation result from transaction simulation before signing. */
export interface SimulationResult {
  /** Estimated fees in stroops. */
  estimatedFee: Stroops;
  /** Whether the transaction would succeed on-chain. */
  success: boolean;
  /** Error message if simulation failed. */
  error?: string;
}

// ── Pool / float ──────────────────────────────────────────────────────────────

export interface PoolStats {
  token: Address;
  totalDeposits: Stroops;
  totalBorrows: Stroops;
  availableLiquidity: Stroops;
  utilizationBps: number;
  supplyApyBps: number;
  borrowApyBps: number;
  sharePrice: Stroops;
}

/** Aggregate protocol analytics from `GET /pool/analytics`. Amounts are numbers, not stroops. */
export interface PoolAnalytics {
  totalDeposits: number;
  totalWithdrawals: number;
  totalYieldDistributed: number;
  totalLoansIssued: number;
  totalVolume: number;
  activeAgents: number;
  /** ISO-8601 timestamp of when the snapshot was computed. */
  updatedAt: string;
}

/**
 * Envelope returned by `GET /pool/analytics`.
 *
 * The endpoint wraps the snapshot, so callers must read `analytics` off the
 * response rather than treating the body as the payload itself. `source`
 * reports whether the snapshot was served from the 300s server-side cache.
 */
export interface PoolAnalyticsResponse {
  success: boolean;
  analytics: PoolAnalytics;
  source: 'cache' | 'database';
}

export interface DepositorPortfolio {
  address: Address;
  token: Address;
  shares: Stroops;
  depositedValue: Stroops;
  currentValue: Stroops;
  netYield: Stroops;
}

export interface YieldHistoryPoint {
  date: string;
  depositedValue: Stroops;
  currentValue: Stroops;
  netYield: Stroops;
}

// ── Scores ────────────────────────────────────────────────────────────────────

export type CreditBand = 'Excellent' | 'Good' | 'Fair' | 'Poor';

/** Explanatory strings the API returns alongside a credit score. */
export interface ScoreFactors {
  repaymentHistory: string;
  latePaymentPenalty: string;
  range: string;
}

/** Response of `GET /score/{userId}`. `userId` is the wallet's Stellar address. */
export interface Score {
  success: boolean;
  userId: Address;
  score: number;
  band: CreditBand;
  factors: ScoreFactors;
}

// ── Remittance ────────────────────────────────────────────────────────────────

export type RemittanceCurrency = 'USDC' | 'EURC' | 'PHP';

/** Status of a remittance record. */
export type RemittanceStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** A remittance record as persisted by the API. */
export interface Remittance {
  id: string;
  senderId: Address;
  recipientAddress: Address;
  amount: number;
  fromCurrency: RemittanceCurrency;
  toCurrency: RemittanceCurrency;
  memo?: string | null;
  status: RemittanceStatus;
  transactionHash?: string | null;
  /** Unsigned transaction XDR generated on creation; sign it, then submit. */
  xdr?: string;
  createdAt: string;
  updatedAt: string;
}

/** Keyset pagination envelope returned by the remittance list endpoint. */
export interface RemittancePage {
  next_cursor: string | null;
  snapshot_seq: string;
  total_at_snapshot: number;
  limit: number;
}

/** Response envelope for `GET /remittances`. */
export interface RemittanceList {
  success: boolean;
  data: Remittance[];
  page: RemittancePage;
}

/** Response envelope for `GET /remittances/{id}`. */
export interface RemittanceEnvelope {
  success: boolean;
  data: Remittance;
}

/** Response envelope for `POST /remittances`. */
export interface RemittanceCreated {
  success: boolean;
  data: Remittance;
  message?: string;
}

/** Response of `POST /remittances/{id}/submit`. */
export interface RemittanceSubmitResult {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  txHash: string;
  message: string;
}

