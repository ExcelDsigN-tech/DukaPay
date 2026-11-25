import type { HttpClient } from './http.js';
import { DukaPayError } from './errors.js';
import type {
  Challenge,
  DataExport,
  DepositorPortfolio,
  DsarRequest,
  Loan,
  LoanConfig,
  Notification,
  NotificationEvent,
  Paginated,
  PoolStats,
  Remittance,
  Score,
  Session,
  UnsignedTransaction,
  YieldHistoryPoint,
} from './types.js';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function validateStellarAddress(value: string, label: string): void {
  if (!STELLAR_ADDRESS_RE.test(value)) {
    throw new DukaPayError(`${label} must be a valid Stellar public key (G…)`);
  }
}

export class AuthResource {
  constructor(private http: HttpClient) {}

  /** Step 1 of wallet login: get a message for the wallet to sign. */
  challenge(publicKey: string): Promise<Challenge> {
    return this.http.post('/auth/challenge', { publicKey }, { anonymous: true });
  }

  /** Step 2: exchange the signed challenge for a session token. */
  login(params: { publicKey: string; message: string; signature: string }): Promise<Session> {
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

  list(params: { borrower?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<
    Paginated<Loan>
  > {
    return this.http.get('/loans', { query: params });
  }

  get(loanId: number | string): Promise<Loan> {
    return this.http.get(`/loans/${loanId}`);
  }

  /** Returns an unsigned XDR to be signed by the borrower's wallet. */
  buildRepay(loanId: number | string, amount: string): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-repay`, { amount });
  }

  buildCancel(loanId: number | string): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-cancel`);
  }

  /** Submit a wallet-signed XDR for on-chain execution. */
  submit(loanId: number | string, signedXdr: string): Promise<Loan> {
    return this.http.post(`/loans/${loanId}/submit`, { signedXdr });
  }

  requestLoan(params: { amount: string; borrowerPublicKey: string }): Promise<Loan> {
    return this.http.post('/loans/request', params);
  }

  buildDepositCollateral(
    loanId: number | string,
    params: { amount: string; borrowerPublicKey: string },
  ): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-deposit-collateral`, params);
  }

  buildReleaseCollateral(
    loanId: number | string,
    params: { borrowerPublicKey: string },
  ): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-release-collateral`, params);
  }

  buildRefinance(
    loanId: number | string,
    params: { newAmount: string; newTerm: number; borrowerPublicKey: string },
  ): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-refinance`, params);
  }

  buildExtend(
    loanId: number | string,
    params: { extraLedgers: number; borrowerPublicKey: string },
  ): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-extend`, params);
  }

  /**
   * Contest a defaulted loan. `reason` must be one of the valid dispute reasons
   * accepted by the backend.
   */
  contestDefault(loanId: number | string, reason: string): Promise<Loan> {
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new DukaPayError('contestDefault: reason must be a non-empty string');
    }
    return this.http.post(`/loans/${loanId}/contest-default`, { reason });
  }
}

export class PoolResource {
  constructor(private http: HttpClient) {}

  stats(token?: string): Promise<PoolStats> {
    return this.http.get('/pool/stats', { query: { token } });
  }

  analytics(): Promise<unknown> {
    return this.http.get('/pool/analytics', { anonymous: true });
  }

  depositor(address: string): Promise<DepositorPortfolio> {
    return this.http.get(`/pool/depositor/${address}`);
  }

  yieldHistory(address: string, days: 7 | 30 | 90 = 30, token?: string): Promise<YieldHistoryPoint[]> {
    return this.http.get(`/pool/depositor/${address}/yield-history`, { query: { days, token } });
  }

  sharePrice(token: string): Promise<{ sharePrice: string }> {
    return this.http.get(`/pool/${token}/share-price`);
  }

  buildDeposit(params: { token: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    return this.http.post('/pool/build-deposit', params);
  }

  buildWithdraw(params: { token: string; shares: string; from: string }): Promise<UnsignedTransaction> {
    return this.http.post('/pool/build-withdraw', params);
  }

  buildEmergencyWithdraw(params: {
    depositorPublicKey: string;
    token: string;
    shares: string;
  }): Promise<UnsignedTransaction> {
    return this.http.post('/pool/build-emergency-withdraw', params);
  }
}

export class ScoresResource {
  constructor(private http: HttpClient) {}

