import cron from 'node-cron';
import { agentFloatService } from '../services/agentFloatService.js';
import logger from '../utils/logger.js';

let scheduledTask: cron.ScheduledTask | null = null;
let inFlight = false;

export function startAgentFloatTransferExpiry(): void {
  if (scheduledTask) return;

  scheduledTask = cron.schedule('*/15 * * * *', async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const expiredCount = await agentFloatService.expireStaleTransfers();
      if (expiredCount > 0) {
        logger.info('Expired stale agent float transfers', { expiredCount });
      }
    } catch (error) {
      logger.error('Failed to expire stale agent float transfers', { error });
    } finally {
      inFlight = false;
    }
  });
}

export function stopAgentFloatTransferExpiry(): void {
  scheduledTask?.stop();
  scheduledTask = null;
}
