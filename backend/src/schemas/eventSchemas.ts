import { z } from 'zod';

export const streamEventsQuerySchema = z
  .object({
    borrower: z
      .string()
      .trim()
      .regex(/^G[A-Z0-9]{10,60}$/, 'Invalid borrower Stellar address')
      .optional(),
  })
  .strict();

export const emptyEventParamsSchema = z.object({}).strict();
export const emptyEventQuerySchema = z.object({}).strict();
export const emptyEventBodySchema = z.object({}).strict().optional();
