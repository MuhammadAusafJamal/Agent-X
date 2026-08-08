import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  apiErrorSchema,
  applicationSchema,
  applicationWithEnvironmentsSchema,
  environmentCredentialStatusSchema,
  environmentSchema,
  paginated,
  projectSchema,
  projectWithApplicationsSchema,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

/**
 * Real HTTP against a real database. Responses are *parsed* through the shared
 * schemas rather than spot-checked, so the wire contract the dashboard relies on
 * is what is actually asserted.
 */
describe('Catalog (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createProject(name = 'Checkout revamp') {
    const response = await request(http)
      .post('/projects')
      .send({ name })
      .expect(201);

    return projectSchema.parse(response.body);
  }

  async function createApplication(projectId: string) {
    const response = await request(http)
      .post('/applications')
      .send({
        projectId,
        name: 'Storefront',
        baseUrl: 'http://localhost:4321',
        description: 'a B2C storefront',
      })
      .expect(201);

    return applicationSchema.parse(response.body);
  }

  async function createEnvironment(applicationId: string) {
    const response = await request(http)
      .post('/environments')
      .send({
        applicationId,
        name: 'local',
        baseUrl: 'http://localhost:4321',
        credentialRefs: {
          usernameEnv: 'DEMO_USER',
          passwordEnv: 'DEMO_PASSWORD',
          extra: {},
        },
      })
      .expect(201);

    return environmentSchema.parse(response.body);
  }

  describe('projects', () => {
    it('creates, reads, updates, and lists', async () => {
      const created = await createProject('Billing');
      expect(created.description).toBeNull();

      const list = paginated(projectSchema).parse(
        (await request(http).get('/projects').expect(200)).body,
      );
      expect(list.items.some((p) => p.id === created.id)).toBe(true);
      expect(list.limit).toBe(50);

      const patched = projectSchema.parse(
        (
          await request(http)
            .patch(`/projects/${created.id}`)
            .send({ description: 'invoicing and dunning' })
            .expect(200)
        ).body,
      );
      expect(patched.description).toBe('invoicing and dunning');
      // A PATCH must leave unsupplied fields alone.
      expect(patched.name).toBe('Billing');
    });

    it('404s on a missing id with the shared error shape', async () => {
      const body = apiErrorSchema.parse(
        (await request(http).get('/projects/does-not-exist').expect(404)).body,
      );

      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toContain('does-not-exist');
      // A Prisma stack trace must never reach a client.
      expect(body.message).not.toContain('Invalid `prisma');
    });

    it('rejects an empty name at the boundary', async () => {
      const body = apiErrorSchema.parse(
        (await request(http).post('/projects').send({ name: '' }).expect(400))
          .body,
      );

      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.issues?.map((issue) => issue.path)).toContain('name');
    });
  });

  describe('applications', () => {
    it('rejects a baseUrl that is not an http(s) URL', async () => {
      const project = await createProject('URL checks');

      const body = apiErrorSchema.parse(
        (
          await request(http)
            .post('/applications')
            .send({
              projectId: project.id,
              name: 'Bad',
              baseUrl: 'localhost:3000',
            })
            .expect(400)
        ).body,
      );

      expect(body.issues?.map((issue) => issue.path)).toContain('baseUrl');
    });

    it('404s naming the project when the parent does not exist', async () => {
      const body = apiErrorSchema.parse(
        (
          await request(http)
            .post('/applications')
            .send({
              projectId: 'nope',
              name: 'Orphan',
              baseUrl: 'http://localhost:4321',
            })
            .expect(404)
        ).body,
      );

      expect(body.message).toContain('Project');
    });

    it('filters by projectId', async () => {
      const [a, b] = await Promise.all([
        createProject('Filter A'),
        createProject('Filter B'),
      ]);
      await createApplication(a.id);

      const list = paginated(applicationSchema).parse(
        (await request(http).get(`/applications?projectId=${b.id}`).expect(200))
          .body,
      );

      expect(list.total).toBe(0);
    });
  });

  describe('nested reads', () => {
    it('returns applications under a project and environments under an application', async () => {
      const project = await createProject('Nested');
      const application = await createApplication(project.id);
      await createEnvironment(application.id);

      const withApps = projectWithApplicationsSchema.parse(
        (await request(http).get(`/projects/${project.id}`).expect(200)).body,
      );
      expect(withApps.applications).toHaveLength(1);

      const withEnvs = applicationWithEnvironmentsSchema.parse(
        (await request(http).get(`/applications/${application.id}`).expect(200))
          .body,
      );
      expect(withEnvs.environments).toHaveLength(1);
      expect(withEnvs.environments[0]?.credentialRefs.usernameEnv).toBe(
        'DEMO_USER',
      );
    });
  });

  describe('environments', () => {
    it('stores credential references, never values', async () => {
      const project = await createProject('Credentials');
      const application = await createApplication(project.id);
      const environment = await createEnvironment(application.id);

      const raw = JSON.stringify(environment);
      expect(raw).toContain('DEMO_PASSWORD');
      // The variable name is stored; a value must never be.
      expect(raw).not.toContain('hunter2');
      expect(environment.credentialRefs.passwordEnv).toBe('DEMO_PASSWORD');
    });
  });

  describe('credential status', () => {
    it('reports which references resolve, without exposing any value', async () => {
      const project = await createProject('Credential status');
      const application = await createApplication(project.id);
      const environment = await createEnvironment(application.id);

      process.env['DEMO_USER'] = 'demo@example.com';
      delete process.env['DEMO_PASSWORD'];

      const body = environmentCredentialStatusSchema.parse(
        (
          await request(http)
            .get(`/environments/${environment.id}/credentials`)
            .expect(200)
        ).body,
      );

      expect(body.allResolved).toBe(false);
      expect(body.entries).toEqual(
        expect.arrayContaining([
          { key: 'usernameEnv', envVar: 'DEMO_USER', resolved: true },
          { key: 'passwordEnv', envVar: 'DEMO_PASSWORD', resolved: false },
        ]),
      );
      // This response is rendered in a browser. The value must not be in it.
      expect(JSON.stringify(body)).not.toContain('demo@example.com');

      delete process.env['DEMO_USER'];
    });
  });

  describe('cascade delete', () => {
    it('removes applications and environments with their project', async () => {
      const project = await createProject('Cascade');
      const application = await createApplication(project.id);
      const environment = await createEnvironment(application.id);

      await request(http).delete(`/projects/${project.id}`).expect(204);

      await request(http).get(`/projects/${project.id}`).expect(404);
      await request(http).get(`/applications/${application.id}`).expect(404);
      await request(http).get(`/environments/${environment.id}`).expect(404);
    });
  });
});
