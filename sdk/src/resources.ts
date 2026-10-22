import type { HttpClient } from './http.js';
import type {
  AgentAssignmentsResponse,
  AgentDashboard,
  AgentPairLimitsResponse,
  AmortizationPreview,
  AmortizationSchedule,
  ApproveFloatTransferResponse,
  AssignBorrowerResponse,
  BorrowerLoanStatus,
  BorrowerLoans,
  Challenge,
  DepositorPortfolio,
  InitiateFloatTransferResponse,
  Loan,
  LoanConfig,
  LoanEvents,
  PoolAnalyticsResponse,
  PoolStats,
  RejectFloatTransferResponse,
  RemittanceCreated,
  RemittanceEnvelope,
  RemittanceList,
  RemittanceSubmitResult,
  RemoveBorrowerResponse,
  RepaymentPreview,
  RepayTransaction,
  Score,
  ScoreBreakdown,
  ScoreHistory,
  ScoreNFT,
  Session,
  SetAgentPairLimitsResponse,
  SubmitFloatTransferResponse,
  UnsignedTransaction,
  YieldHistoryPoint,
} from './types.js';
import { ValidationError } from './errors.js';
import {
  validateStellarAddress,
  validateAmount,
  validatePositiveInt,
  validateTokenAmount,
} from './validation.js';

/** Matches the backend's float transfer ID format, so the ID is safe to put in a path. */
function validateTransferId(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new ValidationError(
      `Invalid ${fieldName}: must be 3-128 letters, digits, underscores or hyphens`,
    );
  }
}

export class AuthResource {
  constructor(private http: HttpClient) {}

  /** Step 1 of wallet login: get a message for the wallet to sign. */
  challenge(publicKey: string): Promise<Challenge> {
    validateStellarAddress(publicKey, 'publicKey');
    return this.http.post('/auth/challenge', { publicKey }, { anonymous: true });
  }

  /** Step 2: exchange the signed challenge for a session token. */
  login(params: { publicKey: string; message: string; signature: string }): Promise<Session> {
    validateStellarAddress(params.publicKey, 'publicKey');
    if (!params.message || typeof params.message !== 'string') {
      throw new ValidationError('Invalid message: must be a non-empty string');
    }
    if (!params.signature || typeof params.signature !== 'string') {
      throw new ValidationError('Invalid signature: must be a non-empty string');
    }
    return this.http.post('/auth/login', params, { anonymous: true });
  }

  verify(): Promise<Session> {
    return this.http.get('/auth/verify');
  }

  logout(): Promise<void> {
    return this.http.post('/auth/logout');
  }

  refresh(refreshToken: string): Promise<Session> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new ValidationError('Invalid refreshToken: must be a non-empty string');
    }
    // Anonymous: a 401 here must not trigger another refresh and wait on itself.
    return this.http.post('/auth/refresh', { refreshToken }, { anonymous: true });
  }

  logoutAll(): Promise<void> {
    return this.http.post('/auth/logout-all');
  }

  submitKyc(params: {
    firstName: string;
    lastName: string;
    /** ISO date, YYYY-MM-DD. */
    dateOfBirth?: string;
    /** ISO 3166-1 alpha-2 country code. */
    countryCode: string;
  }): Promise<{ success: boolean; kycId: string }> {
    if (!params.firstName || typeof params.firstName !== 'string') {
      throw new ValidationError('Invalid firstName: must be a non-empty string');
    }
    if (!params.lastName || typeof params.lastName !== 'string') {
      throw new ValidationError('Invalid lastName: must be a non-empty string');
    }
    if (typeof params.countryCode !== 'string' || params.countryCode.trim().length !== 2) {
      throw new ValidationError('Invalid countryCode: must be a 2-letter country code');
    }
    return this.http.post('/auth/kyc', params);
  }
}

export class LoansResource {
  constructor(private http: HttpClient) {}

  config(): Promise<LoanConfig> {
    return this.http.get('/loans/config', { anonymous: true });
  }

