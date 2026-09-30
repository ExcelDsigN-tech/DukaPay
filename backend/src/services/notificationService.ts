import { query } from '../db/connection.js';
import logger from '../utils/logger.js';
import type { Response } from 'express';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'loan_approved'
  | 'repayment_due'
  | 'repayment_confirmed'
  | 'loan_defaulted'
  | 'loan_liquidated'
  | 'score_changed';

export type NotificationStatus = 'unread' | 'read' | 'archived';

export interface Notification {
  id: number;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number | undefined;
  actionUrl?: string | null;
  read: boolean;
  status: NotificationStatus;
  createdAt: Date;
}

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number | undefined;
  actionUrl?: string | undefined | null;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  phone: string | null;
  perTypeOverrides: Record<string, boolean>;
  digestFrequency?: 'off' | 'daily' | 'weekly';
}

// ─── SSE subscriber registry ────────────────────────────────────────────────────────────────────────
// Maps userId → set of SSE response streams currently listening.
// No persistence needed — streams are in-process only.

type SseClient = Response;
const sseClients = new Map<string, Set<SseClient>>();

// Lazy-init Twilio client — dynamic import avoids ESM/CJS interop issues in tests
async function getTwilioClient() {
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    return null;
  }
  const { default: twilio } = await import('twilio');
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// Lazy-init SendGrid — called once on first sendEmail
let _sgInitialized = false;
async function ensureSendGrid() {
  if (_sgInitialized) return;
  _sgInitialized = true;
  if (process.env.SENDGRID_API_KEY) {
    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(process.env.SENDGRID_API_KEY);
  }
}

function buildEmailTemplate(
  type: NotificationType,
  message: string,
): { subject: string; html: string } {
  const templates: Record<NotificationType, { subject: string; html: string }> = {
    loan_approved: {
      subject: 'Your loan has been approved — DukaPay',
      html: `<h2>Loan Approved</h2><p>${message}</p><p>Log in to view your loan details and repayment schedule.</p>`,
    },
    repayment_due: {
      subject: 'Repayment reminder — DukaPay',
      html: `<h2>Repayment Due Soon</h2><p>${message}</p><p>Please ensure funds are available to avoid a default.</p>`,
    },
    repayment_confirmed: {
      subject: 'Repayment confirmed — DukaPay',
      html: `<h2>Repayment Confirmed</h2><p>${message}</p><p>Thank you for your payment.</p>`,
    },
    loan_defaulted: {
      subject: 'Loan default notice — DukaPay',
      html: `<h2>Loan Defaulted</h2><p>${message}</p><p>Contact support immediately if you believe this is an error.</p>`,
    },
    loan_liquidated: {
      subject: 'Your loan has been liquidated — DukaPay',
      html: `<h2>Loan Liquidated</h2><p>${message}</p><p>Contact support if you have questions about the outcome.</p>`,
    },
    score_changed: {
      subject: 'Your credit score has changed — DukaPay',
      html: `<h2>Credit Score Update</h2><p>${message}</p><p>Log in to see your updated score and history.</p>`,
    },
  };

  return templates[type];
}

