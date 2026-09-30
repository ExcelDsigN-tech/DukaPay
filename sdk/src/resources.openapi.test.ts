/**
 * resources.openapi.test.ts
 *
 * Contract test: every path the SDK calls must exist in the backend's OpenAPI
 * spec (`backend/src/swagger/openapi.json`, kept in sync by CI's
 * `openapi:validate` job).
 *
 * Unit tests with a mocked HTTP client only assert the SDK's own strings, so a
 * rename or a moved mount on the backend used to ship 404s to integrators while
 * CI stayed green. Driving the real resource classes through a recording fake
 * client and matching the recorded paths against the spec closes that gap.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HttpClient } from './http.js';
import {
  AuthResource,
  LoansResource,
  PoolResource,
  ScoresResource,
  RemittanceResource,
} from './resources.js';

const ADDRESS = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

interface Recorded {
  method: string;
  path: string;
}

/** Records the method + path of every call made through the resources. */
function recordingClient() {
  const calls: Recorded[] = [];
  const record =
    (method: string) =>
    (path: string): Promise<unknown> => {
      calls.push({ method, path });
      return Promise.resolve({});
    };

  const http = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
  } as unknown as HttpClient;

  return { http, calls };
}

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

const specPath = fileURLToPath(
  new URL('../../backend/src/swagger/openapi.json', import.meta.url),
);

function loadSpec(): OpenApiSpec {
  return JSON.parse(readFileSync(specPath, 'utf8')) as OpenApiSpec;
}

/**
 * Turns a concrete request path into the spec's templated form, e.g.
 * `/loans/42/repay` → `/loans/{loanId}/repay`. Returns undefined when no
 * documented path has the same shape.
 */
function toSpecPath(path: string, spec: OpenApiSpec): string | undefined {
  if (spec.paths[path]) return path;

  const segments = path.split('/');
  for (const [specPath, operations] of Object.entries(spec.paths)) {
    const specSegments = specPath.split('/');
    if (specSegments.length !== segments.length) continue;

    const matches = specSegments.every((segment, i) =>
      segment.startsWith('{')
        ? segments[i] !== undefined && segments[i] !== ''
        : segment === segments[i],
    );
    if (matches && Object.keys(operations).length > 0) {
      return specPath;
    }
  }
  return undefined;
}

describe('SDK paths against the backend OpenAPI spec', () => {
  const spec = loadSpec();

  it('loads a spec with paths', () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it('every SDK request maps to a documented endpoint', async () => {
    const { http, calls } = recordingClient();

    const auth = new AuthResource(http);
    const loans = new LoansResource(http);
    const pool = new PoolResource(http);
    const scores = new ScoresResource(http);
    const remittance = new RemittanceResource(http);

    await auth.challenge(ADDRESS);
    await auth.login({ publicKey: ADDRESS, message: 'msg', signature: 'sig' });
    await auth.verify();
    await auth.logout();

    await loans.config();
    await loans.list({ borrower: ADDRESS, status: 'active', limit: 20 });
    await loans.get(42);
    await loans.buildRepay(42, 100, ADDRESS);
    await loans.buildCancel(42);
    await loans.submit(42, 'signed-xdr');

    await pool.stats(ADDRESS);
    await pool.analytics();
    await pool.depositor(ADDRESS);
    await pool.yieldHistory(ADDRESS, 30, ADDRESS);
    await pool.sharePrice(ADDRESS);
    await pool.buildDeposit({ token: ADDRESS, amount: '100', from: ADDRESS });
    await pool.buildWithdraw({ token: ADDRESS, shares: '50', from: ADDRESS });

    await scores.get(ADDRESS);
    await scores.leaderboard();

    await remittance.list({ status: 'pending', limit: 10 });
    await remittance.get('remittance-id');
    await remittance.buildSend({
      recipient: ADDRESS,
      amount: 100,
      fromCurrency: 'USDC',
      toCurrency: 'EURC',
    });
    await remittance.submit('remittance-id', 'signed-xdr');

    // Sanity check on the fixture itself: a renamed SDK method would otherwise
    // silently stop being exercised.
    expect(calls.length).toBeGreaterThanOrEqual(23);

    const mismatches = calls
      .map((call) => {
        const specPath = toSpecPath(call.path, spec);
        const operations = specPath ? spec.paths[specPath] : undefined;
        const documented = operations
          ? Object.keys(operations).some((m) => m.toLowerCase() === call.method.toLowerCase())
          : false;
        return documented ? null : `${call.method} ${call.path}`;
      })
      .filter((mismatch): mismatch is string => mismatch !== null);

    expect(mismatches).toEqual([]);
  });
});
