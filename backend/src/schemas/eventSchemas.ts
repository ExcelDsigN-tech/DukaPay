import { z } from 'zod';
import { stellarAddressSchema } from './stellarSchemas.js';

export const streamEventsQuerySchema = z
  .object({
    borrower: stellarAddressSchema.optional(),
  })
  .strict();

export const emptyEventParamsSchema = z.object({}).strict();
export const emptyEventQuerySchema = z.object({}).strict();
export const emptyEventBodySchema = z.object({}).strict().optional();
