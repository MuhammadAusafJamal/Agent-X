import * as path from 'node:path';

/**
 * The e2e database, separate from the development one.
 *
 * These tests write rows. Pointing them at `data/agentx.db` would mean a test
 * run quietly mutating whatever the developer was looking at in Prisma Studio.
 */
export const TEST_DATABASE_URL = 'file:data/agentx-e2e.db';

/** Absolute path to the same file, for deleting it between runs. */
export const TEST_DATABASE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'agentx-e2e.db',
);
