import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  executionDetailSchema,
  executionSchema,
  type DraftTestStep,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { SpecsService } from './../src/specs/specs.service';

/**
 * The oracle, against the real demo app.
 *
 * Every other break switch in the demo app breaks the UI or the transport, and
 * every one of them is catchable by a URL, TEXT, VISIBLE, or status-code check.
 * `BREAK_WRONG_INVOICE_TOTAL` breaks a **computed value** and leaves the page
 * looking perfect: the confirmation still shows the amount the user typed, the
 * request still returns 200, nothing is logged. Only the response body is wrong.
 *
 * So this suite pins two things, and the second matters more than the first:
 *
 * 1. An `API_RESPONSE` expectation fails when the total is wrong.
 * 2. The UI-level expectations **pass** in that same broken run.
 *
 * Without (2), (1) proves only that something went red. Together they prove the
 * class of defect a recorded baseline structurally cannot see — which is the
 * reason the expectation kind exists.
 *
 * The model is stubbed. What is under test is the machinery: body capture in the
 * collector, the run-scoped network log, and `checkApiResponse`. Whether a model
 * can write a good expectation is a different question, and not one a
 * deterministic test can answer.
 */
describe('Value oracle (e2e)', () => {
  // Clear of the ranges the sibling suites hold; a scenario that lands on one
  // of theirs would quietly test their unbroken demo app.
  let nextPort = 4440;
  let PORT = nextPort;
  let BASE = `http://localhost:${String(PORT)}`;

  const DEMO = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'examples',
    'demo-app',
    'server.js',
  );

  let demoApp: ChildProcess | null = null;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let specs: SpecsService;
  let projectId: string;

  async function startDemo(env: Record<string, string>) {
    await stopDemo();

    PORT = nextPort++;
    BASE = `http://localhost:${String(PORT)}`;

    demoApp = spawn(process.execPath, [DEMO], {
      env: { ...process.env, DEMO_PORT: String(PORT), ...env },
      stdio: 'pipe',
    });

    const deadline = Date.now() + 30_000;

    for (;;) {
      try {
        if ((await fetch(BASE)).ok) return;
      } catch {
        /* not listening yet */
      }

      if (Date.now() > deadline) throw new Error('demo app did not start');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function stopDemo() {
    if (demoApp === null) return;

    const dying = demoApp;
    demoApp = null;

    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(resolve, 5000);
      dying.once('exit', () => {
        clearTimeout(giveUp);
        resolve();
      });
      dying.kill();
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmService)
      .useValue({
        // Nothing here should need the model. If a step escalates, the verdict
        // below is UNCERTAIN rather than PASS, and the assertion catches it.
        structured: () =>
          Promise.resolve({
            status: 'UNCERTAIN',
            rationale: 'stubbed',
            evidenceRefs: [],
          }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    specs = app.get(SpecsService);

    const project = await prisma.project.create({ data: { name: 'Oracle' } });
    projectId = project.id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await stopDemo();
  }, 30_000);

  /**
   * Sign in, create an invoice for 100, then check the two things a criterion
   * would ask: what the page says, and what the API returned.
   *
   * The two assertion steps are deliberately adjacent, on the same run, so a
   * disagreement between them is the finding.
   */
  const steps = (): DraftTestStep[] => [
    {
      intent: 'open the sign-in page',
      action: 'NAVIGATE',
      targetDescription: null,
      targetHints: { selectorCandidates: [] },
      data: { kind: 'LITERAL', value: BASE },
      expectation: { kind: 'TEXT', value: 'Sign in' },
      optional: false,
    },
    {
      intent: 'enter the email address',
      action: 'FILL',
      targetDescription: 'the email field',
      targetHints: {
        role: 'textbox',
        name: 'Email',
        selectorCandidates: [{ strategy: 'CSS', value: '#email', score: 0.9 }],
      },
      data: { kind: 'LITERAL', value: 'demo@example.com' },
      expectation: { kind: 'TEXT', value: 'Password' },
      optional: false,
    },
    {
      intent: 'enter the password',
      action: 'FILL',
      targetDescription: 'the password field',
      targetHints: {
        selectorCandidates: [
          { strategy: 'CSS', value: '#password', score: 0.9 },
        ],
      },
      data: { kind: 'LITERAL', value: 'hunter2' },
      expectation: { kind: 'TEXT', value: 'Password' },
      optional: false,
    },
    {
      intent: 'submit the sign-in form',
      action: 'CLICK',
      targetDescription: 'the submit button',
      targetHints: {
        role: 'button',
        name: 'Sign in',
        testId: 'login-submit',
        selectorCandidates: [],
      },
      data: null,
      expectation: { kind: 'URL', match: 'prefix', value: '/dashboard' },
      optional: false,
    },
    {
      intent: 'enter an invoice amount of 100',
      action: 'FILL',
      targetDescription: 'the invoice amount field',
      targetHints: {
        selectorCandidates: [{ strategy: 'CSS', value: '#amount', score: 0.9 }],
      },
      data: { kind: 'LITERAL', value: '100' },
      expectation: { kind: 'TEXT', value: 'Invoice amount' },
      optional: false,
    },
    {
      intent: 'create the invoice',
      action: 'CLICK',
      targetDescription: 'the create invoice button',
      targetHints: {
        role: 'button',
        name: 'Create invoice',
        testId: 'create-invoice',
        selectorCandidates: [],
      },
      data: null,
      expectation: { kind: 'TEXT', value: 'Invoice for 100 created.' },
      optional: false,
    },
    {
      // Index 6. What a recorded spec would assert, and what the demo app keeps
      // truthful even when the total is wrong.
      intent:
        'the page confirms the invoice was created for the amount entered',
      action: 'ASSERT',
      targetDescription: null,
      targetHints: { selectorCandidates: [] },
      data: null,
      expectation: { kind: 'TEXT', value: 'Invoice for 100 created.' },
      optional: false,
    },
    {
      // Index 7. The criterion: the API returned the right total.
      intent: 'the invoice total equals the amount entered',
      action: 'ASSERT',
      targetDescription: null,
      targetHints: { selectorCandidates: [] },
      data: null,
      expectation: {
        kind: 'API_RESPONSE',
        urlPattern: '/api/invoices',
        jsonPath: 'invoice.total',
        match: 'equals',
        value: '100',
      },
      optional: false,
    },
  ];

  async function runAgainst(env: Record<string, string>) {
    await startDemo(env);

    const application = await prisma.application.create({
      data: { projectId, name: `Oracle ${PORT}`, baseUrl: BASE },
    });

    const environment = await prisma.environment.create({
      data: { applicationId: application.id, name: 'local', baseUrl: BASE },
    });

    const spec = await prisma.testSpec.create({
      data: {
        applicationId: application.id,
        name: 'Create an invoice',
        source: 'GENERATED',
        priority: 'CRITICAL',
      },
    });

    await specs.createVersion(
      spec.id,
      { note: 'oracle', steps: steps() },
      { source: 'GENERATED' },
    );

    const started = executionSchema.parse(
      (
        await request(http)
          .post('/executions')
          .send({ specId: spec.id, environmentId: environment.id })
          .expect(201)
      ).body,
    );

    const deadline = Date.now() + 120_000;

    for (;;) {
      const detail = executionDetailSchema.parse(
        (await request(http).get(`/executions/${started.id}`).expect(200)).body,
      );

      if (detail.status !== 'PENDING' && detail.status !== 'RUNNING') {
        return detail;
      }

      if (Date.now() > deadline) throw new Error('run did not finish');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  it('passes every step when the application is healthy', async () => {
    const detail = await runAgainst({});

    const api = detail.steps.find((step) => step.index === 7);

    expect(api?.status).toBe('PASS');
    expect(detail.status).toBe('PASSED');
  }, 180_000);

  it('fails the value criterion when the API returns the wrong total', async () => {
    const detail = await runAgainst({ BREAK_WRONG_INVOICE_TOTAL: '1' });

    const page = detail.steps.find((step) => step.index === 6);
    const api = detail.steps.find((step) => step.index === 7);

    // The finding, in two lines: the page is right and the payload is not.
    // A tool whose oracle is a recording sees only the first line and reports
    // green over an application that computed the wrong number.
    console.log(
      'STEP6',
      JSON.stringify({ s: page?.status, r: page?.verifierRationale }),
    );
    console.log(
      'STEP7',
      JSON.stringify({ s: api?.status, r: api?.verifierRationale }),
    );
    expect(page?.status).toBe('PASS');
    expect(api?.status).toBe('FAIL');

    // A failure a human cannot act on is barely better than a green run.
    expect(api?.verifierRationale).toContain('110');
    expect(api?.verifierRationale).toContain('invoice.total');

    expect(detail.status).toBe('FAILED');
  }, 180_000);
});
