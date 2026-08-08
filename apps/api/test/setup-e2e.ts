import { TEST_DATABASE_URL } from './test-database';

/**
 * Runs before any module is imported.
 *
 * `ConfigModule.forRoot({ validate })` evaluates at import time, so setting this
 * inside `beforeAll` is already too late — importing `AppModule` at the top of a
 * spec would throw first. That is the fail-fast behaviour we want in production;
 * it just means the test environment has to be in place before the imports.
 */
process.env['ANTHROPIC_API_KEY'] ??= 'sk-test-e2e';
process.env['NODE_ENV'] = 'test';

// Assigned, not defaulted: this must beat whatever is in a developer's .env,
// which dotenv loads without overriding what is already set. A DATABASE_URL
// left at Prisma's ./dev.db default points at an empty, unmigrated file.
process.env['DATABASE_URL'] = TEST_DATABASE_URL;
