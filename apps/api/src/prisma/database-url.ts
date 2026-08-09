import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves the SQLite database location to one unambiguous absolute path.
 *
 * A relative `file:` URL is interpreted differently depending on what is doing
 * the interpreting — the Prisma CLI, a migration, and the running API all have
 * different working directories, and "the database file moved" is a confusing
 * way to find that out. So every relative path here is anchored to the **repo
 * root**, and both `prisma.config.ts` and `PrismaService` call this one function.
 */

/** The repo root, from `apps/api/src/prisma` — or `apps/api/dist/prisma` once built. */
function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export const DEFAULT_DATABASE_PATH = 'data/agentx.db';

export function resolveDatabaseUrl(
  rawUrl = process.env['DATABASE_URL'],
): string {
  if (!rawUrl) {
    return `file:${path.resolve(repoRoot(), DEFAULT_DATABASE_PATH)}`;
  }

  if (!rawUrl.startsWith('file:')) {
    return rawUrl;
  }

  const filePath = rawUrl.slice('file:'.length);

  if (path.isAbsolute(filePath)) {
    return rawUrl;
  }

  return `file:${path.resolve(repoRoot(), filePath)}`;
}

/** The absolute filesystem path, for logging and for creating the parent directory. */
export function resolveDatabasePath(
  rawUrl = process.env['DATABASE_URL'],
): string {
  const url = resolveDatabaseUrl(rawUrl);
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

/**
 * Creates the database's parent directory if it is missing.
 *
 * A fresh clone has no `data/` directory, and SQLite will not create a missing
 * parent — it fails with an unhelpful "unable to open database file" instead.
 * Every entry point that can be the first to touch the database calls this:
 * `PrismaService`, the seed script, and `prisma.config.ts`, which is what the
 * migrate commands load. Leaving it out of the last one is why `npm run
 * db:migrate` used to be the one path that failed on a clean checkout.
 */
export function ensureDatabaseDir(
  rawUrl = process.env['DATABASE_URL'],
): string {
  const filePath = resolveDatabasePath(rawUrl);

  if (filePath.startsWith('file:') || !path.isAbsolute(filePath)) {
    // A non-file datasource (or something we could not resolve) has no parent
    // directory to create.
    return filePath;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}
