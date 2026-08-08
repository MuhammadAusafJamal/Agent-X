import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  explorationResultSchema,
  paginated,
  testSpecSchema,
  type ExploreAction,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * The explorer, against a real application with a real "Delete account" button.
 *
 * The model is stubbed to propose exactly the moves a real one eventually
 * proposes — an off-site link, a destructive control, a loop — because what is
 * under test is not whether a model behaves, but whether it *matters* if it
 * does not. The demo app counts destructive activations server-side, so the
 * central assertion rests on evidence rather than on the absence of a click.
 */
describe('Explorer (e2e)', () => {
  const PORT = 4421;
  const BASE = `http://localhost:${PORT}`;

  let demoApp: ChildProcess;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let applicationId: string;
  let environmentId: string;

  /** The moves the stubbed model makes, in order. */
  let script: ExploreAction[] = [];
  let turn = 0;

  const action = (partial: Partial<ExploreAction>): ExploreAction => ({
    reasoning: 'because',
    action: 'CLICK',
    role: null,
    name: null,
    value: null,
    intent: null,
    ...partial,
  });

  const destroyedCount = async (): Promise<number> => {
    const response = await fetch(`${BASE}/danger/count`);
    return ((await response.json()) as { destroyed: number }).destroyed;
  };

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
        structured: (options: { promptId: string }) => {
          if (options.promptId === 'explore-summary') {
            return Promise.resolve({
              name: 'Sign in and reach the dashboard',
              description: 'Explored from the sign-in page.',
              flowName: 'sign in',
            });
          }

          const next = script[turn] ?? action({ action: 'DONE' });
          turn += 1;
          return Promise.resolve(next);
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const project = await prisma.project.create({ data: { name: 'Explore' } });
    const application = await prisma.application.create({
      data: { projectId: project.id, name: 'Demo Shop', baseUrl: BASE },
    });
    applicationId = application.id;

    const environment = await prisma.environment.create({
      data: { applicationId, name: 'local', baseUrl: BASE },
    });
    environmentId = environment.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    demoApp?.kill();
  });

  beforeEach(() => {
    turn = 0;
    script = [];
  });

  const explore = async (goal: string, overrides: object = {}) =>
    explorationResultSchema.parse(
      (
        await request(http)
          .post('/explorations')
          .send({
            applicationId,
            environmentId,
            goal,
            maxSteps: 6,
            maxDurationSeconds: 60,
            ...overrides,
          })
          .expect(201)
      ).body,
    );

  it('walks a flow and proposes a specification from what it did', async () => {
    script = [
      action({
        action: 'FILL',
        role: 'textbox',
        name: 'Email',
        value: 'demo@example.com',
        intent: 'enter the email address',
      }),
      action({
        action: 'CLICK',
        role: 'button',
        name: 'Sign in',
        intent: 'submit the sign-in form',
      }),
      action({ action: 'DONE' }),
    ];

    const result = await explore('sign in and reach the dashboard');

    expect(result.stoppedBecause).toBe('GOAL_REACHED');
    expect(result.trail).toContain('enter the email address');
    expect(result.proposedSpecId).not.toBeNull();

    const spec = await prisma.testSpec.findUniqueOrThrow({
      where: { id: result.proposedSpecId! },
      include: { versions: { include: { steps: true } } },
    });

    // A proposal, not a trusted test. `source` is what says so.
    expect(spec.source).toBe('EXPLORED');
    expect(spec.versions[0]?.source).toBe('EXPLORED');

    // The steps are the moves that actually succeeded — the opening navigation
    // plus the two the model chose — not the model's recollection of them.
    expect(spec.versions[0]?.steps).toHaveLength(3);

    const flow = await prisma.knowledgeItem.findFirst({
      where: { applicationId, kind: 'FLOW' },
    });
    expect(flow?.key).toBe('sign in');
  }, 180_000);

  it('never activates a destructive control, however plainly it is offered', async () => {
    const before = await destroyedCount();

    script = [
      action({
        action: 'FILL',
        role: 'textbox',
        name: 'Email',
        value: 'demo@example.com',
        intent: 'enter the email address',
      }),
      action({
        action: 'CLICK',
        role: 'button',
        name: 'Sign in',
        intent: 'submit the sign-in form',
      }),
      // The dashboard has a real Delete account button wired to a real endpoint.
      action({
        action: 'CLICK',
        role: 'button',
        name: 'Delete account',
        intent: 'delete the account',
      }),
      action({ action: 'DONE' }),
    ];

    const result = await explore('tidy up the account');

    // The assertion that matters: the server was never asked to destroy
    // anything. Not "we did not record a click" — the application itself agrees.
    await expect(destroyedCount()).resolves.toBe(before);

    expect(result.refused.some((line) => line.includes('Delete account'))).toBe(
      true,
    );
    expect(result.trail).not.toContain('delete the account');
  }, 180_000);

  it('refuses to leave the environment’s origin', async () => {
    script = [
      action({
        action: 'NAVIGATE',
        value: 'https://example.com/support',
        intent: 'read the support page',
      }),
      action({
        action: 'NAVIGATE',
        value: '//evil.example.com/',
        intent: 'go somewhere else',
      }),
      action({ action: 'DONE' }),
    ];

    const result = await explore('find the support page');

    expect(result.refused).toHaveLength(2);
    expect(result.refused[0]).toContain('outside');
    expect(result.visited.every((url) => url.startsWith(BASE))).toBe(true);
  }, 180_000);

  it('stops at its step budget and says so', async () => {
    // Always a valid, repeatable move, so only the budget can end this.
    script = Array.from({ length: 20 }, () =>
      action({
        action: 'FILL',
        role: 'textbox',
        name: 'Email',
        value: 'demo@example.com',
        intent: 'enter the email address',
      }),
    );

    const result = await explore('go round in circles', { maxSteps: 3 });

    expect(result.stoppedBecause).toBe('STEP_BUDGET');
    expect(result.stepsTaken).toBe(3);
  }, 180_000);

  it('gives up rather than burning turns on moves that keep being refused', async () => {
    script = Array.from({ length: 20 }, () =>
      action({
        action: 'CLICK',
        role: 'button',
        name: 'Delete account',
        intent: 'delete the account',
      }),
    );

    const result = await explore('delete everything');

    expect(result.stoppedBecause).toBe('STUCK');
    expect(result.stepsTaken).toBe(0);
  }, 180_000);

  it('proposes nothing when it never got anywhere', async () => {
    script = [action({ action: 'DONE' })];

    const result = await explore('do nothing at all');

    // One navigation is not a flow, and a specification with a single step is
    // noise in the list rather than a test anyone would run.
    expect(result.proposedSpecId).toBeNull();

    const specs = paginated(testSpecSchema).parse(
      (
        await request(http)
          .get(`/specs?applicationId=${applicationId}`)
          .expect(200)
      ).body,
    );

    expect(specs.items.every((spec) => spec.name !== 'do nothing at all')).toBe(
      true,
    );
  }, 180_000);
});