  /**
   * Lists the loans of a single borrower.
   *
   * The API exposes loans per borrower (`GET /loans/borrower/{borrower}`), so
   * `borrower` is required and must match the authenticated wallet.
   */
  list(params: {
    borrower: string;
    status?: BorrowerLoanStatus;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }): Promise<BorrowerLoans> {
    validateStellarAddress(params.borrower, 'borrower');
    return this.http.get(`/loans/borrower/${params.borrower}`, {
      query: {
        status: params.status,
        from: params.from,
        to: params.to,
        limit: params.limit,
        cursor: params.cursor,
      },
    });
  }

  get(loanId: number | string): Promise<Loan> {
    validatePositiveInt(loanId, 'loanId');
    return this.http.get(`/loans/${loanId}`);
  }

  /**
   * Returns the unsigned repayment XDR for a loan, to be signed by the
   * borrower's wallet and then passed to {@link LoansResource.submit}.
   *
   * `amount` is in whole tokens (e.g. `250.5` USDC, up to 7 decimal places);
   * the API converts it to stroops. `borrowerPublicKey` must match the
   * authenticated wallet.
   */
  buildRepay(
    loanId: number | string,
    amount: number,
    borrowerPublicKey: string,
  ): Promise<RepayTransaction> {
    validatePositiveInt(loanId, 'loanId');
    validateTokenAmount(amount, 'amount');
    validateStellarAddress(borrowerPublicKey, 'borrowerPublicKey');
    return this.http.post(`/loans/${loanId}/repay`, { amount, borrowerPublicKey });
  }

  buildCancel(loanId: number | string): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-cancel`);
  }

  /** Submit a wallet-signed XDR for on-chain execution. */
  submit(loanId: number | string, signedXdr: string): Promise<Loan> {
    return this.http.post(`/loans/${loanId}/submit`, { signedXdr });
  }

  /**
   * Compute an amortization preview for a loan before applying.
   * Amounts are in whole tokens.
   */
  amortizationPreview(params: { amount: number; termDays: 30 | 60 | 90 }): Promise<AmortizationPreview> {
    validateTokenAmount(params.amount, 'amount');
    if (![30, 60, 90].includes(params.termDays)) {
      throw new ValidationError('Invalid termDays: must be 30, 60 or 90');
    }
    return this.http.post('/loans/amortization-preview', params);
  }

  amortizationSchedule(loanId: number | string): Promise<AmortizationSchedule> {
    validatePositiveInt(loanId, 'loanId');
    return this.http.get(`/loans/${loanId}/amortization-schedule`);
  }

  /**
   * Returns the current repayment preview for an active loan.
   * Amounts are in whole tokens.
   */
  repaymentPreview(loanId: number | string): Promise<RepaymentPreview> {
    validatePositiveInt(loanId, 'loanId');
    return this.http.get(`/loans/${loanId}/repayment-preview`);
  }

  events(loanId: number | string): Promise<LoanEvents> {
    validatePositiveInt(loanId, 'loanId');
    return this.http.get(`/loans/${loanId}/events`);
  }
}

export class PoolResource {
  constructor(private http: HttpClient) {}

  stats(token?: string): Promise<PoolStats> {
    return this.http.get('/pool/stats', { query: { token } });
  }

  /**
   * Aggregate protocol analytics. Public endpoint, cached server-side for 5 minutes.
   *
   * Resolves to the response envelope; read the snapshot from `.analytics`.
   */
  analytics(): Promise<PoolAnalyticsResponse> {
    return this.http.get('/pool/analytics', { anonymous: true });
  }

  depositor(address: string): Promise<DepositorPortfolio> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/pool/depositor/${address}`);
  }

  yieldHistory(address: string, days: 7 | 30 | 90 = 30, token?: string): Promise<YieldHistoryPoint[]> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/pool/depositor/${address}/yield-history`, { query: { days, token } });
  }

  sharePrice(token: string): Promise<{ sharePrice: string }> {
    return this.http.get(`/pool/${token}/share-price`);
  }

  buildDeposit(params: { token: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    validateStellarAddress(params.token, 'token');
    validateAmount(params.amount, 'amount');
    validateStellarAddress(params.from, 'from');
    return this.http.post('/pool/build-deposit', params);
  }

  buildWithdraw(params: { token: string; shares: string; from: string }): Promise<UnsignedTransaction> {
    validateStellarAddress(params.token, 'token');
    validateAmount(params.shares, 'shares');
    validateStellarAddress(params.from, 'from');
    return this.http.post('/pool/build-withdraw', params);
  }
}

export class ScoresResource {
  constructor(private http: HttpClient) {}

  /**
   * Credit score for a wallet. The route is mounted at `/score` (singular) and
   * `userId` is the wallet's Stellar address.
   */
  get(address: string): Promise<Score> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/score/${address}`);
  }

  history(address: string): Promise<ScoreHistory> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/score/${address}/history`);
  }

  nft(address: string): Promise<ScoreNFT> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/score/${address}/nft`);
  }

  breakdown(userId: string): Promise<ScoreBreakdown> {
    validateStellarAddress(userId, 'userId');
    return this.http.get(`/score/${userId}/breakdown`);
  }
}

