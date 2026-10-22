import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import { USER_ROLES } from '../auth/rbac.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number | null };

const mockQuery = jest.fn<(text: string, params?: unknown[]) => Promise<MockQueryResult>>();
jest.unstable_mockModule('../db/connection.js', () => ({ query: mockQuery }));

const {
  assignBorrowerToAgent,
  listAgentAssignments,
  listAssignedBorrowersForAgent,
  removeBorrowerFromAgent,
  resolveAssignedBorrowers,
} = await import('../services/tenantService.js');

const AGENT = Keypair.random().publicKey();
const BORROWER = Keypair.random().publicKey();
const OTHER_BORROWER = Keypair.random().publicKey();
const ADMIN = Keypair.random().publicKey();

const assignmentRow = (borrower: string) => ({
  agent_public_key: AGENT,
  borrower_public_key: borrower,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  created_by: ADMIN,
});

describe('tenantService', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('resolveAssignedBorrowers', () => {
    const unscopedRoles = USER_ROLES.filter((role) => role !== 'agent' && role !== 'lender');

    it.each([...unscopedRoles, undefined])(
      'returns [] for role %s without querying',
      async (role) => {
        await expect(resolveAssignedBorrowers(AGENT, role)).resolves.toEqual([]);
        expect(mockQuery).not.toHaveBeenCalled();
      },
    );

    it.each(['agent', 'lender'] as const)('returns the assigned borrowers for %s', async (role) => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ borrower_public_key: BORROWER }, { borrower_public_key: OTHER_BORROWER }],
      });

      await expect(resolveAssignedBorrowers(AGENT, role)).resolves.toEqual([
        BORROWER,
        OTHER_BORROWER,
      ]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM agent_assignments'), [
        AGENT,
      ]);
    });

    it('returns [] when the query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      await expect(resolveAssignedBorrowers(AGENT, 'agent')).resolves.toEqual([]);
    });
  });

  describe('assignBorrowerToAgent', () => {
    it('inserts the assignment and returns the created row', async () => {
      const row = assignmentRow(BORROWER);
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      await expect(assignBorrowerToAgent(AGENT, BORROWER, ADMIN)).resolves.toEqual(row);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_assignments'),
        [AGENT, BORROWER, ADMIN],
      );
    });

    it('stores created_by as null when no creator is given', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...assignmentRow(BORROWER), created_by: null }] });

      await assignBorrowerToAgent(AGENT, BORROWER);

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [AGENT, BORROWER, null]);
    });

    it('returns the stored row when the assignment already exists', async () => {
      const existing = assignmentRow(BORROWER);
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [existing] });

      await expect(assignBorrowerToAgent(AGENT, BORROWER, ADMIN)).resolves.toEqual(existing);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining('SELECT'), [
        AGENT,
        BORROWER,
      ]);
    });

    it('throws when neither the insert nor the lookup returns a row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

      await expect(assignBorrowerToAgent(AGENT, BORROWER, ADMIN)).rejects.toThrow(
        'Failed to create agent assignment',
      );
    });
  });

  describe('removeBorrowerFromAgent', () => {
    it.each([
      [1, true],
      [0, false],
      [null, false],
    ])('with rowCount %s returns %s', async (rowCount, removed) => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount });

      await expect(removeBorrowerFromAgent(AGENT, BORROWER)).resolves.toBe(removed);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM agent_assignments'),
        [AGENT, BORROWER],
      );
    });
  });

  describe('listAgentAssignments', () => {
    it('returns the agent assignments, newest first', async () => {
      const rows = [assignmentRow(BORROWER), assignmentRow(OTHER_BORROWER)];
      mockQuery.mockResolvedValueOnce({ rows });

      await expect(listAgentAssignments(AGENT)).resolves.toEqual(rows);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), [
        AGENT,
      ]);
    });

    it('returns [] when the agent has no assignments', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(listAgentAssignments(AGENT)).resolves.toEqual([]);
    });
  });

  describe('listAssignedBorrowersForAgent', () => {
    it('maps rows to borrower public keys', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ borrower_public_key: BORROWER }, { borrower_public_key: OTHER_BORROWER }],
      });

      await expect(listAssignedBorrowersForAgent(AGENT)).resolves.toEqual([
        BORROWER,
        OTHER_BORROWER,
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM agent_assignments'), [
        AGENT,
      ]);
    });
  });
});
