import type { Request, Response } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { stroopsToAmount, toStroops } from '../money/decimal.js';
import { sorobanService } from '../services/sorobanService.js';
import { AppError } from '../errors/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/connection.js';
import { env } from '../config/env.js';

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
  if (req.user?.publicKey !== target) {
    throw AppError.forbidden('The wallet must match the authenticated wallet');
  }
}

function requireOperator(req: Request): string {
  const operator = env.AGENT_OPERATOR_PUBLIC_KEY?.trim();
  if (!operator) {
    throw AppError.internal('AGENT_OPERATOR_PUBLIC_KEY is not configured');
  }
  if (req.user?.publicKey !== operator) {
    throw AppError.forbidden('Only the configured agent operator can perform this action');
  }
  return operator;
}

// The registry requires operator auth on `register` so the operator vets each
// agent. Only the operator builds it; the agent then signs the returned XDR.
export const registerAgent = asyncHandler(async (req: Request, res: Response) => {
  requireOperator(req);
  const agent = publicKey(req.body.agentPublicKey, 'agentPublicKey');
  const kycRef = typeof req.body.kycRef === 'string' ? req.body.kycRef.trim() : '';
  const region = typeof req.body.region === 'string' ? req.body.region.trim() : '';
  if (!kycRef || !region || kycRef.length > 32 || region.length > 16) {
    throw AppError.badRequest(
      'kycRef and region are required and must be within their length limits',
    );
  }
  const rawExpiry = req.body.licenseExpiry;
  if (
    (typeof rawExpiry !== 'string' && typeof rawExpiry !== 'number') ||
    !/^[1-9]\d*$/.test(String(rawExpiry))
  ) {
    throw AppError.badRequest('licenseExpiry must be a positive integer timestamp');
  }
  const licenseExpiry = BigInt(rawExpiry);
  if (licenseExpiry <= BigInt(Math.floor(Date.now() / 1000))) {
    throw AppError.badRequest('licenseExpiry must be in the future');
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
  const operator = requireOperator(req);
  const result = await sorobanService.buildActivateAgentTx(operator, agent);
  res.json({ success: true, ...result });
});

export const topUpAgentBond = asyncHandler(async (req: Request, res: Response) => {
  const agent = publicKey(req.params.agentPublicKey, 'agentPublicKey');
  const operator = requireOperator(req);
  const result = await sorobanService.buildTopUpBondTx(operator, agent, amount(req.body.amount));
  res.json({ success: true, ...result });
});

export const buildAgentVaultAction = (
  action: 'deposit_collateral' | 'withdraw_collateral' | 'mint_float' | 'burn_float',
) =>
  asyncHandler(async (req: Request, res: Response) => {
    const agent = publicKey(req.body.agentPublicKey ?? req.user?.publicKey, 'agentPublicKey');
    let source: string;
    if (action === 'mint_float') {
      source = requireOperator(req);
    } else {
      requireSelf(req, agent);
      source = agent;
    }
    const result = await sorobanService.buildAgentVaultTx(
      source,
      action,
      agent,
      amount(req.body.amount),
    );
    res.json({ success: true, ...result });
  });

export const getPublicSolvency = asyncHandler(async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT agent_address, float_balance, collateral_balance, haircut_bps, is_active
       FROM agent_vaults
      WHERE is_active = true
      ORDER BY agent_address ASC`,
  );
  const agents = result.rows.map((row) => {
    const collateralStroops = BigInt(String(row.collateral_balance ?? 0));
    const floatStroops = BigInt(String(row.float_balance ?? 0));
    const haircutBps = BigInt(String(row.haircut_bps ?? 0));
    const maxAllowedStroops = (collateralStroops * haircutBps) / 10_000n;
    const collateral = stroopsToAmount(collateralStroops);
    const float = stroopsToAmount(floatStroops);
    const maxAllowed = stroopsToAmount(maxAllowedStroops);
    return {
      agentPublicKey: String(row.agent_address),
      collateral,
      float,
      maxAllowed,
      holds: floatStroops <= maxAllowedStroops,
      haircutBps: Number(haircutBps),
    };
  });
  const totalCollateralStroops = result.rows.reduce(
    (sum, row) => sum + BigInt(String(row.collateral_balance ?? 0)),
    0n,
  );
  const totalFloatStroops = result.rows.reduce(
    (sum, row) => sum + BigInt(String(row.float_balance ?? 0)),
    0n,
  );
  const totalCollateral = stroopsToAmount(totalCollateralStroops);
  const totalFloat = stroopsToAmount(totalFloatStroops);
  const totalMaxAllowedStroops = result.rows.reduce((sum, row) => {
    const collateral = BigInt(String(row.collateral_balance ?? 0));
    const haircut = BigInt(String(row.haircut_bps ?? 0));
    return sum + (collateral * haircut) / 10_000n;
  }, 0n);
  res.json({
    success: true,
    source: 'indexed-agent-vaults',
    agents,
    totals: {
      collateral: totalCollateral,
      float: totalFloat,
      maxAllowed: stroopsToAmount(totalMaxAllowedStroops),
      holds: totalFloatStroops <= totalMaxAllowedStroops,
    },
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
