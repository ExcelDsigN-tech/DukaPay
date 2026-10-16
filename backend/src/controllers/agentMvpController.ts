import type { Request, Response } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { toStroops } from '../money/decimal.js';
import { sorobanService } from '../services/sorobanService.js';
import { AppError } from '../errors/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/connection.js';
import { stroopsToAmount } from '../money/decimal.js';

function publicKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || !StrKey.isValidEd25519PublicKey(value)) {
    throw AppError.badRequest(`${field} must be a valid Stellar public key`);
  }
  return value;
}

function amount(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw AppError.badRequest('amount is required');
  }
  let result: bigint;
  try {
    result = toStroops(String(value));
  } catch {
    throw AppError.badRequest('amount must be a valid positive decimal with up to 7 decimals');
  }
  if (result <= 0n) throw AppError.badRequest('amount must be greater than zero');
  return result;
}

function requireSelf(req: Request, target: string): void {
  if (req.user?.role !== 'admin' && req.user?.publicKey !== target) {
    throw AppError.forbidden('The wallet must match the authenticated wallet');
  }
}

export const registerAgent = asyncHandler(async (req: Request, res: Response) => {
  const agent = publicKey(req.body.agentPublicKey ?? req.user?.publicKey, 'agentPublicKey');
  requireSelf(req, agent);
  const kycRef = typeof req.body.kycRef === 'string' ? req.body.kycRef.trim() : '';
  const region = typeof req.body.region === 'string' ? req.body.region.trim() : '';
  if (!kycRef || !region || kycRef.length > 32 || region.length > 16) {
    throw AppError.badRequest('kycRef and region are required and must be within their length limits');
  }
  let licenseExpiry: bigint;
  try {
    licenseExpiry = BigInt(req.body.licenseExpiry);
  } catch {
    throw AppError.badRequest('licenseExpiry must be an integer timestamp');
  }
  const result = await sorobanService.buildRegisterAgentTx(
    agent,
    kycRef,
    region,
    amount(req.body.bond),
    licenseExpiry,
  );
  res.json({ success: true, ...result });
});

export const activateAgent = asyncHandler(async (req: Request, res: Response) => {
  const agent = publicKey(req.params.agentPublicKey, 'agentPublicKey');
  const result = await sorobanService.buildActivateAgentTx(req.user!.publicKey, agent);
  res.json({ success: true, ...result });
});

export const topUpAgentBond = asyncHandler(async (req: Request, res: Response) => {
  const agent = publicKey(req.params.agentPublicKey, 'agentPublicKey');
  const result = await sorobanService.buildTopUpBondTx(req.user!.publicKey, agent, amount(req.body.amount));
  res.json({ success: true, ...result });
});

export const buildAgentVaultAction = (action: 'deposit_collateral' | 'withdraw_collateral' | 'mint_float' | 'burn_float') =>
  asyncHandler(async (req: Request, res: Response) => {
    const agent = publicKey(req.body.agentPublicKey ?? req.user?.publicKey, 'agentPublicKey');
    requireSelf(req, agent);
    if (action === 'mint_float' && req.user?.role !== 'admin') {
      throw AppError.forbidden('Only an administrator can record a cash-in');
    }
    const source = action === 'mint_float' ? req.user!.publicKey : agent;
    const result = await sorobanService.buildAgentVaultTx(source, action, agent, amount(req.body.amount));
    res.json({ success: true, ...result });
  });

export const getPublicSolvency = asyncHandler(async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT agent_address, float_balance, collateral_balance, is_active
       FROM agent_vaults
      WHERE is_active = true
      ORDER BY agent_address ASC`,
  );
  const agents = result.rows.map((row) => {
    const collateral = stroopsToAmount(row.collateral_balance as string | number | null);
    const float = stroopsToAmount(row.float_balance as string | number | null);
    return {
      agentPublicKey: String(row.agent_address),
      collateral,
      float,
      maxAllowed: collateral,
      holds: float <= collateral,
    };
  });
  const totalCollateral = agents.reduce((sum, agent) => sum + agent.collateral, 0);
  const totalFloat = agents.reduce((sum, agent) => sum + agent.float, 0);
  res.json({
    success: true,
    source: 'indexed-agent-vaults',
    agents,
    totals: { collateral: totalCollateral, float: totalFloat, holds: totalFloat <= totalCollateral },
  });
});

export const submitAgentTransaction = asyncHandler(async (req: Request, res: Response) => {
  const signedTxXdr = req.body?.signedTxXdr;
  if (typeof signedTxXdr !== 'string' || signedTxXdr.length === 0) {
    throw AppError.badRequest('signedTxXdr is required');
  }
  const result = await sorobanService.submitSignedTx(signedTxXdr);
  res.json({ success: true, ...result });
});
