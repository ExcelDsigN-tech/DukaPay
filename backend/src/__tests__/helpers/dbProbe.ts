import pg from 'pg';
import { describe } from '@jest/globals';

let isDbAvailable = false;

if (process.env.DATABASE_TESTS === 'false') {
  isDbAvailable = false;
} else if (process.env.DATABASE_TESTS === 'true') {
  isDbAvailable = true;
} else {
  const probePool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://pguser:pgpass@localhost:5432/dukapay_test',
    connectionTimeoutMillis: 1000,
  });
  try {
    const res = await probePool.query('SELECT 1');
    isDbAvailable = (res.rowCount ?? 0) > 0;
  } catch {
    isDbAvailable = false;
  } finally {
    await probePool.end().catch(() => {});
  }
}

export const dbAvailable = isDbAvailable;
export const describeIfDb = dbAvailable ? describe : describe.skip;
