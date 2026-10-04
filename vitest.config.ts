import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Test files reset the shared test database, so they must never run at the same time.
    fileParallelism: false,
    // The test database is remote (Neon), so allow for network round trips.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
