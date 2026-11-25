import type { PoolClient } from '../db/connection.js';
import type { AgentFloatTransferRow } from './agentFloatService.js';

export async function reconcileAgentFloatTransfer(
  client: PoolClient,
  input: {
    txHash: string;
    fromAgent: string;
    toAgent: string;
    status: 'COMPLETED' | 'FAILED';
    actor: string;
  },
): Promise<AgentFloatTransferRow | null> {
  const result = await client.query(
    `UPDATE agent_float_transfers
     SET status = $4, updated_at = NOW()
     WHERE tx_hash = $1
       AND from_agent = $2
       AND to_agent = $3
       AND status = 'AWAITING_SIGNATURE'
     RETURNING *`,
    [input.txHash, input.fromAgent, input.toAgent, input.status],
  );
  const transfer = result.rows[0] as AgentFloatTransferRow | undefined;
  if (!transfer) return null;

  await client.query(
    `INSERT INTO audit_logs (actor, action, target, payload, status, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      input.actor,
      input.status === 'COMPLETED'
        ? 'AGENT_FLOAT_TRANSFER_EXECUTED'
        : 'AGENT_FLOAT_TRANSFER_FAILED',
      `TransferID:${transfer.id}`,
      JSON.stringify({
        fromAgent: transfer.from_agent,
        toAgent: transfer.to_agent,
        amount: transfer.amount,
        txHash: input.txHash,
        executedOnChain: input.status === 'COMPLETED',
      }),
      input.status === 'COMPLETED' ? 200 : 400,
    ],
  );
  return transfer;
}
