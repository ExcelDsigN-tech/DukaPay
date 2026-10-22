import { z } from 'zod';
import { contractAddressSchema, stellarAddressSchema } from './stellarSchemas.js';
import { submitTxSchema, positiveAmountSchema } from './loanSchemas.js';

export const buildPoolTransactionSchema = z.object({
  depositorPublicKey: stellarAddressSchema,
  token: contractAddressSchema,
  amount: positiveAmountSchema,
});

export const emergencyWithdrawSchema = z.object({
  depositorPublicKey: stellarAddressSchema,
  token: contractAddressSchema,
  shares: positiveAmountSchema,
});

export const getDepositorYieldHistorySchema = z.object({
  params: z.object({
    address: stellarAddressSchema,
  }),
  query: z.object({
    days: z.coerce
      .number()
      .int()
      .refine((v) => v === 7 || v === 30 || v === 90, {
        message: 'days must be 7, 30, or 90',
      })
      .optional(),
    token: contractAddressSchema.optional(),
  }),
});

export { submitTxSchema };
