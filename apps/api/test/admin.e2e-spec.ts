import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A database of its own, assigned before `AppModule` is imported.
 *
 * Every other e2e file shares `data/agentx-e2e.db`, and jest runs up to four of
 * them at once. A suite whose whole subject is "delete every row" cannot share
 * that file: it would empty the catalog out from under a test that was midway
 * through asserting on it, and the failure would land in the *other* suite.
 *
 * Jest gives each test file its own process, so assigning here is enough — and
 * it has to be here rather than in `beforeAll`, because importing `AppModule`
 * evaluates `ConfigModule.forRoot` at import time.
 */
const ADMIN_DATABASE_URL = 'file:data/agentx-admin-e2e.db';
const ADMIN_DATABASE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'agentx-admin-e2e.db',
);
const ADMIN_EVIDENCE_DIR = 'data/evidence-admin-e2e';

process.env['DATABASE_URL'] = ADMIN_DATABASE_URL;
process.env['EVIDENCE_DIR'] = ADMIN_EVIDENCE_DIR;

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  RESET_CONFIRMATION,
  apiErrorSchema,
  applicationSchema,
  paginated,
  projectSchema,
  resetDataResultSchema,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { EvidenceService } from './../src/evidence/evidence.service';

describe('Admin data reset (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let evidence: EvidenceService;

  beforeAll(async () => {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      fs.rmSync(`${ADMIN_DATABASE_PATH}${suffix}`, { force: true });
    }

    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: ADMIN_DATABASE_URL },
      stdio: 'pipe',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    evidence = app.get(EvidenceService);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A project, an application, and an environment, straight through the API. */
  async function seedCatalog(name = 'Doomed'): Promise<string> {
    const projectResponse = await request(http)
      .post('/projects')
      .send({ name })
      .expect(201);

    const project = projectSchema.parse(projectResponse.body);

    const applicationResponse = await request(http)
      .post('/applications')
      .send({
        projectId: project.id,
        name: `${name} app`,
        baseUrl: 'http://localhost:4321',
      })
      .expect(201);

    const application = applicationSchema.parse(applicationResponse.body);

    await request(http)
      .post('/environments')
      .send({
        applicationId: application.id,
        name: 'local',
        baseUrl: 'http://localhost:4321',
        credentialRefs: { extra: {} },
      })
      .expect(201);

    return application.id;
  }

  describe('refusing', () => {
    it('refuses a request with no confirmation at all', async () => {
      await seedCatalog('Survivor');

      const response = await request(http)
        .post('/admin/reset')
        .send({})
        .expect(400);

      expect(apiErrorSchema.parse(response.body).code).toBe(
        'VALIDATION_FAILED',
      );

      // The point of the assertion: refusing must not have deleted anything.
      expect(await prisma.project.count()).toBeGreaterThan(0);
    });

    it('refuses a confirmation that is merely truthy', async () => {
      // `{"confirm": true}` is what an accidental call looks like — a checkbox
      // bound straight to the body, a replayed request, a copied snippet.
      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: true })
        .expect(400);

      expect(apiErrorSchema.parse(response.body).code).toBe(
        'VALIDATION_FAILED',
      );
      expect(await prisma.project.count()).toBeGreaterThan(0);
    });

    it('refuses a near-miss phrase', async () => {
      await request(http)
        .post('/admin/reset')
        .send({ confirm: 'delete all data' })
        .expect(400);

      expect(await prisma.project.count()).toBeGreaterThan(0);
    });

    it('refuses while a feature check is still in flight, and says so', async () => {
      const applicationId = await seedCatalog('Busy');

      const environment = await prisma.environment.findFirstOrThrow({
        where: { applicationId },
      });

      const feature = await prisma.feature.create({
        data: { applicationId, name: 'in flight', description: null },
      });

      await prisma.featureCheck.create({
        data: {
          featureId: feature.id,
          applicationId,
          environmentId: environment.id,
          name: 'in flight',
          description: '',
          status: 'REALIZING',
          criteria: '[]',
        },
      });

      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION })
        .expect(409);

      const error = apiErrorSchema.parse(response.body);

      expect(error.code).toBe('CONFLICT');
      expect(error.message).toContain('1 feature check(s)');
      expect(await prisma.project.count()).toBeGreaterThan(0);
    });

    it('deletes anyway when forced, because the queue may be from a dead process', async () => {
      // Exactly the situation `force` exists for: the row says REALIZING, but
      // the process that was driving it is gone, so nothing will ever move it.
      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION, force: true })
        .expect(201);

      expect(
        resetDataResultSchema.parse(response.body).rowsDeleted,
      ).toBeGreaterThan(0);
      expect(await prisma.featureCheck.count()).toBe(0);
    });
  });

  describe('resetting', () => {
    it('empties every table, keeps the schema, and reports what it deleted', async () => {
      await seedCatalog('Wiped');

      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION })
        .expect(201);

      const result = resetDataResultSchema.parse(response.body);

      expect(result.rowsDeleted).toBeGreaterThan(0);
      expect(result.deleted['Project']).toBeGreaterThan(0);
      expect(result.deleted['Application']).toBeGreaterThan(0);
      expect(result.deleted['Environment']).toBeGreaterThan(0);

      // The schema is the thing that must survive. Nineteen models today; the
      // assertion is "the tables are still there", not a number to maintain.
      expect(result.tablesRemaining).toBeGreaterThan(10);

      const listed = await request(http).get('/projects').expect(200);
      const projects = paginated(projectSchema).parse(listed.body);

      expect(projects.items).toHaveLength(0);
      expect(projects.total).toBe(0);
    });

    it('leaves the database writable, which is what proves it was not dropped', async () => {
      // A dropped table also reports zero rows. Writing again is the difference.
      await seedCatalog('Rebuilt');

      expect(await prisma.project.count()).toBe(1);
      expect(await prisma.application.count()).toBe(1);
    });

    it('keeps the migration history, so the next deploy is still a no-op', async () => {
      const rows = await prisma.$queryRawUnsafe<{ n: number | bigint }[]>(
        'SELECT COUNT(*) AS n FROM _prisma_migrations',
      );

      // Emptying this table makes Prisma replay every migration against tables
      // that already exist — a reset that looks clean and breaks the next deploy.
      expect(Number(rows[0].n)).toBeGreaterThan(0);
    });

    it('reports nothing deleted when there was nothing to delete', async () => {
      await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION })
        .expect(201);

      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION })
        .expect(201);

      const result = resetDataResultSchema.parse(response.body);

      expect(result.rowsDeleted).toBe(0);
      expect(result.tablesCleared).toBe(0);
      expect(result.tablesRemaining).toBeGreaterThan(10);
    });

    it('empties the evidence tree by default and leaves the root in place', async () => {
      await evidence.write(
        'runs/some-run/step-0/shot.txt',
        'not really a jpeg',
      );

      expect(fs.existsSync(path.join(evidence.rootDir, 'runs'))).toBe(true);

      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION })
        .expect(201);

      expect(resetDataResultSchema.parse(response.body).evidenceRemoved).toBe(
        true,
      );
      expect(fs.existsSync(path.join(evidence.rootDir, 'runs'))).toBe(false);
      // The root itself survives: a directory that briefly does not exist is one
      // a misconfigured path can silently recreate somewhere else.
      expect(fs.existsSync(evidence.rootDir)).toBe(true);
    });

    it('leaves evidence alone when asked to', async () => {
      await evidence.write('runs/kept/step-0/shot.txt', 'still here');

      const response = await request(http)
        .post('/admin/reset')
        .send({ confirm: RESET_CONFIRMATION, evidence: false })
        .expect(201);

      expect(resetDataResultSchema.parse(response.body).evidenceRemoved).toBe(
        null,
      );
      expect(fs.existsSync(path.join(evidence.rootDir, 'runs', 'kept'))).toBe(
        true,
      );
    });
  });
});
