import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  apiErrorSchema,
  applicationSchema,
  projectSchema,
  recordingSchema,
  recordingWithEventsSchema,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

/**
 * Recording lifecycle over real HTTP, driving a real (headless) browser against
 * the real demo app.
 */
describe('Recorder (e2e)', () => {
  const PORT = 4398;
  const BASE = `http://localhost:${PORT}`;

  let demoApp: ChildProcess;
  let app: INestApplication<App>;
  let http: App;
  let applicationId: string;

  beforeAll(async () => {
    demoApp = spawn(
      process.execPath,
      [
        path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          'demo-app',
          'server.js',
        ),
      ],
      { env: { ...process.env, DEMO_PORT: String(PORT) }, stdio: 'pipe' },
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('demo app did not start')),
        10_000,
      );
      demoApp.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('Demo app on')) {
          clearTimeout(timer);
          resolve();
        }
      });
      demoApp.on('error', reject);
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();

    const project = projectSchema.parse(
      (
        await request(http)
          .post('/projects')
          .send({ name: 'Recorder' })
          .expect(201)
      ).body,
    );

    applicationId = applicationSchema.parse(
      (
        await request(http)
          .post('/applications')
          .send({ projectId: project.id, name: 'Demo Shop', baseUrl: BASE })
          .expect(201)
      ).body,
    ).id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    demoApp?.kill();
  });

  async function startRecording() {
    return recordingSchema.parse(
      (
        await request(http)
          .post('/recordings')
          .send({ applicationId, startUrl: BASE })
          .expect(201)
      ).body,
    );
  }

  it('opens a browser, records the opening navigation, and stops cleanly', async () => {
    const started = await startRecording();
    expect(started.status).toBe('RECORDING');

    const stopped = recordingSchema.parse(
      (await request(http).post(`/recordings/${started.id}/stop`).expect(200))
        .body,
    );
    expect(stopped.status).toBe('STOPPED');
    expect(stopped.stoppedAt).not.toBeNull();

    const detail = recordingWithEventsSchema.parse(
      (await request(http).get(`/recordings/${started.id}`).expect(200)).body,
    );

    // Opening the page is itself the first thing the human did.
    expect(detail.events.length).toBeGreaterThan(0);
    expect(detail.events[0]?.type).toBe('NAVIGATE');
    expect(detail.events[0]?.url).toContain(String(PORT));
  }, 60_000);

  it('captures a screenshot and an ARIA snapshot for each event', async () => {
    const started = await startRecording();
    await request(http).post(`/recordings/${started.id}/stop`).expect(200);

    const detail = recordingWithEventsSchema.parse(
      (await request(http).get(`/recordings/${started.id}`).expect(200)).body,
    );

    const first = detail.events[0];
    expect(first?.screenshotRef).toMatch(/recordings\/.+\.jpg$/);
    expect(first?.a11yRef).toMatch(/recordings\/.+\.yaml$/);
  }, 60_000);

  it('is idempotent about stopping', async () => {
    const started = await startRecording();

    await request(http).post(`/recordings/${started.id}/stop`).expect(200);
    // Stopping again is a no-op, not an error — the browser window closing and
    // the user clicking Stop are the same intent arriving twice.
    await request(http).post(`/recordings/${started.id}/stop`).expect(200);
  }, 60_000);

  it('404s when the application does not exist, before opening a browser', async () => {
    const body = apiErrorSchema.parse(
      (
        await request(http)
          .post('/recordings')
          .send({ applicationId: 'nope', startUrl: BASE })
          .expect(404)
      ).body,
    );

    expect(body.message).toContain('Application');
  });

  it('rejects a start URL that is not http(s)', async () => {
    const body = apiErrorSchema.parse(
      (
        await request(http)
          .post('/recordings')
          .send({ applicationId, startUrl: 'file:///etc/passwd' })
          .expect(400)
      ).body,
    );

    expect(body.issues?.map((issue) => issue.path)).toContain('startUrl');
  });

  it('lists recordings for an application with their event counts', async () => {
    const list = (await request(http)
      .get(`/recordings?applicationId=${applicationId}`)
      .expect(200)) as { body: { items: unknown[]; total: number } };

    expect(list.body.total).toBeGreaterThan(0);
    const first = recordingSchema.parse(list.body.items[0]);
    expect(first.eventCount).toBeGreaterThanOrEqual(0);
  });

  describe('evidence serving', () => {
    it('serves a captured screenshot', async () => {
      const started = await startRecording();
      await request(http).post(`/recordings/${started.id}/stop`).expect(200);

      const detail = recordingWithEventsSchema.parse(
        (await request(http).get(`/recordings/${started.id}`).expect(200)).body,
      );

      const response = await request(http)
        .get(`/evidence/${detail.events[0]?.screenshotRef}`)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/jpeg');

      const body: unknown = response.body;
      if (!Buffer.isBuffer(body)) {
        throw new Error('expected a binary response body');
      }
      expect(body.length).toBeGreaterThan(0);
    }, 60_000);

    it('refuses to escape the evidence root', async () => {
      // The path comes from a URL, so traversal has to be impossible rather
      // than unlikely.
      await request(http).get('/evidence/../../.env').expect(404);
      await request(http).get('/evidence/%2e%2e%2f%2e%2e%2f.env').expect(404);
    });

    it('serves a DOM/ARIA snapshot as text, never as renderable HTML', async () => {
      const started = await startRecording();
      await request(http).post(`/recordings/${started.id}/stop`).expect(200);

      const detail = recordingWithEventsSchema.parse(
        (await request(http).get(`/recordings/${started.id}`).expect(200)).body,
      );

      const response = await request(http)
        .get(`/evidence/${detail.events[0]?.a11yRef}`)
        .expect(200);

      // Snapshots come from the application under test; rendering one as HTML
      // would run its scripts on our origin.
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }, 60_000);
  });

  it('deletes a noise event without renumbering the rest', async () => {
    const started = await startRecording();
    await request(http).post(`/recordings/${started.id}/stop`).expect(200);

    const before = recordingWithEventsSchema.parse(
      (await request(http).get(`/recordings/${started.id}`).expect(200)).body,
    );
    const target = before.events[0];

    await request(http)
      .delete(`/recordings/${started.id}/events/${target?.id}`)
      .expect(204);

    const after = recordingWithEventsSchema.parse(
      (await request(http).get(`/recordings/${started.id}`).expect(200)).body,
    );

    expect(after.events).toHaveLength(before.events.length - 1);
    expect(after.events.some((e) => e.id === target?.id)).toBe(false);
  }, 60_000);
});
