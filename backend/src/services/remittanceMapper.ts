import type { Remittance, RemittanceStatus } from './remittanceService.js';

/** Columns of a `remittances` row as returned by `SELECT *`. */
interface RemittanceRow {
  id: string;
  sender_id: string;
  recipient_address: string;
  amount: string;
  from_currency: string;
  to_currency: string;
  memo: string;
  status: RemittanceStatus;
  transaction_hash: string;
  xdr: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Maps a `remittances` row to the API shape. Every endpoint that returns
 * remittances uses this, so list and detail responses match.
 */
export function toRemittance(r: RemittanceRow): Remittance {
  return {
    id: r.id,
    senderId: r.sender_id,
    recipientAddress: r.recipient_address,
    amount: parseFloat(r.amount),
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    memo: r.memo,
    status: r.status,
    transactionHash: r.transaction_hash,
    xdr: r.xdr,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
