import type { HttpClient } from './http.js';
import type {
  AgentAssignmentsResponse,
  AgentDashboard,
  AgentPairLimitsResponse,
  ApproveFloatTransferResponse,
  AssignBorrowerResponse,
  BorrowerLoanStatus,
  BorrowerLoans,
  Challenge,
  DepositorPortfolio,
  InitiateFloatTransferResponse,
  Loan,
  LoanConfig,
  PoolAnalyticsResponse,
  PoolStats,
  RejectFloatTransferResponse,
  RemittanceCreated,
  RemittanceEnvelope,
  RemittanceList,
  RemittanceSubmitResult,
  RemoveBorrowerResponse,
  RepayTransaction,
  Score,
  Session,
  SetAgentPairLimitsResponse,
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

function validatePositiveFloatAmount(value: unknown, fieldName: string): void {
  if (typeof value === 'string') {
    validateAmount(value, fieldName);
    if (parseFloat(value) <= 0) {
      throw new ValidationError(`Invalid ${fieldName}: must be greater than zero`);
    }
    return;
  }
  validateTokenAmount(value, fieldName);
}

function validateNonEmptyId(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Invalid ${fieldName}: must be a non-empty string`);
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
    amount: number | string;
    reason?: string;
  }): Promise<InitiateFloatTransferResponse> {
    validateStellarAddress(params.fromAgent, 'fromAgent');
    validateStellarAddress(params.toAgent, 'toAgent');
    if (params.fromAgent === params.toAgent) {
      throw new ValidationError('fromAgent and toAgent must be different');
    }
    validatePositiveFloatAmount(params.amount, 'amount');
    return this.http.post('/agents/float-transfer', {
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      amount: params.amount,
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
    });
  }

  /** Approves a pending agent float transfer (`POST /agents/float-transfer/{id}/approve`). */
  approveFloatTransfer(transferId: string): Promise<ApproveFloatTransferResponse> {
    validateNonEmptyId(transferId, 'transferId');
    return this.http.post(`/agents/float-transfer/${transferId}/approve`);
  }

  /** Rejects a pending agent float transfer (`POST /agents/float-transfer/{id}/reject`). */
  rejectFloatTransfer(transferId: string): Promise<RejectFloatTransferResponse> {
    validateNonEmptyId(transferId, 'transferId');
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
    dailyLimit: number | string;
    weeklyLimit: number | string;
  }): Promise<SetAgentPairLimitsResponse> {
    validateStellarAddress(params.fromAgent, 'fromAgent');
    validateStellarAddress(params.toAgent, 'toAgent');
    if (params.fromAgent === params.toAgent) {
      throw new ValidationError('fromAgent and toAgent must be different');
    }
    validatePositiveFloatAmount(params.dailyLimit, 'dailyLimit');
    validatePositiveFloatAmount(params.weeklyLimit, 'weeklyLimit');
    return this.http.put('/agents/float-transfer/limits', {
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      dailyLimit: params.dailyLimit,
      weeklyLimit: params.weeklyLimit,
    });
  }
}

