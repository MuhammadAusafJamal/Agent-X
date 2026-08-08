import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  executionDetailSchema,
  executionSchema,
  reportBodyOf,
  reportSchema,
  type DraftTestStep,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { SpecsService } from './../src/specs/specs.service';
import { ConsolidationService } from './../src/knowledge/consolidation.service';

/**
 * Reports and consolidation, over two real runs of the same specification.
 *
 * These two epics are tested together because they are both answers to the same
 * question — what a finished run leaves behind — and because the interesting
 * assertions need *two* runs, which is expensive enough to want to do once.
 */
describe('Reports and consolidation (e2e)', () => {
  const PORT = 4420;
  const BASE = `http://localhost:${PORT}`;

  let demoApp: ChildProcess;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let specs: SpecsService;
  let consolidation: ConsolidationService;
  let applicationId: string;
  let environmentId: string;
  let specId: string;

  /** Deterministic throughout: nothing here should need the model. */
  const steps: DraftTestStep[] = [
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
      targetDescription: 'the email field in the sign-in form',
      targetHints: {
        role: 'textbox',
        name: 'Email',
        landmark: 'form "Sign in"',
        selectorCandidates: [],
      },
      data: { kind: 'LITERAL', value: 'demo@example.com' },
      expectation: { kind: 'TEXT', value: 'Password' },
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
        landmark: 'form "Sign in"',
        selectorCandidates: [],
      },
      data: null,
      expectation: { kind: 'URL', match: 'prefix', value: '/login' },
      optional: false,
    },
  ];

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
        15_000,
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
    })
      .overrideProvider(LlmService)
      .useValue({
        structured: () =>
          Promise.reject(
            new Error('a deterministic run must not reach the model'),
          ),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    specs = app.get(SpecsService);
    consolidation = app.get(ConsolidationService);

    const project = await prisma.project.create({ data: { name: 'Reports' } });
    const application = await prisma.application.create({
      data: { projectId: project.id, name: 'Demo Shop', baseUrl: BASE },
    });
    applicationId = application.id;

    const environment = await prisma.environment.create({
      data: { applicationId, name: 'local', baseUrl: BASE },
    });
    environmentId = environment.id;

    const spec = await prisma.testSpec.create({
      data: { applicationId, name: 'Sign in', source: 'RECORDED' },
    });
    specId = spec.id;

    await specs.createVersion(specId, { steps }, { source: 'RECORDED' });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    demoApp?.kill();
  });

  async function run() {
    const started = executionSchema.parse(
      (
        await request(http)
          .post('/executions')
          .send({ specId, environmentId })
          .expect(201)
      ).body,
    );

    const deadline = Date.now() + 120_000;

    for (;;) {
      const detail = executionDetailSchema.parse(
        (await request(http).get(`/executions/${started.id}`).expect(200)).body,
      );

      if (!['PENDING', 'RUNNING'].includes(detail.status)) return detail;
      if (Date.now() > deadline) throw new Error('run stalled');

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const reportFor = async (executionId: string) =>
    reportSchema.parse(
      (await request(http).get(`/executions/${executionId}/report`).expect(200))
        .body,
    );

  it('writes a report for every run, without being asked', async () => {
    const detail = await run();

    // Generated at the end of the run, not on first view: a report that only
    // exists once someone opens the page is not an artifact.
    const stored = await prisma.report.findUnique({
      where: { executionId: detail.id },
    });

    expect(stored).not.toBeNull();

    const report = await reportFor(detail.id);

    expect(report.json.body.specName).toBe('Sign in');
    expect(report.json.body.steps).toHaveLength(3);
    expect(report.json.run.llmCallCount).toBe(0);
  }, 180_000);

  it('produces byte-identical bodies for two runs of the same passing spec', async () => {
    const first = await reportFor((await run()).id);
    const second = await reportFor((await run()).id);

    expect(second.json.run.executionId).not.toBe(first.json.run.executionId);

    // The comparable half.
    expect(JSON.stringify(second.json.body)).toBe(
      JSON.stringify(first.json.body),
    );
    expect(reportBodyOf(second.markdown)).toBe(reportBodyOf(first.markdown));

    // And the documents as a whole are *not* identical, because the ids and
    // timings in the header are real information rather than noise to suppress.
    expect(second.markdown).not.toBe(first.markdown);
  }, 300_000);

  it('reads standalone, and serves as a file', async () => {
    const detail = await run();

    const response = await request(http)
      .get(`/executions/${detail.id}/report/markdown`)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['content-disposition']).toContain('attachment');

    const markdown = response.text;

    expect(markdown).toContain('# Sign in');
    expect(markdown).toContain('open the sign-in page');
    // Outcomes and reasons, not just statuses.
    expect(markdown).toContain('Found “Sign in” on the page.');
    // Evidence is linked relative to the run's own directory, so the file works
    // next to the evidence it references.
    expect(markdown).toMatch(/\[step-0\/[a-z.]+\]\(step-0\/[a-z.]+\)/);
  }, 180_000);

  it('climbs a stable target’s confidence across runs', async () => {
    const key = 'click.the-primary-submit-button-in-the-sign-in-form';

    const before = await prisma.knowledgeItem.findUnique({
      where: {
        applicationId_kind_key: {
          applicationId,
          kind: 'SELECTOR_MEMORY',
          key,
        },
      },
    });

    await run();

    const after = await prisma.knowledgeItem.findUniqueOrThrow({
      where: {
        applicationId_kind_key: {
          applicationId,
          kind: 'SELECTOR_MEMORY',
          key,
        },
      },
    });

    expect(after.hitCount).toBeGreaterThan(before?.hitCount ?? 0);
    expect(after.confidence).toBeGreaterThan(before?.confidence ?? 0);
    expect(after.value).toContain('role=button[name=\\"Sign in\\"]');
  }, 180_000);

  it('re-consolidating a run is a no-op', async () => {
    const detail = await run();

    const key = 'click.the-primary-submit-button-in-the-sign-in-form';
    const where = {
      applicationId_kind_key: {
        applicationId,
        kind: 'SELECTOR_MEMORY',
        key,
      },
    };

    const before = await prisma.knowledgeItem.findUniqueOrThrow({ where });

    // The runner already consolidated this run. Doing it again must not let
    // replayed history inflate what the agent believes.
    const result = await consolidation.consolidate(detail.id);
    const after = await prisma.knowledgeItem.findUniqueOrThrow({ where });

    expect(result.folded).toBe(0);
    expect(after.confidence).toBe(before.confidence);
    expect(after.hitCount).toBe(before.hitCount);
  }, 180_000);

  it('decays a target that stopped working, until rung 1 stops trying it', async () => {
    const key = 'click.a-control-that-is-not-there';

    // A memory of something that no longer exists, at the confidence three
    // clean runs would have earned it.
    await prisma.knowledgeItem.create({
      data: {
        applicationId,
        kind: 'SELECTOR_MEMORY',
        key,
        value: JSON.stringify({
          kind: 'SELECTOR_MEMORY',
          stepKey: key,
          selector: '#long-gone',
          strategy: 'CSS',
        }),
        confidence: 0.8,
        hitCount: 3,
        lastSeenAt: new Date(),
      },
    });

    const doomed = await prisma.testSpec.create({
      data: { applicationId, name: 'Vanished control', source: 'MANUAL' },
    });

    await specs.createVersion(doomed.id, {
      steps: [
        steps[0],
        {
          intent: 'click a control that is not there',
          action: 'CLICK',
          targetDescription: 'a control that is not there',
          targetHints: {
            role: 'button',
            name: 'Nonexistent',
            selectorCandidates: [],
          },
          data: null,
          expectation: { kind: 'TEXT', value: 'Sign in' },
          optional: false,
        },
      ],
    });

    const started = executionSchema.parse(
      (
        await request(http)
          .post('/executions')
          .send({ specId: doomed.id, environmentId })
          .expect(201)
      ).body,
    );

    const deadline = Date.now() + 120_000;
    for (;;) {
      const detail = executionDetailSchema.parse(
        (await request(http).get(`/executions/${started.id}`).expect(200)).body,
      );
      if (!['PENDING', 'RUNNING'].includes(detail.status)) break;
      if (Date.now() > deadline) throw new Error('run stalled');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const after = await prisma.knowledgeItem.findUniqueOrThrow({
      where: {
        applicationId_kind_key: {
          applicationId,
          kind: 'SELECTOR_MEMORY',
          key,
        },
      },
    });

    // One miss costs more than three hits earned: stale knowledge is worse than
    // none, because it sends the resolver confidently at the wrong element.
    expect(after.confidence).toBeLessThan(0.8);
    expect(after.missCount).toBe(1);
  }, 240_000);
});
