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
 * The loop this whole phase exists for, against the real demo app.
 *
 * The model is stubbed, because what needs proving is not that a model can
 * classify well — it is the *wiring* around it: that a failure is classified
 * before anything reacts to it, that only `TEST_DRIFT` reaches the healer, that
 * a repair is proved by reverification before it counts, and above all that an
 * application bug produces a report rather than a rewritten test.
 */
describe('Diagnose and heal (e2e)', () => {
  /**
   * A port per scenario, never reused, and clear of every other suite.
   *
   * Each scenario needs a *differently broken* demo app, and the flags are read
   * at startup, so the server must be replaced between tests. Reusing one port
   * makes readiness ambiguous: the outgoing server can still answer while the
   * incoming one is failing to bind, and the test then runs happily against the
   * previous scenario's page.
   *
   * The range matters as much as the reuse. Sibling suites hold 4396–4399 for
   * the whole run, and a scenario that lands on one of those binds nothing,
   * gets a cheerful 200 from *their* unbroken demo app, and quietly tests the
   * wrong page — which is exactly how this suite passed alone and failed in
   * parallel.
   */
  let nextPort = 4410;
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
  let applicationId: string;
  let environmentId: string;

  let calls: Record<string, number> = {};

  /** What the stubbed model answers, per prompt. */
  let elementChoice: unknown;
  let diagnosis: unknown;
  let healProposal: unknown;

  /**
   * Restarts the demo app with a different breakage.
   *
   * Readiness is established by *asking it*, not by watching stdout: under a
   * loaded parallel test run the pipe can lag well behind the listening socket,
   * and a fixed sleep either flakes or wastes seconds on every scenario.
   */
  async function startDemo(env: Record<string, string>) {
    await stopDemo();

    PORT = nextPort++;
    BASE = `http://localhost:${PORT}`;

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

  /** Waits for the process to actually exit, so the next one can bind the port. */
  async function stopDemo() {
    if (demoApp === null) return;

    const dying = demoApp;
    demoApp = null;

    await new Promise<void>((resolve) => {
      const give_up = setTimeout(resolve, 5000);
      dying.once('exit', () => {
        clearTimeout(give_up);
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
        structured: (options: { promptId: string }) => {
          calls[options.promptId] = (calls[options.promptId] ?? 0) + 1;

          switch (options.promptId) {
            case 'resolve-element':
              return Promise.resolve(elementChoice);
            case 'diagnose-failure':
              return Promise.resolve(diagnosis);
            case 'heal-step':
              return Promise.resolve(healProposal);
            case 'report-bug':
              return Promise.resolve({
                title: 'Sign-in returns 500 for valid credentials',
                summary: 'The server failed while signing in.',
                expected: 'The dashboard loads.',
                actual: 'The server returned 500.',
              });
            default:
              return Promise.resolve({
                status: 'UNCERTAIN',
                rationale: 'stubbed',
                evidenceRefs: [],
              });
          }
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    specs = app.get(SpecsService);

    const project = await prisma.project.create({ data: { name: 'Heal' } });
    projectId = project.id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await stopDemo();
  }, 30_000);

  beforeEach(() => {
    calls = {};

    // What the resolver's LLM rung would say: it can name the control, but on
    // the redesigned page that name is no longer unique.
    elementChoice = {
      found: true,
      role: 'button',
      name: 'Continue',
      rationale: 'The submit control is now labelled Continue.',
    };

    diagnosis = {
      diagnosis: 'TEST_DRIFT',
      confidence: 0.85,
      rationale:
        'The page is healthy and the sign-in form is present under a new label; the recorded targeting is what stopped matching.',
    };

    // The one thing the resolver's rung cannot express: a landmark, which is
    // what makes "Continue" unambiguous again.
    healProposal = {
      found: true,
      targetHints: {
        role: 'button',
        name: 'Continue',
        landmark: 'form "Account access"',
        selectorCandidates: [],
      },
      targetDescription: 'the submit button in the account access form',
      rationale:
        'The form is now labelled "Account access" and its submit button "Continue"; the cookie notice has a Continue of its own, so the form must be named.',
    };
  });

  /**
   * A specification recorded against the *unbroken* application: every hint
   * below is true of the page before the redesign.
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
      intent: 'fill in the email address',
      action: 'FILL',
      targetDescription: 'the email field in the sign-in form',
      targetHints: {
        role: 'textbox',
        name: 'Email',
        landmark: 'form "Sign in"',
        selectorCandidates: [],
      },
      data: { kind: 'LITERAL', value: 'demo@example.com' },
      // Deliberately something the heading provides on every variant of this
      // page: these two steps are scaffolding, and an expectation that breaks
      // under a switch would stop the run before it reaches what is being
      // tested.
      expectation: { kind: 'TEXT', value: 'Sign in' },
      optional: false,
    },
    {
      intent: 'fill in the password',
      action: 'FILL',
      targetDescription: 'the password field in the sign-in form',
      targetHints: {
        landmark: 'form "Sign in"',
        selectorCandidates: [
          { strategy: 'CSS', value: '#password', score: 0.9 },
        ],
      },
      data: { kind: 'LITERAL', value: 'hunter2' },
      expectation: { kind: 'TEXT', value: 'Sign in' },
      optional: false,
    },
    {
      intent: 'submit the sign-in form',
      action: 'CLICK',
      targetDescription: 'the primary submit button in the sign-in form',
      targetHints: {
        role: 'button',
        name: 'Sign in',
        testId: 'login-submit',
        text: 'Sign in',
        landmark: 'form "Sign in"',
        selectorCandidates: [],
      },
      data: null,
      expectation: { kind: 'URL', match: 'prefix', value: '/dashboard' },
      optional: false,
    },
  ];

  /**
   * A fresh application per scenario.
   *
   * Knowledge is scoped per application and persists across runs by design, so
   * sharing one here would let what the agent learned from the *unbroken* page
   * in one scenario resolve a step in the next — which is realistic, and exactly
   * what makes a suite of scenarios order-dependent.
   */
  async function run() {
    const application = await prisma.application.create({
      data: { projectId, name: 'Demo Shop', baseUrl: BASE },
    });
    applicationId = application.id;

    const environment = await prisma.environment.create({
      data: { applicationId, name: 'local', baseUrl: BASE },
    });
    environmentId = environment.id;

    const spec = await prisma.testSpec.create({
      data: { applicationId, name: 'Sign in', source: 'RECORDED' },
    });
    await specs.createVersion(
      spec.id,
      { steps: steps() },
      { source: 'RECORDED' },
    );

    const started = executionSchema.parse(
      (
        await request(http)
          .post('/executions')
          .send({ specId: spec.id, environmentId })
          .expect(201)
      ).body,
    );

    const deadline = Date.now() + 120_000;

    for (;;) {
      const detail = executionDetailSchema.parse(
        (await request(http).get(`/executions/${started.id}`).expect(200)).body,
      );

      if (!['PENDING', 'RUNNING'].includes(detail.status)) {
        return { spec, detail };
      }
      if (Date.now() > deadline) throw new Error('run stalled');

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  it('heals a step the resolver could not, and proves it before the run goes green', async () => {
    await startDemo({ BREAK_REDESIGN: '1' });

    const { detail } = await run();

    const submit = detail.steps.at(-1);

    expect(submit?.intent).toBe('submit the sign-in form');
    expect(submit?.status).toBe('HEALED');
    expect(submit?.diagnosis).toBe('TEST_DRIFT');

    // The repair had to survive the same uniqueness rule as every other rung,
    // which the resolver's own answer did not: "Continue" alone matches the
    // cookie notice too.
    expect(submit?.resolvedSelector).toBe(
      'role=form[name="Account access"] >> role=button[name="Continue"]',
    );

    // A healed step is not a failed run.
    expect(detail.status).toBe('PASSED');

    const healing = await prisma.healingRecord.findFirstOrThrow({
      where: { executionStepId: submit!.id },
    });

    expect(healing.status).toBe('APPLIED');
    expect(healing.reverifyStatus).toBe('PASS');
    expect(healing.diagnosis).toBe('TEST_DRIFT');

    // Both states are kept: the reviewer's question is what changed.
    const shots = await prisma.artifact.findMany({
      where: { executionStepId: submit!.id, kind: 'SCREENSHOT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(shots).toHaveLength(2);
    expect(shots.at(-1)?.relPath).toContain('healed-shot');
  }, 240_000);

  it('files a bug for a server error and never offers it to the healer', async () => {
    await startDemo({ BREAK_500_ON_SUBMIT: '1' });

    const { detail } = await run();

    const submit = detail.steps.at(-1);

    expect(submit?.status).toBe('FAIL');
    expect(detail.status).toBe('FAILED');

    // Settled from the status code alone — the model was never asked to
    // classify this one.
    expect(submit?.diagnosis).toBe('APP_BUG');
    expect(calls['diagnose-failure']).toBeUndefined();

    // The safety property of the phase, at the integration level.
    expect(calls['heal-step']).toBeUndefined();

    const healings = await prisma.healingRecord.count({
      where: { executionStep: { executionId: detail.id } },
    });
    expect(healings).toBe(0);

    const bug = await prisma.bugReport.findFirstOrThrow({
      where: { executionId: detail.id },
    });

    expect(bug.severity).toBe('CRITICAL');
    expect(JSON.parse(bug.reproSteps)).toEqual([
      '1. open the sign-in page',
      '2. fill in the email address',
      '3. fill in the password',
      '4. submit the sign-in form',
    ]);
    // The failure's own evidence, captured before the reaction to it.
    expect((JSON.parse(bug.evidenceRefs) as string[]).length).toBeGreaterThan(
      0,
    );
  }, 240_000);

  it('records a repair that did not hold, and does not try again', async () => {
    await startDemo({ BREAK_REDESIGN: '1' });

    // A proposal that resolves cleanly and is simply *wrong*: the cookie
    // notice's Continue is a real, unique button that submits nothing.
    healProposal = {
      found: true,
      targetHints: {
        role: 'button',
        name: 'Continue',
        landmark: 'section "Cookie notice"',
        selectorCandidates: [],
      },
      targetDescription: 'the Continue button',
      rationale: 'Continue looks like the way forward.',
    };

    const { detail } = await run();

    const submit = detail.steps.at(-1);

    // Resolving is not proving. The step stays failed.
    expect(submit?.status).toBe('FAIL');
    expect(detail.status).toBe('FAILED');
    expect(submit?.verifierRationale).toContain('did not hold');

    const healing = await prisma.healingRecord.findFirstOrThrow({
      where: { executionStepId: submit!.id },
    });

    expect(healing.status).toBe('REVERIFY_FAILED');
    expect(healing.reverifyStatus).toBe('FAIL');

    // Asked once. A healer allowed to keep guessing eventually finds something
    // that passes for the wrong reason.
    expect(calls['heal-step']).toBe(1);

    // And nothing that failed to prove itself is offered to a reviewer.
    const queued = await prisma.healingRecord.count({
      where: {
        executionStep: { executionId: detail.id },
        status: { in: ['PROPOSED', 'APPLIED'] },
      },
    });
    expect(queued).toBe(0);
  }, 240_000);

  it('declines to heal a change no re-targeting can express', async () => {
    await startDemo({ BREAK_MOVE_FIELD: '1' });

    // The password field is not on this page at all — it moved behind a second
    // step, so neither the resolver nor the healer can find a stand-in.
    elementChoice = {
      found: false,
      role: null,
      name: null,
      rationale: 'There is no password field on this page.',
    };

    // The honest answer is that there is nothing to re-target.
    healProposal = {
      found: false,
      targetHints: null,
      targetDescription: null,
      rationale:
        'There is no password field on this page; the form was split across two steps.',
    };

    const { detail } = await run();

    const password = detail.steps.find(
      (step) => step.intent === 'fill in the password',
    );

    expect(password?.status).toBe('FAIL');
    expect(password?.verifierRationale).toContain('split across two steps');

    // Declining is not the same as failing to try: the healer was asked, and
    // said no. Nothing was queued, because there is nothing to approve.
    expect(calls['heal-step']).toBe(1);

    const healings = await prisma.healingRecord.count({
      where: { executionStep: { executionId: detail.id } },
    });
    expect(healings).toBe(0);
  }, 240_000);

  it('queues a repair for a step that only passed because the model found it', async () => {
    // A plain rename: the resolver's own rung is enough to carry the run, so
    // nothing fails. The specification is still wrong, though, and would need a
    // model call on every future run.
    await startDemo({ BREAK_RENAME_SUBMIT: '1' });

    const { detail } = await run();

    const submit = detail.steps.at(-1);

    expect(submit?.status).toBe('PASS');
    expect(submit?.resolutionStrategy).toBe('LLM');
    expect(detail.status).toBe('PASSED');

    const healing = await prisma.healingRecord.findFirstOrThrow({
      where: { executionStepId: submit!.id },
    });

    // Already proven — the step ran against this target and verified — so it
    // goes straight to the queue without a second model call.
    expect(healing.status).toBe('APPLIED');
    expect(healing.reverifyStatus).toBe('PASS');
    expect(calls['heal-step']).toBeUndefined();

    expect(JSON.parse(healing.proposedTarget)).toMatchObject({
      role: 'button',
      name: 'Continue',
    });
  }, 240_000);
});
