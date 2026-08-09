import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The one place the single-instance assumption actually holds.
 *
 * `setup-e2e.ts` disables the boot sweep for every other suite, because jest
 * runs several app instances against one database and a sweep would error runs
 * another worker has in flight. That is a property of the harness, not of the
 * product — so the sweep is re-enabled here, against a database nothing else
 * touches, which is the only honest way to test it.
 */
const SWEEP_DATABASE_URL = 'file:data/agentx-sweep-e2e.db';

/** Repo root, the anchor every relative `file:` URL in this project resolves against. */
const SWEEP_DATABASE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'agentx-sweep-e2e.db',
);

process.env['DATABASE_URL'] = SWEEP_DATABASE_URL;
process.env['EVIDENCE_DIR'] = 'data/evidence-sweep-e2e';
process.env['AGENTX_SWEEP_INTERRUPTED_ON_BOOT'] = 'true';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { PrismaClient } from './../src/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import {
  ensureDatabaseDir,
  resolveDatabaseUrl,
} from './../src/prisma/database-url';

describe('Boot sweep for interrupted work (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let seeded: {
    executionId: string;
    finishedExecutionId: string;
    featureCheckId: string;
  };

  type App = ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      fs.rmSync(`${SWEEP_DATABASE_PATH}${suffix}`, { force: true });
    }

    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: SWEEP_DATABASE_URL },
      stdio: 'pipe',
    });

    // Seeded through a client of its own, *before* the app exists. The rows have
    // to be in place at boot, because the sweep runs during `app.init()` — there
    // is no later moment to create them and still be testing the same thing.
    seeded = await seedInterruptedWork();
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * A stranded run, a stranded check, and one of each that already finished.
   *
   * The finished rows are the control: a sweep that closes out everything is
   * indistinguishable from a correct one until something it should not have
   * touched is checked.
   */
  async function seedInterruptedWork() {
    // The same resolver `PrismaService` uses. A bare `file:data/...` is resolved
    // against the working directory, which differs between the Prisma CLI, jest,
    // and the running API — so this client and the app would open two different
    // files, and the sweep would appear not to have run.
    ensureDatabaseDir(SWEEP_DATABASE_URL);

    const prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({
        url: resolveDatabaseUrl(SWEEP_DATABASE_URL),
      }),
    });

    try {
      const project = await prisma.project.create({
        data: { name: 'Interrupted' },
      });

      const application = await prisma.application.create({
        data: {
          projectId: project.id,
          name: 'app',
          baseUrl: 'http://localhost:4321',
        },
      });

      const environment = await prisma.environment.create({
        data: {
          applicationId: application.id,
          name: 'local',
          baseUrl: 'http://localhost:4321',
          credentialRefs: JSON.stringify({ extra: {} }),
        },
      });

      const spec = await prisma.testSpec.create({
        data: {
          applicationId: application.id,
          name: 'stranded',
          source: 'RECORDED',
        },
      });

      const version = await prisma.testVersion.create({
        data: { specId: spec.id, version: 1, source: 'RECORDED' },
      });

      const running = await prisma.execution.create({
        data: {
          specId: spec.id,
          versionId: version.id,
          environmentId: environment.id,
          status: 'RUNNING',
          mode: 'REPLAY',
        },
      });

      const finished = await prisma.execution.create({
        data: {
          specId: spec.id,
          versionId: version.id,
          environmentId: environment.id,
          status: 'PASSED',
          mode: 'REPLAY',
        },
      });

      const feature = await prisma.feature.create({
        data: { applicationId: application.id, name: 'stranded feature' },
      });

      const check = await prisma.featureCheck.create({
        data: {
          featureId: feature.id,
          applicationId: application.id,
          environmentId: environment.id,
          name: 'stranded check',
          description: '',
          status: 'REALIZING',
          criteria: '[]',
        },
      });

      await prisma.featureCheck.create({
        data: {
          featureId: feature.id,
          applicationId: application.id,
          environmentId: environment.id,
          name: 'finished check',
          description: '',
          status: 'COMPLETED',
          criteria: '[]',
        },
      });

      return {
        executionId: running.id,
        finishedExecutionId: finished.id,
        featureCheckId: check.id,
      };
    } finally {
      await prisma.$disconnect();
    }
  }

  async function boot(): Promise<PrismaService> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    return app.get(PrismaService);
  }

  it('closes out the work the last process was in the middle of', async () => {
    const prisma = await boot();

    const run = await prisma.execution.findUniqueOrThrow({
      where: { id: seeded.executionId },
    });

    expect(run.status).toBe('ERROR');
    expect(run.error).toBe('The API restarted while this run was in progress.');
    expect(run.finishedAt).not.toBeNull();

    const check = await prisma.featureCheck.findUniqueOrThrow({
      where: { id: seeded.featureCheckId },
    });

    expect(check.status).toBe('FAILED');
    expect(check.error).toBe(
      'The API restarted while this check was still running.',
    );
    expect(check.finishedAt).not.toBeNull();
  });

  it('leaves work that already reached a terminal status alone', async () => {
    const prisma = app!.get(PrismaService);

    const finished = await prisma.execution.findUniqueOrThrow({
      where: { id: seeded.finishedExecutionId },
    });

    expect(finished.status).toBe('PASSED');
    expect(finished.error).toBeNull();

    const completed = await prisma.featureCheck.findFirstOrThrow({
      where: { name: 'finished check' },
    });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.error).toBeNull();
  });

  it('leaves the swept rows in a status the dashboard stops polling', async () => {
    // The symptom this whole thing exists to remove: `shouldPoll` keeps asking
    // while a status is non-terminal, so a stranded row is polled forever.
    const prisma = app!.get(PrismaService);

    const stillOpen = await prisma.featureCheck.count({
      where: {
        status: { in: ['PENDING', 'PLANNING', 'REALIZING', 'RUNNING'] },
      },
    });

    const stillRunning = await prisma.execution.count({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
    });

    expect(stillOpen).toBe(0);
    expect(stillRunning).toBe(0);
  });
});
