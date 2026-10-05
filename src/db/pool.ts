import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/** Anything that can run a query: the pool itself, or a client checked out for a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;

// Idle clients can be dropped by the server (Neon suspends idle computes).
// Without a listener, that error would crash the process.
pool.on('error', (err) => {
  console.error('idle pg client error', err);
});

export interface TransactionOptions {
  /**
   * Read-only, and every query sees the same snapshot of the database (REPEATABLE READ).
   * For reports that run several queries whose numbers must agree with each other.
   */
  readOnlySnapshot?: boolean;
}

/**
 * Runs `fn` inside a single transaction on one dedicated client.
 * Commits if `fn` resolves; rolls back and rethrows if anything throws.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    await client.query(
      options.readOnlySnapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // The connection is in an unknown state; destroy it instead of returning it to the pool.
      releaseErr = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
    }
    throw err;
  } finally {
    client.release(releaseErr);
  }
}
