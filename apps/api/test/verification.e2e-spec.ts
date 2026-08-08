import { spawn, type ChildProcess } from 'node:child_process';
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
  type VerificationResult,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { SpecsService } from './../src/specs/specs.service';

/**
 * Verification against the real demo app.
 *
 * The model is stubbed, because what needs proving is the *routing*: cheap
 * checks decide what they can, the model is consulted only when they cannot,
 * and an unresolved question never becomes a pass.
 */
describe('Verification (e2e)', () => {
  const PORT = 4396;
  const BASE = `http://localhost:${PORT}`;

  let demoApp: ChildProcess;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let specs: SpecsService;
  let applicationId: string;
  let environmentId: string;

  /** What the stubbed verifier "decides", and how often it was asked. */
  let verdict: VerificationResult;
  let modelFails = false;

  /**
   * Model calls counted per prompt, not in total.
   *
   * From Phase 6 a failing step is also *diagnosed*, which is a model call these
   * tests are not about. Counting by prompt keeps them pinning the thing they
   * were written to pin — that the verifier itself decided deterministically —
   * rather than quietly relaxing to "some calls happened".
   */
  let calls: Record<string, number> = {};
  const verifierCalls = (): number => calls['verify-step'] ?? 0;

  beforeAll(async () => {
    process.env['DEMO_USER'] = 'demo@example.com';
    process.env['DEMO_PASSWORD'] = 'hunter2';

    verdict = { status: 'PASS', rationale: 'stubbed', evidenceRefs: [] };

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
    })
      .overrideProvider(LlmService)
      .useValue({
        structured: (options: { promptId: string }) => {
          calls[options.promptId] = (calls[options.promptId] ?? 0) + 1;

          if (modelFails) {
            return Promise.reject(new Error('the model is unreachable'));
          }

          // Each prompt gets a shape its own schema would accept, so a stub
          // never stands in for a contract these tests are not checking.
          if (options.promptId === 'diagnose-failure') {
            return Promise.resolve({
              diagnosis: 'UNKNOWN',
              confidence: 0.2,
              rationale: 'stubbed',
            });
          }

          return Promise.resolve(verdict);
        },
      })
      .compile();

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
          .send({ name: 'Verification' })
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
            credentialRefs: { extra: {} },
          })
          .expect(201)
      ).body,
    ).id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    demoApp?.kill();
  });

  beforeEach(() => {
    calls = {};
    modelFails = false;
  });

  const navigate = (
    expectation: DraftTestStep['expectation'],
  ): DraftTestStep => ({
    intent: 'open the sign-in page',
    action: 'NAVIGATE',
    targetDescription: null,
    targetHints: { selectorCandidates: [] },
    data: { kind: 'LITERAL', value: BASE },
    expectation,
    optional: false,
  });

  async function run(steps: DraftTestStep[]) {
    const spec = await prisma.testSpec.create({
      data: { applicationId, name: 'Verify me', source: 'MANUAL' },
    });
    await specs.createVersion(spec.id, { steps });

    const started = executionSchema.parse(
      (
        await request(http)
          .post('/executions')
          .send({ specId: spec.id, environmentId })
          .expect(201)
      ).body,
    );

    const deadline = Date.now() + 90_000;

    for (;;) {
      const detail = executionDetailSchema.parse(
        (await request(http).get(`/executions/${started.id}`).expect(200)).body,
      );

      if (!['PENDING', 'RUNNING'].includes(detail.status)) return detail;
      if (Date.now() > deadline) throw new Error('run stalled');

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  it('passes a satisfied URL expectation without asking the model', async () => {
    const detail = await run([
      navigate({ kind: 'URL', match: 'prefix', value: BASE }),
    ]);

    expect(detail.status).toBe('PASSED');
    expect(detail.steps[0]?.verifierRationale).toContain('URL prefix');
    // The whole point of deterministic-first: a decidable step costs nothing.
    expect(verifierCalls()).toBe(0);
  }, 120_000);

  it('fails a false expectation and quotes the actual URL', async () => {
    const detail = await run([
      navigate({ kind: 'URL', match: 'prefix', value: '/definitely-not-here' }),
    ]);

    expect(detail.status).toBe('FAILED');

    const step = detail.steps[0];
    expect(step?.status).toBe('FAIL');
    expect(step?.verifierRationale).toContain('/definitely-not-here');
    expect(step?.verifierRationale).toContain('/');
    // The action itself succeeded — this is the verifier's verdict, not an error.
    expect(step?.error).toBeNull();
    expect(verifierCalls()).toBe(0);
  }, 120_000);

  it('checks text on the page deterministically', async () => {
    const passing = await run([navigate({ kind: 'TEXT', value: 'Sign in' })]);
    expect(passing.status).toBe('PASSED');

    const failing = await run([
      navigate({ kind: 'TEXT', value: 'Order confirmed' }),
    ]);
    expect(failing.status).toBe('FAILED');
    expect(failing.steps[0]?.verifierRationale).toContain('Order confirmed');
    expect(verifierCalls()).toBe(0);
  }, 180_000);

  it('asks the model only for a semantic expectation', async () => {
    verdict = {
      status: 'PASS',
      rationale: 'The sign-in form is present and ready.',
      evidenceRefs: [],
    };

    const detail = await run([
      navigate({
        kind: 'SEMANTIC',
        description: 'the page offers a way to sign in',
      }),
    ]);

    expect(detail.status).toBe('PASSED');
    expect(detail.steps[0]?.verifierRationale).toBe(
      'The sign-in form is present and ready.',
    );
    expect(verifierCalls()).toBe(1);
  }, 120_000);

  it('records UNCERTAIN and refuses to call the run passed', async () => {
    verdict = {
      status: 'UNCERTAIN',
      rationale: 'The snapshot does not show whether the total is correct.',
      evidenceRefs: [],
    };

    const detail = await run([
      navigate({ kind: 'SEMANTIC', description: 'the order total is right' }),
    ]);

    // An unresolved question is neither a pass nor a failure.
    expect(detail.steps[0]?.status).toBe('UNCERTAIN');
    expect(detail.status).toBe('UNCERTAIN');
    expect(detail.steps[0]?.verifierRationale).toContain('does not show');
  }, 120_000);

  it('keeps running after an UNCERTAIN step, unlike a failure', async () => {
    verdict = {
      status: 'UNCERTAIN',
      rationale: 'Cannot tell from here.',
      evidenceRefs: [],
    };

    const detail = await run([
      navigate({ kind: 'SEMANTIC', description: 'something unknowable' }),
      navigate({ kind: 'URL', match: 'prefix', value: BASE }),
    ]);

    expect(detail.steps).toHaveLength(2);
    expect(detail.steps[1]?.status).toBe('PASS');
    // One open question still leaves the run unresolved overall.
    expect(detail.status).toBe('UNCERTAIN');
  }, 120_000);

  it('falls back to the model when a check cannot be evaluated', async () => {
    verdict = {
      status: 'PASS',
      rationale: 'Judged from the snapshot.',
      evidenceRefs: [],
    };

    const detail = await run([
      navigate({
        // No hints to look for, so there is nothing to check deterministically.
        kind: 'VISIBLE',
        description: 'the reassuring bit at the bottom',
      }),
    ]);

    expect(verifierCalls()).toBe(1);
    expect(detail.steps[0]?.status).toBe('PASS');
  }, 120_000);

  it('does not turn an unreachable model into a pass', async () => {
    modelFails = true;

    const detail = await run([
      navigate({
        // Nothing matched, so the deterministic check is inconclusive and the
        // step escalates — into a model call that is about to fail.
        kind: 'NETWORK_OK',
        urlPattern: '/never-requested',
        maxStatus: 399,
      }),
    ]);

    expect(verifierCalls()).toBe(1);
    // The failure mode that matters: a broken verifier must leave the step
    // unresolved for a human, never quietly report success.
    expect(detail.steps[0]?.status).toBe('UNCERTAIN');
    expect(detail.status).toBe('UNCERTAIN');
    expect(detail.steps[0]?.verifierRationale).toContain('unreachable');
  }, 120_000);

  describe('adjudication', () => {
    it('lets a human settle an UNCERTAIN step and turns the run green', async () => {
      verdict = {
        status: 'UNCERTAIN',
        rationale: 'Cannot tell whether the total is right.',
        evidenceRefs: [],
      };

      const detail = await run([
        navigate({ kind: 'SEMANTIC', description: 'the total is right' }),
      ]);

      expect(detail.status).toBe('UNCERTAIN');

      const settled = executionDetailSchema.parse(
        (
          await request(http)
            .patch(`/executions/${detail.id}/steps/${detail.steps[0]?.id}`)
            .send({ status: 'PASS', note: 'checked by hand' })
            .expect(200)
        ).body,
      );

      expect(settled.steps[0]?.status).toBe('PASS');
      expect(settled.status).toBe('PASSED');
      // Both the verifier's doubt and the human's decision stay on the record.
      expect(settled.steps[0]?.verifierRationale).toContain('Cannot tell');
      expect(settled.steps[0]?.verifierRationale).toContain('checked by hand');
    }, 120_000);

    it('refuses to adjudicate a step that was already decided', async () => {
      const detail = await run([
        navigate({ kind: 'URL', match: 'prefix', value: BASE }),
      ]);

      expect(detail.steps[0]?.status).toBe('PASS');

      // Adjudication resolves open questions; it is not an override switch.
      await request(http)
        .patch(`/executions/${detail.id}/steps/${detail.steps[0]?.id}`)
        .send({ status: 'FAIL' })
        .expect(400);
    }, 120_000);
  });

  it('is inconclusive rather than passing when no request matched', async () => {
    verdict = {
      status: 'UNCERTAIN',
      rationale: 'No requests to judge.',
      evidenceRefs: [],
    };

    const detail = await run([
      navigate({
        kind: 'NETWORK_OK',
        urlPattern: '/never-requested',
        maxStatus: 399,
      }),
    ]);

    // "No evidence of failure" is not "evidence of success", so this escalated
    // rather than passing by default.
    expect(verifierCalls()).toBe(1);
    expect(detail.status).toBe('UNCERTAIN');
  }, 120_000);
});
