import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// Idle clients can be dropped by the server (Neon suspends idle computes).
// Without a listener, that error would crash the process.
pool.on('error', (err) => {
  console.error('idle pg client error', err);
});

/**
 * Runs `fn` inside a single transaction on one dedicated client.
 * Commits if `fn` resolves; rolls back and rethrows if anything throws.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    await client.query('BEGIN');
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
