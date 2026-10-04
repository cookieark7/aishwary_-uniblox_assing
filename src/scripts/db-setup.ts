import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const currentFile = fileURLToPath(import.meta.url);
const dbDir = path.join(path.dirname(currentFile), '../db');

/**
 * Drops and recreates every table, then loads the seed data, in one transaction.
 * Destructive: only point this at a database you are happy to wipe.
 */
export async function resetDb(databaseUrl: string): Promise<void> {
  const [schemaSql, seedSql] = await Promise.all([
    readFile(path.join(dbDir, 'schema.sql'), 'utf-8'),
    readFile(path.join(dbDir, 'seed.sql'), 'utf-8'),
  ]);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(schemaSql);
    await client.query(seedSql);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors because the original error is more useful.
    }
    throw err;
  } finally {
    await client.end();
  }
}

async function main() {
  dotenv.config({ quiet: true });

  const isTest = process.argv.includes('--test');
  const variableName = isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  const databaseUrl = process.env[variableName];

  if (!databaseUrl) {
    throw new Error(
      `${variableName} is not set. Please configure it before running the database setup script.`,
    );
  }

  const dbUrl = new URL(databaseUrl);
  console.log(`Resetting database "${dbUrl.pathname.slice(1)}" on host "${dbUrl.hostname}"...`);

  await resetDb(databaseUrl);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: products } = await client.query('SELECT * FROM products ORDER BY id');
    console.table(products);
  } finally {
    await client.end();
  }
}

// Run only when executed directly (`npm run db:setup`), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error('Database setup failed:');
    console.error(error);
    process.exitCode = 1;
  });
}