export class RemittanceResource {
  constructor(private http: HttpClient) {}

  /**
   * Lists the authenticated sender's remittances. The route is mounted at
   * `/remittances` (plural) and paginates with a keyset cursor.
   */
  list(
    params: {
      status?: 'pending' | 'processing' | 'completed' | 'failed';
      from?: string;
      to?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<RemittanceList> {
    return this.http.get('/remittances', { query: params });
  }

  get(id: string): Promise<RemittanceEnvelope> {
    return this.http.get(`/remittances/${id}`);
  }

  /**
   * Creates a remittance and returns the stored record, including the unsigned
   * transaction XDR in `data.xdr`. Sign that XDR and pass it to
   * {@link RemittanceResource.submit} to settle it on-chain.
   *
   * The sender is taken from the authenticated session, so it is not a
   * parameter here.
   */
  buildSend(params: {
    recipient: string;
    amount: number;
    fromCurrency: 'USDC' | 'EURC' | 'PHP';
    toCurrency: 'USDC' | 'EURC' | 'PHP';
    memo?: string;
  }): Promise<RemittanceCreated> {
    validateStellarAddress(params.recipient, 'recipient');
    validatePositiveInt(params.amount, 'amount');
    return this.http.post('/remittances', {
      recipientAddress: params.recipient,
      amount: params.amount,
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      ...(params.memo ? { memo: params.memo } : {}),
    });
  }

  /** Submits the signed XDR for a created remittance. */
  submit(id: string, signedXdr: string): Promise<{ success: boolean; data: RemittanceSubmitResult }> {
    return this.http.post(`/remittances/${id}/submit`, { signedXdr });
  }
}

export class AgentsResource {
  constructor(private http: HttpClient) {}

  /** Lists borrower wallets assigned to the authenticated agent (`GET /agents/my-assignments`). */
  myAssignments(): Promise<AgentAssignmentsResponse> {
    return this.http.get('/agents/my-assignments');
  }

  /** Assigns a borrower wallet to an agent (`POST /agents/{agentPublicKey}/assignees`, admin only). */
  assignBorrower(params: {
    agentPublicKey: string;
    borrowerPublicKey: string;
  }): Promise<AssignBorrowerResponse> {
    validateStellarAddress(params.agentPublicKey, 'agentPublicKey');
    validateStellarAddress(params.borrowerPublicKey, 'borrowerPublicKey');
    if (params.agentPublicKey === params.borrowerPublicKey) {
      throw new ValidationError('agentPublicKey and borrowerPublicKey must be different');
    }
    return this.http.post(`/agents/${params.agentPublicKey}/assignees`, {
      borrowerPublicKey: params.borrowerPublicKey,
    });
  }

  /** Revokes a borrower assignment from an agent (`DELETE /agents/{agentPublicKey}/assignees/{borrowerPublicKey}`, admin only). */
  removeBorrower(params: {
    agentPublicKey: string;
    borrowerPublicKey: string;
  }): Promise<RemoveBorrowerResponse> {
    validateStellarAddress(params.agentPublicKey, 'agentPublicKey');
    validateStellarAddress(params.borrowerPublicKey, 'borrowerPublicKey');
    return this.http.delete(
      `/agents/${params.agentPublicKey}/assignees/${params.borrowerPublicKey}`,
    );
  }

  /** Fetches agent dashboard metrics (`GET /agents/dashboard`). */
  dashboard(): Promise<AgentDashboard> {
    return this.http.get('/agents/dashboard');
  }

  /** Clears the cached agent dashboard snapshot (`DELETE /agents/dashboard/cache`). */
  clearDashboardCache(): Promise<{ success: boolean; message: string }> {
    return this.http.delete('/agents/dashboard/cache');
  }

  /** Initiates an agent-to-agent float transfer (`POST /agents/float-transfer`). */
  initiateFloatTransfer(params: {
    fromAgent: string;
    toAgent: string;
    /** Whole tokens (e.g. 250.5 USDC), up to 7 decimal places. */
    amount: number;
    reason?: string;
  }): Promise<InitiateFloatTransferResponse> {
    validateStellarAddress(params.fromAgent, 'fromAgent');
    validateStellarAddress(params.toAgent, 'toAgent');
    if (params.fromAgent === params.toAgent) {
      throw new ValidationError('fromAgent and toAgent must be different');
    }
    validateTokenAmount(params.amount, 'amount');
    return this.http.post('/agents/float-transfer', {
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      amount: params.amount,
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    });
  }

  /** Approves a pending agent float transfer (`POST /agents/float-transfer/{id}/approve`). */
  approveFloatTransfer(transferId: string): Promise<ApproveFloatTransferResponse> {
    validateTransferId(transferId, 'transferId');
    return this.http.post(`/agents/float-transfer/${transferId}/approve`);
  }

  /** Submits the fully signed float transfer for Stellar confirmation. */
  submitFloatTransfer(
    transferId: string,
    signedTxXdr: string,
  ): Promise<SubmitFloatTransferResponse> {
    validateTransferId(transferId, 'transferId');
    if (typeof signedTxXdr !== 'string' || signedTxXdr.trim().length === 0) {
      throw new ValidationError('signedTxXdr is required');
    }
    return this.http.post(`/agents/float-transfer/${transferId}/submit`, { signedTxXdr });
  }

  /** Rejects a pending agent float transfer (`POST /agents/float-transfer/{id}/reject`). */
  rejectFloatTransfer(transferId: string): Promise<RejectFloatTransferResponse> {
    validateTransferId(transferId, 'transferId');
    return this.http.post(`/agents/float-transfer/${transferId}/reject`);
  }

  /** Retrieves daily and weekly float transfer limits for an agent pair (`GET /agents/float-transfer/limits`). */
  getPairLimits(params: {
    fromAgent: string;
    toAgent: string;
  }): Promise<AgentPairLimitsResponse> {
    validateStellarAddress(params.fromAgent, 'fromAgent');
    validateStellarAddress(params.toAgent, 'toAgent');
    return this.http.get('/agents/float-transfer/limits', {
      query: {
        fromAgent: params.fromAgent,
        toAgent: params.toAgent,
      },
    });
  }

  /** Updates daily and weekly float transfer limits for an agent pair (`PUT /agents/float-transfer/limits`, admin only). */
  setPairLimits(params: {
    fromAgent: string;
    toAgent: string;
    /** Whole tokens (e.g. 250.5 USDC), up to 7 decimal places. */
    dailyLimit: number;
    /** Whole tokens (e.g. 250.5 USDC), up to 7 decimal places. */
    weeklyLimit: number;
  }): Promise<SetAgentPairLimitsResponse> {
    validateStellarAddress(params.fromAgent, 'fromAgent');
    validateStellarAddress(params.toAgent, 'toAgent');
    if (params.fromAgent === params.toAgent) {
      throw new ValidationError('fromAgent and toAgent must be different');
    }
    validateTokenAmount(params.dailyLimit, 'dailyLimit');
    validateTokenAmount(params.weeklyLimit, 'weeklyLimit');
    return this.http.put('/agents/float-transfer/limits', {
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      dailyLimit: params.dailyLimit,
      weeklyLimit: params.weeklyLimit,
    });
  }
}

