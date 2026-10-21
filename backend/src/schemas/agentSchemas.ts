import { z } from 'zod';
import { positiveAmountSchema } from './loanSchemas.js';
import { stellarAddressSchema } from './stellarSchemas.js';

export const stellarWalletParamSchema = z
  .string()
  .trim()
  .regex(/^G[A-Z2-7]{50,60}$/, 'Invalid Stellar public key');

export const initiateFloatTransferBodySchema = z
  .object({
    fromAgent: stellarAddressSchema,
    toAgent: stellarAddressSchema,
    amount: positiveAmountSchema,
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

const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const submitFloatTransferBodySchema = z
  .object({
    signedTxXdr: z
      .string()
      .min(1, 'signedTxXdr is required')
      .regex(base64Regex, 'Must be a valid base64 string'),
  })
  .strict();

export const pairLimitsQuerySchema = z
  .object({
    fromAgent: stellarAddressSchema,
    toAgent: stellarAddressSchema,
  })
  .strict();

export const setPairLimitsBodySchema = z
  .object({
    fromAgent: stellarAddressSchema,
    toAgent: stellarAddressSchema,
    dailyLimit: positiveAmountSchema,
    weeklyLimit: positiveAmountSchema,
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
