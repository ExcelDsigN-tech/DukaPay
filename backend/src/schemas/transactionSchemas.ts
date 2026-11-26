import { z } from 'zod';

export const listMyTransactionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, 'page must be at least 1').optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'limit must be at least 1')
      .max(500, 'limit cannot exceed 500')
      .optional(),
    cursor: z
      .string()
      .regex(/^[1-9]\d*$/, 'cursor must be a positive integer')
      .optional(),
  })
  .strict();

export const emptyTransactionParamsSchema = z.object({}).strict();
export const emptyTransactionBodySchema = z.object({}).strict().optional();
