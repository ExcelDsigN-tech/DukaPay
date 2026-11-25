import type { Request, Response } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { stroopsToAmount, toStroops } from '../money/decimal.js';
import { sorobanService } from '../services/sorobanService.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/connection.js';
import { env } from '../config/env.js';
import {
  decryptField,
  deserializeEncryptedField,
  encryptField,
  serializeEncryptedField,
} from '../services/piiCrypto.js';

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

function translateVaultError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/SolvencyViolated|Error\(Contract, #8\)/.test(message)) {
    return AppError.withCode(ErrorCode.SOLVENCY_VIOLATED);
  }
  if (/InsufficientFloat|Error\(Contract, #7\)/.test(message)) {
    return AppError.withCode(ErrorCode.INSUFFICIENT_FLOAT);
  }
  return error;
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
    let result: Awaited<ReturnType<typeof sorobanService.buildAgentVaultTx>>;
    try {
      result = await sorobanService.buildAgentVaultTx(
        source,
        action,
        agent,
        amount(req.body.amount),
      );
    } catch (error) {
      throw translateVaultError(error);
    }
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

type AgentApplicationRow = {
  id: number;
  agent_public_key: string;
  kyc_ref_encrypted: string;
  region: string;
  bond_stroops: string;
  license_expiry: string;
  status: string;
  registration_xdr: string | null;
  created_at: Date;
  on_chain_status?: string | null;
};

async function decryptApplication(row: AgentApplicationRow, actor: string, req: Request) {
  const encrypted = deserializeEncryptedField(row.kyc_ref_encrypted);
  const requestId = req.headers['x-request-id']?.toString() || 'agent-application-review';
  const kycRef = await decryptField(
    String(row.id),
    'agent_applications.kyc_ref',
    encrypted.ciphertext,
    encrypted.gcm_nonce,
    encrypted.dek_wrapped,
    encrypted.dek_kek_id,
    actor,
    'Review agent application',
    requestId,
  );
  return {
    id: row.id,
    agentPublicKey: row.agent_public_key,
    kycRef,
    region: row.region,
    bondStroops: row.bond_stroops,
    licenseExpiry: row.license_expiry,
    status: row.status,
    registrationTxXdr: row.registration_xdr,
    createdAt: row.created_at,
    onChainStatus: row.on_chain_status ?? null,
  };
}

export const applyAsAgent = asyncHandler(async (req: Request, res: Response) => {
  const agent = req.user?.publicKey;
  if (!agent) throw AppError.unauthorized('Authentication required.');
  const kycRef = String(req.body.kycRef).trim();
  const region = String(req.body.region).trim();
  const bond = amount(req.body.bond);
  const encryptedKycRef = serializeEncryptedField(await encryptField(kycRef));
  const licenseExpiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const result = await query(
    `INSERT INTO agent_applications
       (agent_public_key, kyc_ref_encrypted, region, bond_stroops, license_expiry)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (agent_public_key) DO NOTHING
     RETURNING id, status`,
    [agent, encryptedKycRef, region, bond.toString(), licenseExpiry.toString()],
  );
  if (result.rows.length === 0) {
    throw AppError.conflict('An application already exists for this wallet.');
  }
  res.status(201).json({ success: true, data: result.rows[0] });
});

export const getMyAgentApplication = asyncHandler(async (req: Request, res: Response) => {
  const agent = req.user?.publicKey;
  if (!agent) throw AppError.unauthorized('Authentication required.');
  const result = await query('SELECT * FROM agent_applications WHERE agent_public_key = $1', [
    agent,
  ]);
  if (result.rows.length === 0) {
    res.json({ success: true, data: null });
    return;
  }
  const application = await decryptApplication(result.rows[0] as AgentApplicationRow, agent, req);
  res.json({ success: true, data: application });
});

export const getPendingAgentApplications = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireOperator(req);
  const result = await query(
    `SELECT a.*, v.status AS on_chain_status
     FROM agent_applications a
     LEFT JOIN agent_vaults v ON v.agent_address = a.agent_public_key
     ORDER BY a.created_at ASC`,
  );
  const applications = await Promise.all(
    (result.rows as AgentApplicationRow[]).map((row) => decryptApplication(row, actor, req)),
  );
  res.json({ success: true, data: applications });
});

export const buildApplicationRegistration = asyncHandler(async (req: Request, res: Response) => {
  const operator = requireOperator(req);
  const applicationId = Number(req.params.applicationId);
  const result = await query('SELECT * FROM agent_applications WHERE id = $1', [applicationId]);
  if (result.rows.length === 0) throw AppError.notFound('Agent application not found.');
  const row = result.rows[0] as AgentApplicationRow;
  if (row.status !== 'PENDING') {
    throw AppError.conflict(`Application is already in status '${row.status}'.`);
  }
  const { kycRef } = await decryptApplication(row, operator, req);
  const transaction = await sorobanService.buildRegisterAgentTx(
    row.agent_public_key,
    kycRef,
    row.region,
    BigInt(row.bond_stroops),
    BigInt(row.license_expiry),
  );
  const updated = await query(
    `UPDATE agent_applications
     SET status = 'AWAITING_SIGNATURE', registration_xdr = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING id`,
    [applicationId, transaction.unsignedTxXdr],
  );
  if (updated.rows.length === 0) {
    throw AppError.conflict('Application changed while registration was being built.');
  }
  res.json({ success: true, ...transaction });
});

export const getMyAgentStatus = asyncHandler(async (req: Request, res: Response) => {
  const agent = req.user?.publicKey;
  if (!agent) throw AppError.unauthorized('Authentication required.');
  const result = await query(
    `SELECT status, bond_amount, region, license_expiry, is_active
     FROM agent_vaults WHERE agent_address = $1`,
    [agent],
  );
  res.json({ success: true, data: result.rows[0] ?? null });
});
