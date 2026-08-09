import * as dotenv from 'dotenv';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  resolveDatabasePath,
  resolveDatabaseUrl,
} from '../src/prisma/database-url';

/**
 * A one-off migration for databases seeded before the demo credentials became
 * literals.
 *
 * `npm run db:seed` never rewrites a version that already exists — deliberately,
 * so it cannot bury hand-edited steps — which means an existing database keeps
 * its `ENV_REF` steps and keeps failing with `MissingCredentialError` no matter
 * how many times it is re-seeded. This rewrites those two steps in place rather
 * than deleting the version, so execution history survives.
 *
 * Idempotent, and safe to delete once no database predates the change.
 */

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const REPLACEMENTS: Record<string, string> = {
  DEMO_APP_USER: process.env['DEMO_APP_USER'] ?? 'demo@example.com',
  DEMO_APP_PASSWORD: process.env['DEMO_APP_PASSWORD'] ?? 'hunter2',
};

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: resolveDatabaseUrl() }),
});

async function main(): Promise<void> {
  const steps = await prisma.testStep.findMany({
    where: { data: { contains: 'ENV_REF' } },
  });

  let patched = 0;

  for (const step of steps) {
    if (step.data === null) continue;

    const parsed: unknown = JSON.parse(step.data);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { kind?: unknown }).kind !== 'ENV_REF'
    ) {
      continue;
    }

    const envVar = (parsed as { envVar?: unknown }).envVar;

    if (typeof envVar !== 'string' || !(envVar in REPLACEMENTS)) continue;

    await prisma.testStep.update({
      where: { id: step.id },
      data: {
        data: JSON.stringify({
          kind: 'LITERAL',
          value: REPLACEMENTS[envVar],
        }),
      },
    });

    patched += 1;
  }

  const environments = await prisma.environment.updateMany({
    where: { credentialRefs: { contains: 'DEMO_APP_' } },
    data: { credentialRefs: JSON.stringify({ extra: {} }) },
  });

  process.stdout.write(
    [
      `Database     ${resolveDatabasePath()}`,
      `Steps        ${patched} rewritten from ENV_REF to LITERAL`,
      `Environments ${environments.count} cleared of DEMO_APP_* references`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Patch failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
