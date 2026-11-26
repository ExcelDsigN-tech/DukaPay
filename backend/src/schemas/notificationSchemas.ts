import { z } from 'zod';

const e164PhoneRegex = /^\+?[1-9]\d{1,14}$/;

const perTypeOverridesSchema = z.record(z.string(), z.boolean()).default({});

// ISO date string validation
const isoDateString = z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'Must be a valid ISO-8601 date string',
});

export const updateNotificationPreferencesSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  phone: z.string().trim().max(20).nullable().optional(),
  perTypeOverrides: perTypeOverridesSchema.optional(),
});

export const notificationPreferencesResponseSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  phone: z.string().nullable(),
  perTypeOverrides: perTypeOverridesSchema,
});

export const getNotificationsQuerySchema = z.object({
  type: z
    .enum([
      'loan_approved',
      'repayment_due',
      'repayment_confirmed',
      'loan_defaulted',
      'score_changed',
    ])
    .optional(),
  status: z.enum(['unread', 'read', 'archived']).optional(),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const markNotificationsReadBodySchema = z
  .object({
    ids: z
      .array(z.number().int('Notification ID must be an integer').positive())
      .max(100, 'Cannot mark more than 100 notifications at once'),
  })
  .strict();

export const emptyNotificationsParamsSchema = z.object({}).strict();
export const emptyNotificationsQuerySchema = z.object({}).strict();
export const emptyNotificationsBodySchema = z.object({}).strict().optional();

export const validateNotificationPhone = (phone: string | null): boolean => {
  if (!phone) return true;
  return e164PhoneRegex.test(phone);
};
