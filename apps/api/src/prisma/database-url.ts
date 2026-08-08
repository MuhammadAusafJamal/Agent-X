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
