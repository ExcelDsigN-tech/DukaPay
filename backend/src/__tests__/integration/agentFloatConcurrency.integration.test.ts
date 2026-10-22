import { describe, it, expect, afterAll, beforeEach, jest } from '@jest/globals';
import { closePool, query } from '../../db/connection.js';

// The locking and claim logic only means something against a real Postgres,
// so this suite is gated like the other DB-backed integration suites.
const describeIfDb = process.env.INTEGRATION_TESTS === 'true' ? describe : describe.skip;

// The Soroban build call is an external RPC boundary; everything else runs
// against the real schema.
const mockBuildTransferToAgentTx = jest.fn(async () => ({
  unsignedTxXdr: 'xdr_concurrency_test',
}));

jest.unstable_mockModule('../../services/sorobanService.js', () => ({
  sorobanService: {
    buildTransferToAgentTx: mockBuildTransferToAgentTx,
  },
}));

// approveTransfer fails closed without AGENT_VAULT_CONTRACT_ID, which CI sets
// in the migration-check job.
const { agentFloatService } = await import('../../services/agentFloatService.js');

describeIfDb('Integration: agent float transfer concurrency against real schema', () => {
  const AGENT_A = 'G_FLOAT_CONCURRENCY_AGENT_A';
  const AGENT_B = 'G_FLOAT_CONCURRENCY_AGENT_B';
  const ADMIN_ONE = 'G_FLOAT_CONCURRENCY_ADMIN_ONE';
  const ADMIN_TWO = 'G_FLOAT_CONCURRENCY_ADMIN_TWO';
  const actors = [AGENT_A, AGENT_B, ADMIN_ONE, ADMIN_TWO];

  const cleanup = async () => {
    await query(
      `DELETE FROM agent_float_transfers WHERE from_agent = ANY($1::text[]) OR to_agent = ANY($1::text[])`,
      [actors],
    );
    await query(`DELETE FROM agent_float_transfer_limits WHERE from_agent = $1 AND to_agent = $2`, [
      AGENT_A,
      AGENT_B,
    ]);
  };

  const setPairLimits = async (dailyLimit: number, weeklyLimit: number) => {
    await query(
      `INSERT INTO agent_float_transfer_limits (from_agent, to_agent, daily_limit, weekly_limit, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (from_agent, to_agent)
       DO UPDATE SET daily_limit = EXCLUDED.daily_limit, weekly_limit = EXCLUDED.weekly_limit, updated_at = NOW()`,
      [AGENT_A, AGENT_B, dailyLimit, weeklyLimit],
    );
  };

  afterAll(async () => {
    await cleanup();
    await closePool();
  });
  beforeEach(async () => {
    mockBuildTransferToAgentTx.mockClear();
    await cleanup();
    await setPairLimits(1000, 10000);
  });

  it('never lets concurrent initiations for one pair exceed the daily limit', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        agentFloatService.initiateTransfer({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          amount: 300,
          createdBy: AGENT_A,
          userRole: 'agent',
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    // 1000 daily limit / 300 per transfer: exactly three can pass.
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(String(r.reason?.message)).toMatch(/daily limit/);
    }

    const totals = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM agent_float_transfers
       WHERE from_agent = $1 AND to_agent = $2`,
      [AGENT_A, AGENT_B],
    );
    expect(Number(totals.rows[0]?.total)).toBe(900);
  });

  it('executes a transfer at most once when approvals race to the threshold', async () => {
    const { transfer } = await agentFloatService.initiateTransfer({
      fromAgent: AGENT_A,
      toAgent: AGENT_B,
      amount: 100,
      createdBy: AGENT_A,
      userRole: 'agent',
    });

    // The duplicate AGENT_B approval must be rejected by the locked
    // already-approved check, and only one approval may claim execution.
    await Promise.allSettled([
      agentFloatService.approveTransfer({ transferId: transfer.id, approver: AGENT_B }),
      agentFloatService.approveTransfer({
        transferId: transfer.id,
        approver: ADMIN_ONE,
        userRole: 'admin',
      }),
      agentFloatService.approveTransfer({ transferId: transfer.id, approver: AGENT_B }),
    ]);

    expect(mockBuildTransferToAgentTx).toHaveBeenCalledTimes(1);

    const row = await query(
      `SELECT status, approval_count FROM agent_float_transfers WHERE id = $1`,
      [transfer.id],
    );
    expect(row.rows[0]).toMatchObject({ status: 'AWAITING_SIGNATURE' });
    expect(Number(row.rows[0]?.approval_count)).toBeGreaterThanOrEqual(2);
  });

  it('does not let two admin approvals complete a transfer', async () => {
    const { transfer } = await agentFloatService.initiateTransfer({
      fromAgent: AGENT_A,
      toAgent: AGENT_B,
      amount: 100,
      createdBy: ADMIN_ONE,
      userRole: 'admin',
    });

    await expect(
      agentFloatService.approveTransfer({
        transferId: transfer.id,
        approver: ADMIN_TWO,
        userRole: 'admin',
      }),
    ).rejects.toThrow(/Only one admin approval/);

    const row = await query(
      `SELECT status, approval_count FROM agent_float_transfers WHERE id = $1`,
      [transfer.id],
    );
    expect(row.rows[0]).toMatchObject({ status: 'PENDING_APPROVAL' });
    expect(Number(row.rows[0]?.approval_count)).toBe(1);
    expect(mockBuildTransferToAgentTx).not.toHaveBeenCalled();
  });
});
