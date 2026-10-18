import { z } from 'zod';

const isoDateString = z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'Must be a valid ISO-8601 date string',
});

export const listAuditLogsQuerySchema = z.object({
  actor: z.string().max(255, 'Actor cannot exceed 255 characters').optional(),
  action: z.string().max(255, 'Action cannot exceed 255 characters').optional(),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  cursor: z.string().optional(),
  limit: z
    .preprocess(
      (val) => (val === undefined || val === null || val === '' ? 25 : val),
      z.coerce
        .number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100'),
    )
    .default(25),
  offset: z
    .preprocess(
      (val) => (val === undefined || val === null || val === '' ? 0 : val),
      z.coerce
        .number()
        .int('Offset must be an integer')
        .min(0, 'Offset must be non-negative')
        .max(10000, 'Offset exceeds maximum limit of 10000'),
    )
    .default(0),
  withTotal: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return val === true || val === 'true';
    }),
});

export const listAuditLogsSchema = z.object({
  query: listAuditLogsQuerySchema,
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;
