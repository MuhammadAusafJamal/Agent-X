import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  applicationSchema,
  environmentSchema,
  executionDetailSchema,
  executionSchema,
  projectSchema,
  type DraftTestStep,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { SpecsService } from './../src/specs/specs.service';

/**
 * A real replay against the real demo app.
 *
 * No model is involved: this is the deterministic path end to end — resolve,
 * act, observe, record evidence — which is exactly what Phase 3 is for.
 */
describe('Execution (e2e)', () => {
  const PORT = 4397;
  const BASE = `http://localhost:${PORT}`;
  const PASSWORD = 'hunter2';

  let demoApp: ChildProcess;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let specs: SpecsService;
  let applicationId: string;
  let environmentId: string;

  beforeAll(async () => {
    process.env['DEMO_USER'] = 'demo@example.com';
    process.env['DEMO_PASSWORD'] = PASSWORD;

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
    prisma = app.get(PrismaService);
    specs = app.get(SpecsService);

    const project = projectSchema.parse(
      (
        await request(http)
          .post('/projects')
          .send({ name: 'Execution' })
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

    environmentId = environmentSchema.parse(
      (
        await request(http)
          .post('/environments')
          .send({
            applicationId,
            name: 'local',
            baseUrl: BASE,
            credentialRefs: {
              usernameEnv: 'DEMO_USER',
              passwordEnv: 'DEMO_PASSWORD',
              extra: {},
            },
          })
          .expect(201)
      ).body,
    ).id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    demoApp?.kill();
  });

  const step = (partial: Partial<DraftTestStep>): DraftTestStep => ({
    intent: 'do the thing',
    action: 'CLICK',
    targetDescription: null,
    targetHints: { selectorCandidates: [] },
    data: null,
    expectation: { kind: 'NO_CONSOLE_ERRORS', allowlist: [] },
    optional: false,
    ...partial,
  });

  /** The login flow, as the compiler would have produced it. */
  function loginSteps(): DraftTestStep[] {
    return [
      step({
        intent: 'open the sign-in page',
        action: 'NAVIGATE',
        data: { kind: 'LITERAL', value: BASE },
      }),
      step({
        intent: 'enter the email address',
        action: 'FILL',
        targetDescription: 'the email field',
        targetHints: { role: 'textbox', name: 'Email', selectorCandidates: [] },
        data: { kind: 'ENV_REF', envVar: 'DEMO_USER' },
      }),
      step({
        intent: 'enter the password',
        action: 'FILL',
        targetDescription: 'the password field',
        targetHints: {
          role: 'textbox',
          name: 'Password',
          selectorCandidates: [],
        },
        data: { kind: 'ENV_REF', envVar: 'DEMO_PASSWORD' },
      }),
      step({
        intent: 'submit the sign-in form',
        action: 'CLICK',
        targetDescription: 'the submit button',
        targetHints: {
          role: 'button',
          name: 'Sign in',
          testId: 'login-submit',
          selectorCandidates: [],
        },
      }),
    ];
  }

  async function createSpec(steps: DraftTestStep[]): Promise<string> {
    const spec = await prisma.testSpec.create({
      data: { applicationId, name: 'Run me', source: 'MANUAL' },
    });

    await specs.createVersion(spec.id, { steps });

    return spec.id;
  }

  /** Starts a run and waits for it to reach a terminal state. */
  async function runToCompletion(specId: string, timeoutMs = 90_000) {
    const started = executionSchema.parse(
      (
        await request(http)
          .post('/executions')
          .send({ specId, environmentId })
          .expect(201)
      ).body,
    );

    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const detail = executionDetailSchema.parse(
        (await request(http).get(`/executions/${started.id}`).expect(200)).body,
      );

      if (!['PENDING', 'RUNNING'].includes(detail.status)) return detail;

      if (Date.now() > deadline) {
        throw new Error(`Execution stalled in ${detail.status}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  it('replays a recorded login and passes', async () => {
    const specId = await createSpec(loginSteps());
    const detail = await runToCompletion(specId);

    expect(detail.status).toBe('PASSED');
    expect(detail.steps).toHaveLength(4);
    expect(detail.steps.every((s) => s.status === 'PASS')).toBe(true);
    // No model was involved, so no model was billed.
    expect(detail.totals.llmCallCount).toBe(0);
  }, 120_000);

  it('records which rung of the ladder resolved each step', async () => {
    const specId = await createSpec(loginSteps());
    const detail = await runToCompletion(specId);

    const submit = detail.steps.at(-1);

    // Role and name win over the test id: the way a human describes the control
    // is preferred, and the test id is the fallback.
    expect(submit?.resolutionStrategy).toBe('ROLE_NAME');
    expect(submit?.candidateCount).toBe(1);
    expect(submit?.confidence).toBeGreaterThan(0.8);
    expect(submit?.resolvedSelector).toContain('Sign in');
    expect(submit?.durationMs).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('captures per-step evidence and a trace for the whole run', async () => {
    const specId = await createSpec(loginSteps());
    const detail = await runToCompletion(specId);

    const kinds = new Set(detail.artifacts.map((artifact) => artifact.kind));
    expect(kinds.has('SCREENSHOT')).toBe(true);
    expect(kinds.has('DOM')).toBe(true);
    expect(kinds.has('NETWORK')).toBe(true);
    expect(kinds.has('CONSOLE')).toBe(true);
    expect(kinds.has('TRACE')).toBe(true);

    // Every step carries the observations the verifier will need in Phase 4.
    for (const executed of detail.steps) {
      const observed = new Set(executed.observations.map((o) => o.kind));
      expect(observed.has('URL')).toBe(true);
      expect(observed.has('NETWORK')).toBe(true);
      expect(observed.has('CONSOLE')).toBe(true);
    }

    // Artifacts must actually exist on disk, not merely be rowed.
    const trace = detail.artifacts.find((a) => a.kind === 'TRACE');
    await request(http).get(`/evidence/${trace?.relPath}`).expect(200);
  }, 120_000);

  it('never writes a credential value into the evidence tree', async () => {
    const specId = await createSpec(loginSteps());
    const detail = await runToCompletion(specId);

    expect(detail.status).toBe('PASSED');

    // The deferred half of E1.3: the password was typed into a real form, so if
    // redaction leaks anywhere it leaks here.
    const root = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      process.env['EVIDENCE_DIR'] ?? 'data/evidence-e2e',
      detail.id,
    );

    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }

        // Binary evidence (video, trace, screenshots) is not text-searchable
        // here; the text evidence is where a leak would actually be readable.
        if (!/\.(json|html|yaml|txt)$/.test(entry.name)) continue;

        const content = await fs.readFile(full, 'utf8');
        if (content.includes(PASSWORD)) offenders.push(full);
      }
    }

    await walk(root);

    expect(offenders).toEqual([]);
  }, 120_000);

  it('fails a step that cannot be resolved, and says what it tried', async () => {
    const specId = await createSpec([
      step({
        intent: 'open the sign-in page',
        action: 'NAVIGATE',
        data: { kind: 'LITERAL', value: BASE },
      }),
      step({
        intent: 'click a button that does not exist',
        action: 'CLICK',
        targetDescription: 'the imaginary button',
        targetHints: {
          role: 'button',
          name: 'Definitely Not Here',
          selectorCandidates: [],
        },
      }),
    ]);

    const detail = await runToCompletion(specId);

    expect(detail.status).toBe('FAILED');

    const failed = detail.steps.at(-1);
    expect(failed?.status).toBe('FAIL');
    expect(failed?.error).toContain('Definitely Not Here');
    // A failure a human cannot act on is barely better than a green run.
    expect(failed?.error).toContain('ROLE_NAME');
  }, 120_000);

  it('stops at a failing step rather than running the rest', async () => {
    const specId = await createSpec([
      step({
        intent: 'open the sign-in page',
        action: 'NAVIGATE',
        data: { kind: 'LITERAL', value: BASE },
      }),
      step({
        intent: 'click something missing',
        action: 'CLICK',
        targetHints: {
          role: 'button',
          name: 'Nope',
          selectorCandidates: [],
        },
      }),
      step({ intent: 'this should never run', action: 'NAVIGATE' }),
    ]);

    const detail = await runToCompletion(specId);

    expect(detail.steps).toHaveLength(2);
  }, 120_000);

  it('carries on past a failing optional step', async () => {
    const specId = await createSpec([
      step({
        intent: 'open the sign-in page',
        action: 'NAVIGATE',
        data: { kind: 'LITERAL', value: BASE },
      }),
      step({
        intent: 'dismiss a cookie banner that is not there',
        action: 'CLICK',
        optional: true,
        targetHints: {
          role: 'button',
          name: 'Accept cookies',
          selectorCandidates: [],
        },
      }),
      step({
        intent: 'enter the email address',
        action: 'FILL',
        targetHints: { role: 'textbox', name: 'Email', selectorCandidates: [] },
        data: { kind: 'LITERAL', value: 'demo@example.com' },
      }),
    ]);

    const detail = await runToCompletion(specId);

    expect(detail.steps).toHaveLength(3);
    expect(detail.steps[1]?.status).toBe('FAIL');
    expect(detail.steps[2]?.status).toBe('PASS');
    // An optional step failing is surfaced, but it does not fail the run.
    expect(detail.status).toBe('PASSED');
  }, 120_000);

  it('refuses to run before opening a browser when a credential is missing', async () => {
    const saved = process.env['DEMO_PASSWORD'];
    delete process.env['DEMO_PASSWORD'];

    try {
      const specId = await createSpec(loginSteps());
      const detail = await runToCompletion(specId);

      expect(detail.status).toBe('ERROR');
      expect(detail.error).toContain('DEMO_PASSWORD');
      // Nothing ran, so nothing was recorded.
      expect(detail.steps).toHaveLength(0);
    } finally {
      process.env['DEMO_PASSWORD'] = saved;
    }
  }, 120_000);

  it('rejects a specification with no version to run', async () => {
    const spec = await prisma.testSpec.create({
      data: { applicationId, name: 'Empty', source: 'MANUAL' },
    });

    await request(http)
      .post('/executions')
      .send({ specId: spec.id, environmentId })
      .expect(400);
  });
});
