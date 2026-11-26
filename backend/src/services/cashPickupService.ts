import crypto from 'node:crypto';
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { createSorobanRpcServer, getStellarNetworkPassphrase } from '../config/stellar.js';
import { env } from '../config/env.js';
import { query } from '../db/connection.js';
import { AppError } from '../errors/AppError.js';
import { stroopsToAmount } from '../money/decimal.js';
import logger from '../utils/logger.js';
import { notificationService } from './notificationService.js';
import { sorobanService } from './sorobanService.js';

export type ClaimStatus = 'pending_mint' | 'credited' | 'redeemed' | 'failed';

export interface RemittanceClaim {
  id: string;
  remittanceId: string;
  recipientAddress: string;
  agentAddress: string;
  amountStroops: string;
  amount: number;
  status: ClaimStatus;
  redeemCode?: string | null;
  mintTxHash?: string | null;
  burnTxHash?: string | null;
  mintAttempts: number;
  mintError?: string | null;
  creditedAt?: string | null;
  redeemedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClaimRow {
  id: string;
  remittance_id: string;
  recipient_address: string;
  agent_address: string;
  amount_stroops: string;
  status: ClaimStatus;
  redeem_code: string | null;
  mint_tx_hash: string | null;
  burn_tx_hash: string | null;
  mint_attempts: number;
  mint_error: string | null;
  credited_at: Date | null;
  redeemed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const DEFAULT_RETRY_INTERVAL_MS = 60_000;
const MINT_TX_TIMEOUT_SECONDS = 30;
/** Longer than the mint tx time bound plus 30 one-second polls. */
const MINT_LEASE_SECONDS = 120;

function generateOneTimeCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function toClaim(row: ClaimRow, includeCode: boolean): RemittanceClaim {
  return {
    id: row.id,
    remittanceId: row.remittance_id,
    recipientAddress: row.recipient_address,
    agentAddress: row.agent_address,
    amountStroops: String(row.amount_stroops),
    amount: Number(stroopsToAmount(BigInt(row.amount_stroops))),
    status: row.status,
    ...(includeCode ? { redeemCode: row.status === 'credited' ? row.redeem_code : null } : {}),
    mintTxHash: row.mint_tx_hash,
    burnTxHash: row.burn_tx_hash,
    mintAttempts: Number(row.mint_attempts ?? 0),
    mintError: row.mint_error,
    creditedAt: row.credited_at ? new Date(row.credited_at).toISOString() : null,
    redeemedAt: row.redeemed_at ? new Date(row.redeemed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function recordMintFailure(claim: ClaimRow, errorMessage: string): Promise<void> {
  const updated = await query(
    `UPDATE remittance_claims
     SET mint_attempts = mint_attempts + 1,
         mint_error = $2,
         last_mint_attempt_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending_mint'
     RETURNING mint_attempts`,
    [claim.id, errorMessage],
  );
  const attempts = Number(updated.rows[0]?.mint_attempts ?? claim.mint_attempts + 1);
  logger.withContext().error('cash_pickup.mint_float_failed_alert', {
    claimId: claim.id,
    remittanceId: claim.remittance_id,
    attempts,
    error: errorMessage,
  });
}

export const cashPickupService = {
  async createPendingClaim(input: {
    remittanceId: string;
    recipientAddress: string;
    agentAddress: string;
    amountStroops: bigint;
  }): Promise<RemittanceClaim> {
    const result = await query(
      `INSERT INTO remittance_claims
       (remittance_id, recipient_address, agent_address, amount_stroops, status)
       VALUES ($1, $2, $3, $4::numeric, 'pending_mint')
       ON CONFLICT (remittance_id) DO UPDATE SET updated_at = remittance_claims.updated_at
       RETURNING *`,
      [
        input.remittanceId,
        input.recipientAddress,
        input.agentAddress,
        input.amountStroops.toString(),
      ],
    );
    return toClaim(result.rows[0] as ClaimRow, false);
  },

  /**
   * Signs and submits `mint_float(agent, amount)` on `contracts/agent_vault`
   * using `AGENT_VAULT_OPERATOR_SECRET`, following `defaultChecker.ts`.
   * Never credits the recipient unless `mint_float` confirms with `SUCCESS`.
   */
  async mintFloatForClaim(
    claimId: string,
  ): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    // Take a lease on the claim so the retry scheduler, the submit request and
    // other instances never mint it at the same time. The lease outlasts the
    // mint transaction's 30s time bound plus polling.
    const leased = await query(
      `UPDATE remittance_claims
       SET last_mint_attempt_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND status = 'pending_mint'
         AND (last_mint_attempt_at IS NULL
              OR last_mint_attempt_at < NOW() - INTERVAL '${MINT_LEASE_SECONDS} seconds')
       RETURNING *`,
      [claimId],
    );
    const claim = leased.rows[0] as ClaimRow | undefined;
    if (!claim) {
      const current = await query('SELECT status FROM remittance_claims WHERE id = $1', [claimId]);
      const status = current.rows[0]?.status as ClaimStatus | undefined;
      if (!status) return { ok: false, error: 'Claim not found' };
      if (status === 'credited' || status === 'redeemed') return { ok: true };
      return { ok: false, error: 'mint_float already in progress for this claim' };
    }

    const operatorSecret = env.AGENT_VAULT_OPERATOR_SECRET?.trim();
    const contractId = env.AGENT_VAULT_CONTRACT_ID?.trim();
    if (!operatorSecret || !contractId) {
      const msg = !operatorSecret
        ? 'AGENT_VAULT_OPERATOR_SECRET is not configured'
        : 'AGENT_VAULT_CONTRACT_ID is not configured';
      await recordMintFailure(claim, msg);
      return { ok: false, error: msg };
    }

    let signer: Keypair;
    try {
      signer = Keypair.fromSecret(operatorSecret);
    } catch {
      const msg = 'AGENT_VAULT_OPERATOR_SECRET is invalid';
      await recordMintFailure(claim, msg);
      return { ok: false, error: msg };
    }

    try {
      const server = createSorobanRpcServer();

      // An earlier attempt may have landed on-chain after its poll gave up.
      // Settle that transaction before minting again, so a claim is never minted twice.
      if (claim.mint_tx_hash) {
        const previous = await server.getTransaction(claim.mint_tx_hash);
        if (previous.status === 'SUCCESS') {
          return await this.creditClaim(claim, claim.mint_tx_hash);
        }
        // FAILED, or NOT_FOUND after its time bound expired: safe to mint again.
      }

      const passphrase = getStellarNetworkPassphrase() || Networks.TESTNET;
      const account = await server.getAccount(signer.publicKey());

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: contractId,
            function: 'mint_float',
            args: [
              Address.fromString(claim.agent_address).toScVal(),
              nativeToScVal(BigInt(claim.amount_stroops), { type: 'i128' }),
            ],
          }),
        )
        .setTimeout(MINT_TX_TIMEOUT_SECONDS)
        .build();

      const prepared = await server.prepareTransaction(tx);
      prepared.sign(signer);

      const send = await server.sendTransaction(prepared);
      const txHash = send.hash;
      if (!txHash || send.status === 'ERROR' || send.status === 'TRY_AGAIN_LATER') {
        const msg = `mint_float submission rejected: ${send.status ?? 'no hash'}`;
        await recordMintFailure(claim, msg);
        return { ok: false, error: msg };
      }

      // Record the submitted hash before polling, so a retry can settle it.
      await query(
        `UPDATE remittance_claims SET mint_tx_hash = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'pending_mint'`,
        [claim.id, txHash],
      );

      const polled = await server.pollTransaction(txHash, {
        attempts: 30,
        sleepStrategy: () => 1000,
      });

      if (polled.status !== 'SUCCESS') {
        const msg = `mint_float did not confirm: ${polled.status}`;
        await recordMintFailure(claim, msg);
        return { ok: false, error: msg };
      }

      return await this.creditClaim(claim, txHash);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await recordMintFailure(claim, msg);
      return { ok: false, error: msg };
    }
  },

  /** Marks a claim credited after its mint_float confirmed, and notifies the recipient. */
  async creditClaim(
    claim: ClaimRow,
    txHash: string,
  ): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    const code = generateOneTimeCode();
    const updated = await query(
      `UPDATE remittance_claims
       SET status = 'credited',
           mint_tx_hash = $2,
           redeem_code = $3,
           credited_at = NOW(),
           mint_error = NULL,
           mint_attempts = mint_attempts + 1,
           last_mint_attempt_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'pending_mint'
       RETURNING *`,
      [claim.id, txHash, code],
    );

    if (updated.rows[0]) {
      const displayAmount = stroopsToAmount(BigInt(claim.amount_stroops));
      await notificationService.createNotification({
        userId: claim.recipient_address,
        type: 'repayment_confirmed',
        title: 'Cash Pickup Ready',
        message: `Your cash pickup of ${displayAmount} is ready. Use one-time code ${code} at the assigned agent.`,
        actionUrl: '/remittances',
      });
    }

    return { ok: true, txHash };
  },