async function sendEmail(email: string, message: string, type?: NotificationType): Promise<void> {
  const fromEmail = process.env.FROM_EMAIL;
  const maskedEmail = email.replace(/(.{2}).*(@.*)/, '$1***$2');

  if (!fromEmail) {
    logger.withContext().info('[Email] FROM_EMAIL not set', { email: maskedEmail, message });
    return;
  }

  await ensureSendGrid();

  if (!process.env.SENDGRID_API_KEY) {
    logger
      .withContext()
      .info(`[Email] SendGrid not configured. Would send to ${maskedEmail}: ${message}`);
    return;
  }

  const template = type
    ? buildEmailTemplate(type, message)
    : { subject: 'Notification from DukaPay', html: `<p>${message}</p>` };

  try {
    const sgMail = await import('@sendgrid/mail');
    await sgMail.default.send({
      to: email,
      from: fromEmail,
      subject: template.subject,
      html: template.html,
    });
    logger.withContext().info(`[Email] Sent to ${maskedEmail}`, { subject: template.subject });
  } catch (error) {
    logger.withContext().error(`[Email] SendGrid failed for ${maskedEmail}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // Swallow error — email failure must not break the main flow
  }
}

async function sendSMS(phone: string, message: string) {
  const maskedPhone = phone.length > 4 ? '+xx...****' + phone.slice(-2) : '****';
  const twilioClient = await getTwilioClient();
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
    logger
      .withContext()
      .warn(`[SMS] Twilio not configured. Would send to ${maskedPhone}`, { message });
    return;
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
    logger.withContext().info(`[SMS] Sent to ${maskedPhone}`, { sid: result.sid });
  } catch (error) {
    logger.withContext().error(`[SMS] Failed to send to ${maskedPhone}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // Swallow error - don't fail the notification creation
  }
}

class NotificationService {
  async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const result = await query(
      `SELECT email_enabled, sms_enabled, phone
       FROM user_profiles
       WHERE public_key = $1
       LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return {
        emailEnabled: false,
        smsEnabled: false,
        phone: null,
        perTypeOverrides: {},
      };
    }

    const row = result.rows[0];
    return {
      emailEnabled: Boolean(row.email_enabled),
      smsEnabled: Boolean(row.sms_enabled),
      phone: (row.phone as string | null) ?? null,
      perTypeOverrides: {},
    };
  }

  async updateNotificationPreferences(
    userId: string,
    payload: Pick<NotificationPreferences, 'emailEnabled' | 'smsEnabled' | 'phone'>,
  ): Promise<NotificationPreferences> {
    const result = await query(
      `UPDATE user_profiles
       SET email_enabled = $2,
           sms_enabled = $3,
           phone = $4
       WHERE public_key = $1
       RETURNING email_enabled, sms_enabled, phone`,
      [userId, payload.emailEnabled, payload.smsEnabled, payload.phone],
    );

    const row = result.rows[0] ?? {
      email_enabled: payload.emailEnabled,
      sms_enabled: payload.smsEnabled,
      phone: payload.phone,
    };

    return {
      emailEnabled: Boolean(row.email_enabled),
      smsEnabled: Boolean(row.sms_enabled),
      phone: (row.phone as string | null) ?? null,
      perTypeOverrides: {},
    };
  }

  /**
   * Persists a new notification and pushes it to any active SSE subscribers
   * for that user.
   */
  async createNotification(params: CreateNotificationParams): Promise<Notification> {
    const { userId, type, title, message, loanId, actionUrl } = params;

    const resolvedActionUrl = actionUrl ?? (loanId != null ? `/loans/${loanId}` : null);

    const result = await query(
      `INSERT INTO notifications (user_id, type, title, message, loan_id, action_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unread')
       RETURNING id, user_id, type, title, message, loan_id, action_url, read, status, created_at`,
      [userId, type, title, message, loanId ?? null, resolvedActionUrl],
    );

    const notification = this.mapRow(result.rows[0]);
    this.broadcast(userId, notification);

    // Also trigger external notifications
    await this.notifyUserExternal(userId, message, type);

    return notification;
  }

  /**
   * Batches repayment_due notifications per user based on digest frequency.
   * Returns grouped notifications by user and digest frequency.
   */
  async batchRepaymentNotificationsForDigest(
    notifications: Array<{ userId: string; message: string; loanId?: number }>,
  ): Promise<Map<string, Array<{ userId: string; message: string; loanId?: number }>>> {
    const grouped = new Map<string, Array<{ userId: string; message: string; loanId?: number }>>();

    // Batch-prefetch all digest preferences in a single query instead of one
    // round-trip per notification (fixes the N+1 on
    // user_notification_preferences for large repayment batches).
    const userIds = [...new Set(notifications.map((n) => n.userId))];
    const prefMap = new Map<string, string>();
    if (userIds.length > 0) {
      const placeholders = userIds.map((_, i) => `${i + 1}`).join(', ');
      const prefResult = await query(
        `SELECT user_id, digest_frequency FROM user_notification_preferences
         WHERE user_id IN (${placeholders})`,
        userIds,
      );
      for (const row of prefResult.rows) {
        prefMap.set(String(row.user_id), row.digest_frequency);
      }
    }

    for (const notif of notifications) {
      const digestFrequency = prefMap.get(notif.userId) ?? 'off';

      if (digestFrequency === 'off') {
        // Send immediately
        const key = `${notif.userId}:immediate`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(notif);
      } else {
        // Batch for daily or weekly digest
        const key = `${notif.userId}:${digestFrequency}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(notif);
      }
    }

    return grouped;
  }

  /**
   * Sends external notifications (Email/SMS) based on user preferences.
   * SMS is triggered for repayment_due and loan_defaulted events.
   */
  private async notifyUserExternal(userId: string, message: string, type: NotificationType) {
    try {
      const result = await query(
        `SELECT email, phone, email_enabled, sms_enabled 
         FROM user_profiles 
         WHERE public_key = $1`,
        [userId],
      );

      if (result.rows.length === 0) return;

      const user = result.rows[0];

      if (user.email_enabled && user.email) {
        await sendEmail(user.email, message, type);
      }

      // Trigger SMS for critical events: repayment_due, loan_defaulted, and loan_liquidated
      const smsEnabledForType =
        type === 'repayment_due' || type === 'loan_defaulted' || type === 'loan_liquidated';

      if (user.sms_enabled && user.phone && smsEnabledForType) {
        await sendSMS(user.phone, message);
      }
    } catch (error) {
      logger.withContext().error('Error sending external notifications', { userId, error });
    }
  }

  /**
   * Returns the most recent notifications for a user (newest first).
   * Supports filtering by type, status, and date range.
   */
  async getNotificationsForUser(
    userId: string,
    limit = 50,
    type?: string,
    status?: string,
    from?: string,
    to?: string,
  ): Promise<Notification[]> {
    let whereClause = 'user_id = $1';
    const params: (string | number)[] = [userId];
    let paramIndex = 2;

    if (type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new Error("Invalid 'from' date format");
      }
      whereClause += ` AND created_at >= $${paramIndex}`;
      params.push(fromDate.toISOString());
      paramIndex++;
    }

    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        throw new Error("Invalid 'to' date format");
      }
      whereClause += ` AND created_at <= $${paramIndex}`;
      params.push(toDate.toISOString());
      paramIndex++;
    }

    const result = await query(
      `SELECT id, user_id, type, title, message, loan_id, action_url, read, status, created_at
       FROM notifications
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT -- placeholder replaced below
       `,
      params,
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Marks a notification as read.
   */
  async markAsRead(userId: string, notificationId: number): Promise<boolean> {
    const result = await query(
      `UPDATE notifications
       SET read = true, status = 'read'
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [notificationId, userId],
    );
    return result.rows.length > 0;
  }

  /**
   * Archives a notification.
   */
  async archiveNotification(userId: string, notificationId: number): Promise<boolean> {
    const result = await query(
      `UPDATE notifications
       SET status = 'archived'
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [notificationId, userId],
    );
    return result.rows.length > 0;
  }

  /**
   * Registers an SSE client for a user and returns an unsubscribe function.
   */
  subscribe(userId: string, client: SseClient): () => void {
    if (!sseClients.has(userId)) {
      sseClients.set(userId, new Set());
    }
    sseClients.get(userId)!.add(client);

    return () => {
      const set = sseClients.get(userId);
      if (!set) return;
      set.delete(client);
      if (set.size === 0) {
        sseClients.delete(userId);
      }
    };
  }

  /**
   * Broadcasts a notification to all active SSE clients for a user.
   */
  broadcast(userId: string, notification: Notification): void {
    const clients = sseClients.get(userId);
    if (!clients || clients.size === 0) return;

    const payload = `data: ${JSON.stringify(notification)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  }

  /**
   * Maps a database row to a Notification object.
   */
  private mapRow(row: any): Notification {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      loanId: row.loan_id ?? undefined,
      actionUrl: row.action_url ?? null,
      read: Boolean(row.read),
      status: row.status,
      createdAt: row.created_at,
    };
  }
}

export const notificationService = new NotificationService();
export default notificationService;
