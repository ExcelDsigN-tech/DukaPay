import { z } from 'zod';
import { toWholeStroops } from '../money/decimal.js';

const STROOP_INTEGER_STRING = /^[1-9]\d*$/;

/**
 * Validates a money input as a positive integer stroop string (preferred) or a
 * positive safe integer in stroops, routing conversion through `toWholeStroops`
 * without `Number()` precision loss.
 */
export const stroopAmountSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(STROOP_INTEGER_STRING, 'Amount must be a positive integer stroop string'),
    z
      .number()
      .int('Amount must be a whole integer in stroops')
      .positive('Amount must be greater than zero')
      .refine((val) => Number.isSafeInteger(val), {
        message: 'Numeric amount exceeds MAX_SAFE_INTEGER; pass a stroop string instead',
      }),
  ])
  .refine(
    (val) => {
      try {
        return toWholeStroops(String(val)) > 0n;
      } catch {
        return false;
      }
    },
    { message: 'Amount must be a valid positive stroop value' },
  );

export const agentAddressSchema = z
  .string()
  .trim()
  .regex(/^G[A-Z0-9]{10,60}$/, 'Invalid Stellar agent public key');

export const stellarWalletParamSchema = z
  .string()
  .trim()
  .regex(/^G[A-Z2-7]{50,60}$/, 'Invalid Stellar public key');

export const initiateFloatTransferBodySchema = z
  .object({
    fromAgent: agentAddressSchema,
    toAgent: agentAddressSchema,
    amount: stroopAmountSchema,
    reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
  })
  .strict();

export const floatTransferIdParamsSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,128}$/, 'Invalid transfer ID format'),
  })
  .strict();

export const pairLimitsQuerySchema = z
  .object({
    fromAgent: agentAddressSchema,
    toAgent: agentAddressSchema,
  })
  .strict();

export const setPairLimitsBodySchema = z
  .object({
    fromAgent: agentAddressSchema,
    toAgent: agentAddressSchema,
    dailyLimit: stroopAmountSchema,
    weeklyLimit: stroopAmountSchema,
  })
  .strict();

export const agentPublicKeyParamsSchema = z
  .object({
    agentPublicKey: stellarWalletParamSchema,
  })
  .strict();

export const assignBorrowerBodySchema = z
  .object({
    borrowerPublicKey: stellarWalletParamSchema,
  })
  .strict();

export const removeBorrowerParamsSchema = z
  .object({
    agentPublicKey: stellarWalletParamSchema,
    borrowerPublicKey: stellarWalletParamSchema,
  })
  .strict();

export const emptyAgentParamsSchema = z.object({}).strict();
export const emptyAgentQuerySchema = z.object({}).strict();
export const emptyAgentBodySchema = z.object({}).strict().optional();
