import dotenv from 'dotenv';

// Runs before each test file, i.e. before src/config.ts reads DATABASE_URL.
const fileEnv = dotenv.config({ quiet: true }).parsed ?? {};
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Tests reset the database, so they need their own.',
  );
}
if (testUrl === fileEnv.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must not point at the same database as DATABASE_URL.');
}

process.env.DATABASE_URL = testUrl;