  async retryPendingMints(limit = 25): Promise<{ attempted: number; succeeded: number }> {
    const pending = await query(
      `SELECT id FROM remittance_claims
       WHERE status = 'pending_mint'
         AND (last_mint_attempt_at IS NULL
              OR last_mint_attempt_at < NOW() - INTERVAL '${MINT_LEASE_SECONDS} seconds')
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );

    if (pending.rows.length === 0) {
      return { attempted: 0, succeeded: 0 };
    }

    // One at a time: every mint is signed by the same operator account, so
    // parallel submissions would collide on its sequence number.
    let succeeded = 0;
    for (const row of pending.rows as Array<{ id: string }>) {
      const result = await this.mintFloatForClaim(row.id);
      if (result.ok) succeeded += 1;
    }

    return { attempted: pending.rows.length, succeeded };
  },

  async getClaimsForRecipient(recipientAddress: string): Promise<RemittanceClaim[]> {
    const result = await query(
      `SELECT * FROM remittance_claims
       WHERE recipient_address = $1
       ORDER BY created_at DESC`,
      [recipientAddress],
    );
    return (result.rows as ClaimRow[]).map((row) => toClaim(row, true));
  },

  async getClaimsForAgent(agentAddress: string): Promise<RemittanceClaim[]> {
    const result = await query(
      `SELECT * FROM remittance_claims
       WHERE agent_address = $1
       ORDER BY created_at DESC`,
      [agentAddress],
    );
    return (result.rows as ClaimRow[]).map((row) => toClaim(row, false));
  },

  async verifyClaimForRedeem(
    claimId: string,
    agentAddress: string,
    code: string,
  ): Promise<ClaimRow> {
    const result = await query('SELECT * FROM remittance_claims WHERE id = $1', [claimId]);
    const claim = result.rows[0] as ClaimRow | undefined;
    if (!claim) {
      throw AppError.notFound('Cash pickup claim not found');
    }
    if (claim.agent_address !== agentAddress) {
      throw AppError.forbidden('You are not the assigned agent for this claim');
    }
    if (claim.status === 'redeemed') {
      throw AppError.conflict('Claim has already been redeemed');
    }
    if (claim.status !== 'credited') {
      throw AppError.badRequest(`Claim is ${claim.status} and cannot be redeemed`);
    }
    const normalizedCode = code.trim().toUpperCase();
    if (!claim.redeem_code || !constantTimeEquals(claim.redeem_code, normalizedCode)) {
      throw AppError.badRequest('Invalid one-time redemption code');
    }
    return claim;
  },

  async buildRedeemBurnFloatTx(claimId: string, agentAddress: string, code: string) {
    const claim = await this.verifyClaimForRedeem(claimId, agentAddress, code);
    const amountStroops = BigInt(claim.amount_stroops);
    const tx = await sorobanService.buildAgentVaultTx(
      agentAddress,
      'burn_float',
      agentAddress,
      amountStroops,
    );
    return {
      claimId: claim.id,
      amountStroops: String(claim.amount_stroops),
      amount: Number(stroopsToAmount(amountStroops)),
      ...tx,
    };
  },

  async confirmRedeemBurnFloat(
    claimId: string,
    agentAddress: string,
    code: string,
    signedTxXdr: string,
  ): Promise<RemittanceClaim> {
    const claim = await this.verifyClaimForRedeem(claimId, agentAddress, code);

    // Exactly burn_float(agent, claim amount) on the agent vault, from the agent.
    sorobanService.validateBurnFloatTx(signedTxXdr, agentAddress, BigInt(claim.amount_stroops));

    // Claim only transitions to redeemed after burn_float confirms on-chain.
    const submitted = await sorobanService.submitSignedTx(signedTxXdr);

    const updated = await query(
      `UPDATE remittance_claims
       SET status = 'redeemed',
           burn_tx_hash = $2,
           redeemed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'credited'
       RETURNING *`,
      [claim.id, submitted.txHash],
    );

    if (!updated.rows[0]) {
      throw AppError.conflict('Claim has already been redeemed');
    }

    return toClaim(updated.rows[0] as ClaimRow, false);
  },
};

export function startCashPickupMintRetryScheduler(intervalMs = DEFAULT_RETRY_INTERVAL_MS): {
  stop: () => void;
} {
  const timer = setInterval(() => {
    cashPickupService.retryPendingMints().catch((error) => {
      logger.withContext().error('cash_pickup.mint_retry_scheduler_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
  };
}
