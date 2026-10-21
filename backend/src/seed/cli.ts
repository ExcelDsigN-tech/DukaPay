import { closePool } from '../db/connection.js';
import { runSeed } from './index.js';

// Entry point for `npm run seed:dev` / `seed:reset`. Kept separate so tests
// can import the seed module without running it.
try {
  await runSeed({ reset: process.argv.slice(2).includes('--reset') });
} catch {
  process.exitCode = 1;
} finally {
  await closePool();
}
