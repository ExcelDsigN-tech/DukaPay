import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { query } from '../db/connection.js';
import { cacheService } from '../services/cacheService.js';
import { updateUserScoresBulk } from '../services/scoresService.js';

let __scoresService_dbAvailable = false;

beforeAll(async () => {
  try {
    await query('SELECT 1');
    __scoresService_dbAvailable = true;
  } catch {
    __scoresService_dbAvailable = false;
  }
});

const describeIf_scoresService = (name: string, fn: () => void) => {
  if (__scoresService_dbAvailable) {
    describe(name, fn);
  } else {
    // Ensure at least one skipped test exists so Jest considers the suite valid
    describe.skip(name, () => {
      it.skip('skipped: no database', () => {});
    });
  }
};

describeIf_scoresService('Scores Service - bulk updates', () => {
  const userA = 'G_TEST_USER_A';
  const userB = 'G_TEST_USER_B';

  beforeAll(async () => {
    await query(`
			CREATE TABLE IF NOT EXISTS scores (
				id SERIAL PRIMARY KEY,
				borrower VARCHAR(255) UNIQUE NOT NULL,
				score INTEGER NOT NULL,
				updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);
  });

  afterAll(async () => {
    await query('DELETE FROM scores WHERE borrower LIKE $1', ['G_TEST_%']);
  });

  it('applies multiple deltas in a single operation and initializes new rows', async () => {
    // ensure clean
    await query('DELETE FROM scores WHERE borrower IN ($1, $2)', [userA, userB]);

    const updates = new Map<string, number>();
    updates.set(userA, 10);
    updates.set(userB, -20);

    await updateUserScoresBulk(updates);

    const res = await query(
      'SELECT borrower, score FROM scores WHERE borrower IN ($1, $2) ORDER BY borrower',
      [userA, userB],
    );

    const rows = res.rows.reduce(
      (acc: Record<string, number>, r: Record<string, unknown>) => {
        acc[r.borrower as string] = Number(r.score);
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(rows[userA]).toBe(500 + 10);
    expect(rows[userB]).toBe(500 - 20);

    // apply more deltas to same users
    const more = new Map<string, number>();
    more.set(userA, 5);
    more.set(userB, -10);
    await updateUserScoresBulk(more);

    const res2 = await query(
      'SELECT borrower, score FROM scores WHERE borrower IN ($1, $2) ORDER BY borrower',
      [userA, userB],
    );

    const rows2 = res2.rows.reduce(
      (acc: Record<string, number>, r: Record<string, unknown>) => {
        acc[r.borrower as string] = Number(r.score);
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(rows2[userA]).toBe(Math.min(850, Math.max(300, 500 + 10 + 5)));
    expect(rows2[userB]).toBe(Math.min(850, Math.max(300, 500 - 20 - 10)));
  });

  it('clamps an out-of-range delta to [300, 850] on first insert for a new user', async () => {
    const userC = 'G_TEST_USER_C';
    await query('DELETE FROM scores WHERE borrower = $1', [userC]);

    // A large negative delta on a brand-new user must not persist below MIN_SCORE.
    await updateUserScoresBulk(new Map([[userC, -1000]]));

    const res = await query('SELECT score FROM scores WHERE borrower = $1', [userC]);
    expect(Number(res.rows[0].score)).toBe(300);

    await query('DELETE FROM scores WHERE borrower = $1', [userC]);
  });

  it('clamps an out-of-range delta to [300, 850] on update for an existing user', async () => {
    const userD = 'G_TEST_USER_D';
    await query('DELETE FROM scores WHERE borrower = $1', [userD]);

    await updateUserScoresBulk(new Map([[userD, 0]]));
    // Existing row starts at 500; push it far above MAX_SCORE.
    await updateUserScoresBulk(new Map([[userD, 1000]]));

    const res = await query('SELECT score FROM scores WHERE borrower = $1', [userD]);
    expect(Number(res.rows[0].score)).toBe(850);

    await query('DELETE FROM scores WHERE borrower = $1', [userD]);
  });
});

describe('Scores Service - delta sign and clamp SQL semantics', () => {
  it('builds INSERT and ON CONFLICT clauses that add +delta and clamp to [300, 850]', async () => {
    const deleteSpy = jest.spyOn(cacheService, 'delete').mockResolvedValue(false);
    const executedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const store = new Map<string, number>();

    const mockClient = {
      query: async (sql: string, params: unknown[] = []) => {
        executedQueries.push({ sql, params });
        for (let i = 0; i < params.length; i += 2) {
          const borrower = String(params[i]);
          const delta = Number(params[i + 1]);
          const excludedScore = Math.min(850, Math.max(300, 500 + delta));
          const existing = store.get(borrower);
          if (existing === undefined) {
            store.set(borrower, excludedScore);
          } else {
            store.set(borrower, Math.min(850, Math.max(300, existing + (excludedScore - 500))));
          }
        }
        return { rows: [], rowCount: params.length / 2 };
      },
    } as unknown as Parameters<typeof updateUserScoresBulk>[1];

    try {
      await updateUserScoresBulk(
        new Map([
          ['G_USER_REPAID', 15],
          ['G_USER_DEFAULTED', -50],
          ['G_USER_FLOOR', -1000],
        ]),
        mockClient,
      );

      expect(executedQueries).toHaveLength(1);
      expect(executedQueries[0]!.sql).toContain('LEAST(850, GREATEST(300, 500 + $2))');
      expect(executedQueries[0]!.sql).not.toContain('500 - $');
      expect(executedQueries[0]!.sql).toContain(
        'LEAST(850, GREATEST(300, scores.score + (EXCLUDED.score - 500)))',
      );

      expect(store.get('G_USER_REPAID')).toBe(515);
      expect(store.get('G_USER_DEFAULTED')).toBe(450);
      expect(store.get('G_USER_FLOOR')).toBe(300);

      // Subsequent update on existing user applies +delta and clamps to 850
      await updateUserScoresBulk(new Map([['G_USER_REPAID', 1000]]), mockClient);
      expect(store.get('G_USER_REPAID')).toBe(850);
    } finally {
      deleteSpy.mockRestore();
    }
  });
});