  get(address: string): Promise<Score> {
    return this.http.get(`/scores/${address}`);
  }

  leaderboard(limit = 50): Promise<Score[]> {
    return this.http.get('/scores/leaderboard', { query: { limit }, anonymous: true });
  }
}

export class RemittanceResource {
  constructor(private http: HttpClient) {}

  list(params: { sender?: string; recipient?: string } = {}): Promise<Paginated<Remittance>> {
    return this.http.get('/remittance', { query: params });
  }

  get(id: string): Promise<Remittance> {
    return this.http.get(`/remittance/${id}`);
  }

  buildSend(params: { recipient: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    return this.http.post('/remittance/build-send', params);
  }
}

export class NotificationsResource {
  constructor(private http: HttpClient) {}

  list(params: { page?: number; pageSize?: number } = {}): Promise<Paginated<Notification>> {
    return this.http.get('/notifications', { query: params });
  }

  markRead(ids: string[]): Promise<void> {
    return this.http.post('/notifications/mark-read', { ids });
  }

  markAllRead(): Promise<void> {
    return this.http.post('/notifications/mark-all-read');
  }

  /**
   * Open a Server-Sent Events stream for real-time notifications.
   *
   * Parses `event`, `id`, and multi-line `data` fields from the SSE stream.
   * Comment and heartbeat frames (lines starting with `:`) are silently skipped.
   * The stream stops cleanly when `signal` is aborted — the `onEvent` callback
   * will not be called after abort.
   *
   * ```ts
   * const ctrl = new AbortController();
   * await client.notifications.stream((evt) => console.log(evt), { signal: ctrl.signal });
   * // Later:
   * ctrl.abort();
   * ```
   */
  async stream(
    onEvent: (event: NotificationEvent) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const { signal } = options;

    const token =
      typeof (this.http as unknown as { token?: unknown }).token === 'function'
        ? await (this.http as unknown as { token: () => string | null })
            .token()
        : (this.http as unknown as { token?: string }).token;

    const baseUrl = (this.http as unknown as { baseUrl: string }).baseUrl;
    const url = `${baseUrl}/notifications/stream`;

    const res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });

    if (!res.ok) {
      throw new DukaPayError(
        `SSE stream request failed: ${res.status} ${res.statusText}`,
      );
    }

    if (!res.body) {
      throw new DukaPayError('SSE stream: response body is null');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent: Partial<NotificationEvent> = {};

    const flush = () => {
      if (currentEvent.data !== undefined) {
        onEvent(currentEvent as NotificationEvent);
      }
      currentEvent = {};
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trimEnd();

          if (line === '') {
            flush();
            continue;
          }

          if (line.startsWith(':')) continue; // comment / heartbeat

          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;

          const field = line.slice(0, colonIdx);
          const val = line.slice(colonIdx + 1).replace(/^ /, '');

          if (field === 'id') {
            currentEvent.id = val;
          } else if (field === 'event') {
            currentEvent.event = val;
          } else if (field === 'data') {
            try {
              currentEvent.data = JSON.parse(val) as Notification;
            } catch {
              // non-JSON data frame — skip
            }
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) return; // clean stop
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}

export class PrivacyResource {
  constructor(private http: HttpClient) {}

  requestAccess(params: { publicKey: string; reason: string }): Promise<DsarRequest> {
    validateStellarAddress(params.publicKey, 'publicKey');
    return this.http.post('/privacy/dsar/access', params);
  }

  requestDeletion(params: {
    publicKey: string;
    reason: string;
    confirmDeletion: true;
  }): Promise<DsarRequest> {
    validateStellarAddress(params.publicKey, 'publicKey');
    return this.http.post('/privacy/dsar/delete', params);
  }

  anonymize(params: { publicKey: string; reason: string }): Promise<DsarRequest> {
    validateStellarAddress(params.publicKey, 'publicKey');
    return this.http.post('/privacy/anonymize', params);
  }

  getRequest(dsarId: string): Promise<DsarRequest> {
    return this.http.get(`/privacy/dsar/${dsarId}`);
  }

  export(publicKey: string): Promise<DataExport> {
    validateStellarAddress(publicKey, 'publicKey');
    return this.http.get(`/privacy/export/${publicKey}`);
  }
}
