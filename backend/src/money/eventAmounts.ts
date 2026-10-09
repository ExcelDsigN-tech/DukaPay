/**
 * `contract_events.amount` holds raw on-chain values. For money events that
 * is stroops; config events reuse the column for rates, ledgers and scores.
 * Only the event types below are converted to whole tokens in API responses.
 */
import { stroopsToAmount } from './decimal.js';

const MONEY_EVENT_TYPES = new Set([
  'LoanRequested',
  'LoanRepaid',
  'LoanRefinanced',
  'LoanExtended',
  'LoanLiquidated',
  'LateFeeCharged',
  'CollateralDeposited',
  'CollateralReleased',
  'CollateralReturned',
  'CollateralLiquidated',
  'Deposit',
  'Withdraw',
  'EmergencyWithdraw',
  'YieldDistributed',
  'DepositCapUpdated',
  'MaxLoanAmountUpdated',
  'MinRepaymentUpdated',
  'Transfer',
]);

export function isMoneyEvent(eventType: unknown): boolean {
  return typeof eventType === 'string' && MONEY_EVENT_TYPES.has(eventType);
}

/**
 * API fields for an event's amount: money events get `amount` in whole
 * tokens plus the exact `amountStroops`; other events keep the raw value.
 */
export function eventAmountFields(
  eventType: unknown,
  raw: unknown,
): { amount: unknown; amountStroops?: string } {
  if (raw === null || raw === undefined || !isMoneyEvent(eventType)) {
    return { amount: raw ?? null };
  }
  return { amount: stroopsToAmount(String(raw)), amountStroops: String(raw) };
}
