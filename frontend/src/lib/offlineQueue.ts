// Minimal IndexedDB queue for pending repayments

export const OFFLINE_QUEUE_DB_NAME = "dukapay-offline-queue";
export const OFFLINE_QUEUE_STORE = "repayments";

export interface QueuedRepayment {
  id: number;
  loanId: number;
  amount: number;
  borrowerAddress: string;
  createdAt: number;
  /**
   * Stable `Idempotency-Key` for this queued repayment, minted once at enqueue
   * time. The service worker replays with this same key on every attempt so a
   * retry can never pay the same loan twice.
   */
  idempotencyKey: string;
  /** Number of replay attempts made so far. */
  attempts: number;
  /** Short description of the most recent failed replay, for the UI. */
  lastError?: string;
  /** Epoch millis of the most recent replay attempt. */
  lastAttemptAt?: number;
}

/** Mints the idempotency key persisted alongside a queued repayment. */
export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `offline-repay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns the idempotency key to replay an item with.
 *
 * Items queued before keys were persisted (or written by an older app version)
 * have no key, so fall back to one derived from the queue id — still stable, so
 * it can never double-pay.
 */
export function idempotencyKeyFor(item: { id: number; idempotencyKey?: string }): string {
  return item.idempotencyKey || `offline-repay-${item.id}`;
}

export function openOfflineQueueDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueRepayment(item: {
  loanId: number;
  amount: number;
  borrowerAddress: string;
  idempotencyKey?: string;
}) {
  const db = await openOfflineQueueDb();
  const record = {
    loanId: item.loanId,
    amount: item.amount,
    borrowerAddress: item.borrowerAddress,
    idempotencyKey: item.idempotencyKey ?? createIdempotencyKey(),
    createdAt: Date.now(),
    attempts: 0,
  };
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllQueuedRepayments(): Promise<QueuedRepayment[]> {
  const db = await openOfflineQueueDb();
  return new Promise<QueuedRepayment[]>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readonly");
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as QueuedRepayment[]);
    req.onerror = () => reject(req.error);
  });
}

export async function clearQueuedRepayment(id: number) {
  const db = await openOfflineQueueDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Merges `patch` into an existing queue entry, preserving any fields the caller
 * does not mention. Used by the service worker to record replay attempts without
 * dropping the persisted idempotency key.
 */
export async function updateQueuedRepayment(
  id: number,
  patch: Partial<Omit<QueuedRepayment, "id">>,
) {
  const db = await openOfflineQueueDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as QueuedRepayment | undefined;
      if (!existing) {
        resolve();
        return;
      }
      const putReq = store.put({ ...existing, ...patch, id });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}
