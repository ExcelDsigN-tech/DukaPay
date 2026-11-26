import { z } from 'zod';
import { stellarAddressSchema } from './stellarSchemas.js';
import { isPrivateHost, SUPPORTED_WEBHOOK_EVENT_TYPES } from '../services/webhookService.js';

const amountRangeSchema = z
  .string()
  .regex(/^\d+(\.\d+)?,\d+(\.\d+)?$/, 'amount_range must be in min,max format')
  .refine((val) => {
    const [minStr, maxStr] = val.split(',');
    const min = Number(minStr);
    const max = Number(maxStr);
    return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min;
  }, 'amount_range must specify a valid non-negative min,max range');

const dateRangeSchema = z
  .string()
  .regex(/^[^,]+,[^,]+$/, 'date_range must be in start,end format')
  .refine((val) => {
    const [startStr, endStr] = val.split(',');
    const start = Date.parse(startStr ?? '');
    const end = Date.parse(endStr ?? '');
    return !Number.isNaN(start) && !Number.isNaN(end) && start <= end;
  }, 'date_range must contain valid ISO date bounds with start <= end');

export const indexerEventsQuerySchema = z
  .object({
    snapshot_seq: z
      .string()
      .regex(/^\d+$/, 'snapshot_seq must be a non-negative integer')
      .optional(),
    cursor: z.string().min(1, 'cursor cannot be empty').max(256).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    status: z.string().min(1).max(64).optional(),
    eventType: z.string().min(1).max(64).optional(),
    amount_range: amountRangeSchema.optional(),
    date_range: dateRangeSchema.optional(),
    sort: z.string().min(1).max(64).optional(),
  })
  .strict();

export const borrowerEventsParamsSchema = z
  .object({
    borrower: stellarAddressSchema,
  })
  .strict();

export const loanEventsParamsSchema = z
  .object({
    loanId: z.string().regex(/^[1-9]\d*$/, 'Loan ID must be a positive integer'),
  })
  .strict();

export const createWebhookSubscriptionBodySchema = z
  .object({
    callbackUrl: z
      .string()
      .trim()
      .min(1, 'callbackUrl is required')
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return ['http:', 'https:'].includes(parsed.protocol) && !isPrivateHost(parsed.hostname);
        } catch {
          return false;
        }
      }, 'callbackUrl must be a valid public http or https URL'),
    eventTypes: z
      .array(z.enum(SUPPORTED_WEBHOOK_EVENT_TYPES))
      .min(
        1,
        `eventTypes must include at least one of: ${SUPPORTED_WEBHOOK_EVENT_TYPES.join(', ')}`,
      ),
    secret: z.string().min(1).max(256).optional(),
  })
  .strict();

export const webhookSubscriptionParamsSchema = z
  .object({
    subscriptionId: z.string().regex(/^[1-9]\d*$/, 'subscriptionId must be a positive integer'),
  })
  .strict();

export const emptyIndexerParamsSchema = z.object({}).strict();
export const emptyIndexerQuerySchema = z.object({}).strict();
export const emptyIndexerBodySchema = z.object({}).strict().optional();
