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
  refreshToken?: string;
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

/** Response of `POST /loans/{loanId}/repay`: an unsigned XDR to be signed. */
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

export interface AmortizationScheduleEntry {
  period: number;
  paymentDate: string;
  principalPayment: number;
  interestPayment: number;
  totalPayment: number;
  remainingBalance: number;
}

export interface AmortizationPreview {
  success: boolean;
  principal: number;
  interestRateBps: number;
  termMonths: number;
  schedule: AmortizationScheduleEntry[];
}

export interface AmortizationSchedule {
  success: boolean;
  loanId: number;
  schedule: AmortizationScheduleEntry[];
}

export interface RepaymentPreview {
  success: boolean;
  loanId: number;
  currentBalance: number;
  accruedInterest: number;
  totalOwed: number;
  nextPaymentDue: string;
}

export interface LoanEvent {
  id: number;
  loanId: number;
  eventType: string;
  amount?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface LoanEvents {
  success: boolean;
  loanId: number;
  events: LoanEvent[];
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

export interface ScoreHistoryPoint {
  score: number;
  timestamp: string;
  reason?: string;
}

export interface ScoreHistory {
  success: boolean;
  walletAddress: Address;
  history: ScoreHistoryPoint[];
}

export interface ScoreNFT {
  success: boolean;
  walletAddress: Address;
  nftId?: string;
  metadata?: {
    score: number;
    band: CreditBand;
    issuedAt: string;
  };
}

export interface ScoreBreakdown {
  success: boolean;
  userId: Address;
  score: number;
  components: {
    repaymentHistory: number;
    loanUtilization: number;
    accountAge: number;
    diversification: number;
  };
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

// ── Agents ────────────────────────────────────────────────────────────────────

/** A borrower wallet assigned to an agent under tenant isolation. */
export interface AgentAssignment {
  borrowerPublicKey: Address;
  createdAt: string;
}

/** Response envelope for `GET /agents/my-assignments`. */
export interface AgentAssignmentsResponse {
  success: boolean;
  data: {
    agentPublicKey: Address;
    assignments: AgentAssignment[];
  };
}

/** Response envelope for `POST /agents/{agentPublicKey}/assignees`. */
export interface AssignBorrowerResponse {
  success: boolean;
  data: {
    agentPublicKey: Address;
    borrowerPublicKey: Address;
    createdAt: string;
  };
}

/** Response envelope for `DELETE /agents/{agentPublicKey}/assignees/{borrowerPublicKey}`. */
export interface RemoveBorrowerResponse {
  success: boolean;
  data: {
    removed: boolean;
  };
}

/** Agent dashboard metrics returned by `GET /agents/dashboard`. */
export interface AgentDashboard {
  agentPublicKey: Address;
  floatUtilization: {
    totalFloat: number;
    allocated: number;
    utilizationPct: number;
  };
  earnings: {
    daily: number;
    weekly: number;
    monthly: number;
    total: number;
  };
  borrowerPortfolio: {
    totalLoans: number;
    activeLoans: number;
    defaultedLoans: number;
    totalOutstanding: number;
    byStatus: Record<string, number>;
  };
  pendingSettlements: {
    count: number;
    totalValue: number;
  };
  collateralRatio: {
    totalCollateral: number;
    totalDebt: number;
    ratio: number;
  };
  recentTransactions: Array<{
    type: string;
    amount: number;
    loanId: string | null;
    timestamp: string;
  }>;
}

export type AgentFloatTransferStatus =
  | 'PENDING_APPROVAL'
  | 'AWAITING_SIGNATURE'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED';

export interface AgentFloatTransfer {
  id: string;
  from_agent: Address;
  to_agent: Address;
  amount: string;
  reason: string | null;
  status: AgentFloatTransferStatus;
  required_approvals: number;
  approval_count: number;
  created_by: Address;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentFloatTransferApproval {
  id: number;
  transfer_id: string;
  approver: Address;
  role: string;
  approved_at: string;
}

/** Response envelope for `POST /agents/float-transfer`. */
export interface InitiateFloatTransferResponse {
  success: boolean;
  data: {
    transfer: AgentFloatTransfer;
    approvals: AgentFloatTransferApproval[];
  };
}

/** Response envelope for `POST /agents/float-transfer/{id}/approve`. */
export interface ApproveFloatTransferResponse {
  success: boolean;
  data: {
    transfer: AgentFloatTransfer;
    approvals: AgentFloatTransferApproval[];
    executedOnChain: false;
    unsignedTxXdr?: string;
  };
}

/** Response envelope for `POST /agents/float-transfer/{id}/submit`. */
export interface SubmitFloatTransferResponse {
  success: boolean;
  data: {
    transfer: AgentFloatTransfer;
    executedOnChain: true;
    txHash: string;
  };
}

/** Response envelope for `POST /agents/float-transfer/{id}/reject`. */
export interface RejectFloatTransferResponse {
  success: boolean;
  data: {
    transfer: AgentFloatTransfer;
  };
}

export interface AgentPairLimits {
  dailyLimit: number;
  weeklyLimit: number;
}

/** Response envelope for `GET /agents/float-transfer/limits`. */
export interface AgentPairLimitsResponse {
  success: boolean;
  data: AgentPairLimits;
}

/** Response envelope for `PUT /agents/float-transfer/limits`. */
export interface SetAgentPairLimitsResponse {
  success: boolean;
  data: AgentPairLimits & {
    fromAgent: Address;
    toAgent: Address;
  };
}

