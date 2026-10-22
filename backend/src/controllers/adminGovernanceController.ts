import type { Request, Response } from 'express';
import { query } from '../db/connection.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

type GovernanceRow = {
  proposal_id?: string;
  proposed_admin?: string;
  approval_count?: number | string;
  threshold?: number | string;
  executable_at?: string | Date | null;
  expires_at?: string | Date | null;
  signer_address?: string | null;
  approved?: boolean | null;
};

function parseSignersFromEnv() {
  return env.GOVERNANCE_SIGNERS.map((address) => ({ address, approved: false }));
}

export const getPendingGovernance = asyncHandler(async (_req: Request, res: Response) => {
  const currentAdmin = env.GOVERNANCE_CURRENT_ADMIN ?? env.ADMIN_PUBLIC_KEY ?? null;
  const targetContract = env.MULTISIG_GOVERNANCE_CONTRACT_ID ?? null;
  const threshold = env.GOVERNANCE_THRESHOLD || 0;

  try {
    const result = await query(
      `SELECT
           proposal_id,
           proposed_admin,
           approval_count,
           threshold,
           executable_at,
           expires_at,
           signer_address,
           approved
         FROM multisig_governance_pending
         ORDER BY proposal_id DESC`,
    );

    if (result.rows.length > 0) {
      const first = result.rows[0] as GovernanceRow;
      res.json({
        currentAdmin,
        targetContract,
        pendingProposal: {
          id: first.proposal_id,
          proposedAdmin: first.proposed_admin,
          approvalCount: Number(first.approval_count ?? 0),
          threshold: Number(first.threshold ?? threshold),
          executableAt: first.executable_at,
          expiresAt: first.expires_at,
          signers: result.rows
            .filter((row: GovernanceRow) => row.signer_address)
            .map((row: GovernanceRow) => ({
              address: row.signer_address,
              approved: Boolean(row.approved),
            })),
        },
      });
      return;
    }
  } catch {
    // The contract-facing index table is optional in early deployments.
  }

  res.json({
    currentAdmin,
    targetContract,
    pendingProposal: null,
    signers: parseSignersFromEnv(),
    threshold,
  });
});
