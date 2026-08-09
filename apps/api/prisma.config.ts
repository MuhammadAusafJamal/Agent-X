import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { ensureDatabaseDir, resolveDatabaseUrl } from './src/prisma/database-url';

/**
 * Prisma 7 takes the datasource URL from here rather than from `schema.prisma`.
 *
 * The URL goes through `resolveDatabaseUrl` so the CLI, migrations, and the
 * running API all agree on one absolute path regardless of working directory —
 * see the comment in that file.
 *
 * `ensureDatabaseDir` runs here too, because on a fresh clone the migrate
 * commands are the *first* thing to touch the database — before the API has
 * ever booted — and SQLite will not create a missing parent directory.
 */
ensureDatabaseDir();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
