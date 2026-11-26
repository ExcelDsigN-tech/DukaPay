import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import type { Express } from 'express';
import {
  disputeActionSchema,
  disputeStatusSchema,
  disputeParamsSchema,
  listLoanDisputesQuerySchema,
  resolveLoanDisputeBodySchema,
  rejectLoanDisputeBodySchema,
  DISPUTE_ACTIONS,
  DISPUTE_STATUSES,
} from '../schemas/disputeSchemas.js';
import { listAuditLogsQuerySchema } from '../schemas/auditSchemas.js';
import { submitRemittanceSchema, getRemittancesSchema } from '../schemas/remittanceSchemas.js';

// Setup environment and mocks for integration tests
process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!';
process.env.INTERNAL_API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';
process.env.ADMIN_WALLETS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  pool: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.unstable_mockModule('../db/transaction.js', () => ({
  withTransaction: jest.fn(),
  withStellarAndDbTransaction: jest.fn(),
}));

let request: typeof import('supertest');
let jwt: typeof import('jsonwebtoken');
let app: Express;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  ({ default: jwt } = await import('jsonwebtoken'));
  ({ default: app } = await import('../app.js'));
});

afterAll(() => {
  jest.restoreAllMocks();
});

const TEST_ADMIN_KEY = 'test-api-key';
const TEST_ADMIN_WALLET = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
const TEST_BORROWER_WALLET = 'GBBD4WTVC4QCTP462F36PBRK335A7VPTG6LMC63567Y2UBLAQMQMQG2P';

process.env.ADMIN_WALLETS = TEST_ADMIN_WALLET;

