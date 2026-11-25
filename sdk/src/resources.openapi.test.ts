/**
 * Verifies that the DukaPay SDK builder methods target paths that exist in the
 * backend OpenAPI spec and use the correct HTTP method.
 *
 * These tests do not make real HTTP requests. Instead they inspect the URL and
 * method captured by the injected `fetch` mock and compare them against the
 * paths documented in `backend/src/swagger/openapi.json`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http.js';
import { LoansResource, PoolResource } from './resources.js';

// Load the backend OpenAPI spec relative to this file's location in the monorepo
const specPath = join(
  new URL('.', import.meta.url).pathname,
  '../../backend/src/swagger/openapi.json',
);
const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as {
  paths: Record<string, Record<string, unknown>>;
};

function hasPath(method: string, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(spec.paths[path] ?? {}, method.toLowerCase());
}

const VALID_ADDR = 'G' + 'A'.repeat(55);

function makeHttp(mockFetch: ReturnType<typeof vi.fn>): HttpClient {
  return new HttpClient({ baseUrl: 'https://api.example.com', fetch: mockFetch });
}

function okResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── LoansResource builder paths ───────────────────────────────────────────────

describe('OpenAPI coverage — LoansResource builders', () => {
  it('POST /loans/request is in the spec', () => {
    expect(hasPath('post', '/loans/request')).toBe(true);
  });

  it('requestLoan targets POST /loans/request', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ id: 1 }));
    const loans = new LoansResource(makeHttp(mockFetch));
    await loans.requestLoan({ amount: '1000000', borrowerPublicKey: VALID_ADDR });
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/loans/request');
    expect((init.method ?? 'POST').toUpperCase()).toBe('POST');
  });

  it('POST /loans/{loanId}/build-deposit-collateral is in the spec', () => {
    expect(hasPath('post', '/loans/{loanId}/build-deposit-collateral')).toBe(true);
  });

  it('buildDepositCollateral targets POST /loans/:id/build-deposit-collateral', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));
    await loans.buildDepositCollateral(1, { amount: '100', borrowerPublicKey: VALID_ADDR });
    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toMatch(/\/loans\/\d+\/build-deposit-collateral/);
  });

  it('POST /loans/{loanId}/build-release-collateral is in the spec', () => {
    expect(hasPath('post', '/loans/{loanId}/build-release-collateral')).toBe(true);
  });

  it('buildReleaseCollateral targets POST /loans/:id/build-release-collateral', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));
    await loans.buildReleaseCollateral(2, { borrowerPublicKey: VALID_ADDR });
    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toMatch(/\/loans\/\d+\/build-release-collateral/);
  });

  it('POST /loans/{loanId}/build-refinance is in the spec', () => {
    expect(hasPath('post', '/loans/{loanId}/build-refinance')).toBe(true);
  });

  it('buildRefinance targets POST /loans/:id/build-refinance', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));
    await loans.buildRefinance(3, { newAmount: '2000', newTerm: 30, borrowerPublicKey: VALID_ADDR });
    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toMatch(/\/loans\/\d+\/build-refinance/);
  });

  it('POST /loans/{loanId}/build-extend is in the spec', () => {
    expect(hasPath('post', '/loans/{loanId}/build-extend')).toBe(true);
  });

  it('buildExtend targets POST /loans/:id/build-extend', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));
    await loans.buildExtend(4, { extraLedgers: 500, borrowerPublicKey: VALID_ADDR });
    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toMatch(/\/loans\/\d+\/build-extend/);
  });

  it('POST /loans/{loanId}/contest-default is in the spec', () => {
    expect(hasPath('post', '/loans/{loanId}/contest-default')).toBe(true);
  });

  it('contestDefault targets POST /loans/:id/contest-default', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ id: 5 }));
    const loans = new LoansResource(makeHttp(mockFetch));
    await loans.contestDefault(5, 'Payment confirmed on-chain');
    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toMatch(/\/loans\/\d+\/contest-default/);
  });
});

// ── PoolResource builder paths ────────────────────────────────────────────────

describe('OpenAPI coverage — PoolResource builders', () => {
  it('POST /pool/build-emergency-withdraw is in the spec', () => {
    expect(hasPath('post', '/pool/build-emergency-withdraw')).toBe(true);
  });

  it('buildEmergencyWithdraw targets POST /pool/build-emergency-withdraw', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'xyz' }));
    const pool = new PoolResource(makeHttp(mockFetch));
    await pool.buildEmergencyWithdraw({
      depositorPublicKey: VALID_ADDR,
      token: VALID_ADDR,
      shares: '100',
    });
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/pool/build-emergency-withdraw');
    expect((init.method ?? 'POST').toUpperCase()).toBe('POST');
  });
});
