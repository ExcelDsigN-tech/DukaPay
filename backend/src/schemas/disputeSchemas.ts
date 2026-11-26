import { z } from 'zod';

export const DISPUTE_ACTIONS = ['uphold', 'overturn', 'settle', 'confirm', 'reverse'] as const;
export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];

export const disputeActionSchema = z.enum(DISPUTE_ACTIONS);

export const DISPUTE_STATUSES = [
  'pending',
  'resolved',
  'dismissed',
  'open',
  'rejected',
  'all',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const disputeStatusSchema = z.enum(DISPUTE_STATUSES);

export const disputeParamsSchema = z.object({
  disputeId: z.preprocess(
    (val) => (typeof val === 'number' ? String(val) : val),
    z
      .string()
      .regex(/^\d+$/, 'Dispute ID must be a positive integer')
      .refine((val) => Number.parseInt(val, 10) > 0, 'Dispute ID must be a positive integer'),
  ),
});

export const listLoanDisputesQuerySchema = z.object({
  status: disputeStatusSchema.default('open').optional(),
  snapshot_seq: z.string().optional().nullable(),
  cursor: z.string().optional().nullable(),
  limit: z
    .preprocess(
      (val) => (val === undefined || val === null || val === '' ? 50 : val),
      z.coerce
        .number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .transform((val) => Math.min(val, 100)),
    )
    .default(50),
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
});

export const listLoanDisputesSchema = z.object({
  query: listLoanDisputesQuerySchema,
});

export const resolveLoanDisputeBodySchema = z.object({
  action: disputeActionSchema,
  resolution: z
    .string()
    .min(5, 'Resolution reason required')
    .max(1000, 'Resolution cannot exceed 1000 characters'),
  adminNote: z.string().max(500, 'Admin note cannot exceed 500 characters').optional().nullable(),
});

export const resolveLoanDisputeSchema = z.object({
  params: disputeParamsSchema.optional(),
  body: resolveLoanDisputeBodySchema,
});

export const getLoanDisputeSchema = z.object({
  params: disputeParamsSchema,
});

export const rejectLoanDisputeBodySchema = z.object({
  admin_note: z.string().max(500, 'Admin note cannot exceed 500 characters').optional().nullable(),
  adminNote: z.string().max(500, 'Admin note cannot exceed 500 characters').optional().nullable(),
});

export const rejectLoanDisputeSchema = z.object({
  params: disputeParamsSchema.optional(),
  body: rejectLoanDisputeBodySchema.optional(),
});

export type ListLoanDisputesInput = z.infer<typeof listLoanDisputesSchema>;
export type ResolveLoanDisputeInput = z.infer<typeof resolveLoanDisputeSchema>;
export type GetLoanDisputeInput = z.infer<typeof getLoanDisputeSchema>;
export type RejectLoanDisputeInput = z.infer<typeof rejectLoanDisputeSchema>;