function mintAdminToken() {
  return jwt.sign(
    { publicKey: TEST_ADMIN_WALLET, role: 'admin', scopes: ['admin:all'] },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

function mintBorrowerToken() {
  return jwt.sign(
    {
      publicKey: TEST_BORROWER_WALLET,
      role: 'borrower',
      scopes: ['write:remittances', 'read:remittances'],
    },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

describe('Dispute and Remittance Validation Rules', () => {
  describe('Dispute Actions Enum', () => {
    it.each(['uphold', 'overturn', 'settle', 'confirm', 'reverse'] as const)(
      'accepts valid action: %s',
      (action) => {
        expect(disputeActionSchema.parse(action)).toBe(action);
      },
    );

    it.each(['reject', 'dismiss', 'cancel', 'unknown', '', 123])(
      'rejects invalid action: %s',
      (invalidAction) => {
        expect(() => disputeActionSchema.parse(invalidAction)).toThrow();
      },
    );

    it('contains all required actions in DISPUTE_ACTIONS', () => {
      expect(DISPUTE_ACTIONS).toContain('uphold');
      expect(DISPUTE_ACTIONS).toContain('overturn');
      expect(DISPUTE_ACTIONS).toContain('settle');
    });
  });

  describe('Dispute Status Enum', () => {
    it.each(['pending', 'resolved', 'dismissed', 'open', 'rejected', 'all'] as const)(
      'accepts valid status: %s',
      (status) => {
        expect(disputeStatusSchema.parse(status)).toBe(status);
      },
    );

    it.each(['closed', 'active', 'processing', 'unknown', ''])(
      'rejects invalid status: %s',
      (invalidStatus) => {
        expect(() => disputeStatusSchema.parse(invalidStatus)).toThrow();
      },
    );

    it('contains all required statuses in DISPUTE_STATUSES', () => {
      expect(DISPUTE_STATUSES).toContain('pending');
      expect(DISPUTE_STATUSES).toContain('resolved');
      expect(DISPUTE_STATUSES).toContain('dismissed');
    });
  });

  describe('resolveLoanDisputeBodySchema', () => {
    it('accepts valid resolution and action', () => {
      const parsed = resolveLoanDisputeBodySchema.parse({
        action: 'uphold',
        resolution: 'Valid resolution message with sufficient length.',
      });
      expect(parsed.action).toBe('uphold');
      expect(parsed.resolution).toBe('Valid resolution message with sufficient length.');
    });

    it('accepts valid adminNote up to 500 characters', () => {
      const note500 = 'a'.repeat(500);
      const parsed = resolveLoanDisputeBodySchema.parse({
        action: 'settle',
        resolution: 'Valid resolution reason.',
        adminNote: note500,
      });
      expect(parsed.adminNote).toBe(note500);
    });

    it('rejects adminNote exceeding 500 characters', () => {
      const note501 = 'a'.repeat(501);
      expect(() =>
        resolveLoanDisputeBodySchema.parse({
          action: 'overturn',
          resolution: 'Valid resolution reason.',
          adminNote: note501,
        }),
      ).toThrow();
    });

    it('accepts resolution up to 1000 characters', () => {
      const res1000 = 'a'.repeat(1000);
      const parsed = resolveLoanDisputeBodySchema.parse({
        action: 'uphold',
        resolution: res1000,
      });
      expect(parsed.resolution).toBe(res1000);
    });

    it('rejects resolution exceeding 1000 characters', () => {
      const res1001 = 'a'.repeat(1001);
      expect(() =>
        resolveLoanDisputeBodySchema.parse({
          action: 'uphold',
          resolution: res1001,
        }),
      ).toThrow();
    });

    it('rejects resolution shorter than 5 characters', () => {
      expect(() =>
        resolveLoanDisputeBodySchema.parse({
          action: 'uphold',
          resolution: 'Four',
        }),
      ).toThrow();
    });

    it('rejects missing or empty resolution', () => {
      expect(() =>
        resolveLoanDisputeBodySchema.parse({
          action: 'uphold',
        }),
      ).toThrow();
    });
  });

  describe('disputeParamsSchema', () => {
    it('accepts positive integer dispute IDs', () => {
      expect(disputeParamsSchema.parse({ disputeId: '10' }).disputeId).toBe('10');
      expect(disputeParamsSchema.parse({ disputeId: 42 }).disputeId).toBe('42');
    });

    it('rejects non-positive and non-integer IDs', () => {
      expect(() => disputeParamsSchema.parse({ disputeId: '0' })).toThrow();
      expect(() => disputeParamsSchema.parse({ disputeId: '-5' })).toThrow();
      expect(() => disputeParamsSchema.parse({ disputeId: 'abc' })).toThrow();
    });
  });

  describe('rejectLoanDisputeBodySchema', () => {
    it('accepts admin note up to 500 chars', () => {
      const note = 'a'.repeat(500);
      expect(rejectLoanDisputeBodySchema.parse({ admin_note: note }).admin_note).toBe(note);
      expect(rejectLoanDisputeBodySchema.parse({ adminNote: note }).adminNote).toBe(note);
    });

    it('rejects admin note exceeding 500 chars', () => {
      const note = 'a'.repeat(501);
      expect(() => rejectLoanDisputeBodySchema.parse({ admin_note: note })).toThrow();
      expect(() => rejectLoanDisputeBodySchema.parse({ adminNote: note })).toThrow();
    });
  });

  describe('listLoanDisputesQuerySchema', () => {
    it('defaults to status=open, limit=50, offset=0', () => {
      const parsed = listLoanDisputesQuerySchema.parse({});
      expect(parsed.status).toBe('open');
      expect(parsed.limit).toBe(50);
      expect(parsed.offset).toBe(0);
    });

    it('accepts valid statuses including pending and dismissed', () => {
      expect(listLoanDisputesQuerySchema.parse({ status: 'pending' }).status).toBe('pending');
      expect(listLoanDisputesQuerySchema.parse({ status: 'dismissed' }).status).toBe('dismissed');
      expect(listLoanDisputesQuerySchema.parse({ status: 'resolved' }).status).toBe('resolved');
    });

    it('rejects invalid status', () => {
      expect(() => listLoanDisputesQuerySchema.parse({ status: 'invalid_status' })).toThrow();
    });

    it('enforces limit bounds and caps above 100', () => {
      expect(listLoanDisputesQuerySchema.parse({ limit: '20' }).limit).toBe(20);
      expect(listLoanDisputesQuerySchema.parse({ limit: '100' }).limit).toBe(100);
      expect(listLoanDisputesQuerySchema.parse({ limit: '500' }).limit).toBe(100);
      expect(() => listLoanDisputesQuerySchema.parse({ limit: '0' })).toThrow();
      expect(() => listLoanDisputesQuerySchema.parse({ limit: '-1' })).toThrow();
      expect(() => listLoanDisputesQuerySchema.parse({ limit: 'not-a-number' })).toThrow();
    });

    it('enforces offset bounds', () => {
      expect(listLoanDisputesQuerySchema.parse({ offset: '0' }).offset).toBe(0);
      expect(listLoanDisputesQuerySchema.parse({ offset: '50' }).offset).toBe(50);
      expect(() => listLoanDisputesQuerySchema.parse({ offset: '-1' })).toThrow();
      expect(() => listLoanDisputesQuerySchema.parse({ offset: '10001' })).toThrow();
    });
  });

  describe('listAuditLogsQuerySchema', () => {
    it('defaults limit to 25 and offset to 0', () => {
      const parsed = listAuditLogsQuerySchema.parse({});
      expect(parsed.limit).toBe(25);
      expect(parsed.offset).toBe(0);
    });

    it('validates limit bounds (1 to 100)', () => {
      expect(listAuditLogsQuerySchema.parse({ limit: '50' }).limit).toBe(50);
      expect(() => listAuditLogsQuerySchema.parse({ limit: '0' })).toThrow();
      expect(() => listAuditLogsQuerySchema.parse({ limit: '101' })).toThrow();
      expect(() => listAuditLogsQuerySchema.parse({ limit: '-5' })).toThrow();
    });

    it('validates offset bounds (0 to 10000)', () => {
      expect(listAuditLogsQuerySchema.parse({ offset: '100' }).offset).toBe(100);
      expect(() => listAuditLogsQuerySchema.parse({ offset: '-1' })).toThrow();
      expect(() => listAuditLogsQuerySchema.parse({ offset: '10001' })).toThrow();
    });

    it('validates ISO date strings for from and to', () => {
      const validDate = '2026-05-01T12:00:00.000Z';
      const parsed = listAuditLogsQuerySchema.parse({ from: validDate, to: validDate });
      expect(parsed.from).toBe(validDate);
      expect(parsed.to).toBe(validDate);

      expect(() => listAuditLogsQuerySchema.parse({ from: 'not-a-date' })).toThrow();
      expect(() => listAuditLogsQuerySchema.parse({ to: 'invalid' })).toThrow();
    });

    it('validates actor and action max-length constraints (255)', () => {
      const validStr = 'a'.repeat(255);
      const invalidStr = 'a'.repeat(256);
      expect(listAuditLogsQuerySchema.parse({ actor: validStr }).actor).toBe(validStr);
      expect(() => listAuditLogsQuerySchema.parse({ actor: invalidStr })).toThrow();
      expect(listAuditLogsQuerySchema.parse({ action: validStr }).action).toBe(validStr);
      expect(() => listAuditLogsQuerySchema.parse({ action: invalidStr })).toThrow();
    });

    it('transforms withTotal correctly', () => {
      expect(listAuditLogsQuerySchema.parse({ withTotal: 'true' }).withTotal).toBe(true);
      expect(listAuditLogsQuerySchema.parse({ withTotal: 'false' }).withTotal).toBe(false);
      expect(listAuditLogsQuerySchema.parse({ withTotal: true }).withTotal).toBe(true);
      expect(listAuditLogsQuerySchema.parse({}).withTotal).toBeUndefined();
    });
  });

  describe('submitRemittanceSchema', () => {
    it('accepts valid remittance id and signedXdr', () => {
      const parsed = submitRemittanceSchema.parse({
        params: { id: 'remittance-uuid-123' },
        body: { signedXdr: 'AAAA...signedXdrPayload...' },
      });
      expect(parsed.params.id).toBe('remittance-uuid-123');
      expect(parsed.body.signedXdr).toBe('AAAA...signedXdrPayload...');
    });

    it('rejects empty or missing signedXdr', () => {
      expect(() =>
        submitRemittanceSchema.parse({
          params: { id: 'remittance-uuid-123' },
          body: { signedXdr: '' },
        }),
      ).toThrow();
      expect(() =>
        submitRemittanceSchema.parse({
          params: { id: 'remittance-uuid-123' },
          body: {},
        }),
      ).toThrow();
    });

    it('rejects empty or missing id', () => {
      expect(() =>
        submitRemittanceSchema.parse({
          params: { id: '' },
          body: { signedXdr: 'AAAA...' },
        }),
      ).toThrow();
    });
  });

  describe('getRemittancesSchema', () => {
    it('accepts valid offset in remittances query', () => {
      const parsed = getRemittancesSchema.parse({
        query: { offset: '20', limit: '10' },
      });
      expect(parsed.query.offset).toBe(20);
      expect(parsed.query.limit).toBe(10);
    });

    it('rejects negative offset in remittances query', () => {
      expect(() =>
        getRemittancesSchema.parse({
          query: { offset: '-5' },
        }),
      ).toThrow();
    });
  });

  describe('HTTP Endpoint Integration Validation', () => {
    it('rejects invalid action with 400 on dispute resolve endpoint', async () => {
      const res = await request(app)
        .post('/api/admin/loan-disputes/1/resolve')
        .set('x-api-key', TEST_ADMIN_KEY)
        .send({
          action: 'invalid_action',
          resolution: 'Valid resolution message.',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects short resolution with 400 on dispute resolve endpoint', async () => {
      const res = await request(app)
        .post('/api/admin/loan-disputes/1/resolve')
        .set('x-api-key', TEST_ADMIN_KEY)
        .send({
          action: 'uphold',
          resolution: 'tiny',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects resolution exceeding 1000 characters with 400 on dispute resolve endpoint', async () => {
      const res = await request(app)
        .post('/api/admin/loan-disputes/1/resolve')
        .set('x-api-key', TEST_ADMIN_KEY)
        .send({
          action: 'uphold',
          resolution: 'x'.repeat(1001),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects adminNote exceeding 500 characters with 400 on dispute resolve endpoint', async () => {
      const res = await request(app)
        .post('/api/admin/loan-disputes/1/resolve')
        .set('x-api-key', TEST_ADMIN_KEY)
        .send({
          action: 'uphold',
          resolution: 'Valid resolution reason.',
          adminNote: 'x'.repeat(501),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid status filter on /api/admin/disputes', async () => {
      const adminToken = mintAdminToken();
      const res = await request(app)
        .get('/api/admin/disputes')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ status: 'invalid_status' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects out-of-bounds limit on /api/admin/audit-logs', async () => {
      const adminToken = mintAdminToken();
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 500 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects negative offset on /api/admin/audit-logs', async () => {
      const adminToken = mintAdminToken();
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ offset: -1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects missing signedXdr on /api/remittances/:id/submit', async () => {
      const borrowerToken = mintBorrowerToken();
      const res = await request(app)
        .post('/api/remittances/123e4567-e89b-12d3-a456-426614174000/submit')
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
