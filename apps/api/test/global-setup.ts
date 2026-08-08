import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEST_DATABASE_PATH, TEST_DATABASE_URL } from './test-database';

/**
 * Builds a fresh, migrated database before the e2e suite runs.
 *
 * Deleted and rebuilt each time rather than reused: leftover rows make tests
 * order-dependent, and a test that only passes second is worse than one that
 * fails.
 */
export default function globalSetup(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    fs.rmSync(`${TEST_DATABASE_PATH}${suffix}`, { force: true });
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
