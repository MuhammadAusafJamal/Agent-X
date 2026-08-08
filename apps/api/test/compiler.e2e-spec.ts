import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  applicationSchema,
  projectSchema,
  testSpecWithCurrentVersionSchema,
  testVersionWithStepsSchema,
  type CompiledSpec,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * The compiler, with the model stubbed.
 *
 * What matters here is not the model's prose — it is that the *server* attaches
 * the real recorded targeting data, keeps secrets as references, and writes an
 * immutable version. Those are the properties a wrong model response must not
 * be able to break, so they are tested without one.
 */
describe('Compiler (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let applicationId: string;

  /** What the stubbed model "returns". Overwritten per test. */
  let compiled: CompiledSpec;

  beforeAll(async () => {
    compiled = { name: 'placeholder', description: null, steps: [] };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmService)
      .useValue({
        structured: () => Promise.resolve(compiled),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const project = projectSchema.parse(
      (
        await request(http)
          .post('/projects')
          .send({ name: 'Compiler' })
          .expect(201)
      ).body,
    );

    applicationId = applicationSchema.parse(
      (
        await request(http)
          .post('/applications')
          .send({
            projectId: project.id,
            name: 'Demo Shop',
            baseUrl: 'http://localhost:4321',
          })
          .expect(201)
      ).body,
    ).id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Seeds a stopped recording with a realistic login event log. */
  async function seedRecording(): Promise<string> {
    const recording = await prisma.recording.create({
      data: {
        applicationId,
        startUrl: 'http://localhost:4321',
        status: 'STOPPED',
        stoppedAt: new Date(),
      },
    });

    const events = [
      {
        index: 0,
        type: 'NAVIGATE',
        url: 'http://localhost:4321/',
        value: null,
        isSecret: false,
        targetRole: null,
        targetName: null,
        targetTestId: null,
        selectorCandidates: '[]',
      },
      {
        index: 1,
        type: 'INPUT',
        url: 'http://localhost:4321/',
        value: 'demo@example.com',
        isSecret: false,
        targetRole: 'textbox',
        targetName: 'Email',
        targetTestId: null,
        selectorCandidates: JSON.stringify([
          { strategy: 'CSS', value: '#email', score: 0.85 },
        ]),
      },
      {
        index: 2,
        type: 'INPUT',
        url: 'http://localhost:4321/',
        value: null,
        isSecret: true,
        targetRole: 'textbox',
        targetName: 'Password',
        targetTestId: null,
        selectorCandidates: '[]',
      },
      {
        index: 3,
        type: 'CLICK',
        url: 'http://localhost:4321/',
        value: null,
        isSecret: false,
        targetRole: 'button',
        targetName: 'Sign in',
        targetTestId: 'login-submit',
        selectorCandidates: JSON.stringify([
          { strategy: 'TEST_ID', value: 'login-submit', score: 0.95 },
          { strategy: 'ROLE_NAME', value: 'button|Sign in', score: 0.8 },
        ]),
      },
    ];

    for (const event of events) {
      await prisma.recordedEvent.create({
        data: {
          recordingId: recording.id,
          timestamp: new Date(),
          landmark: 'form "Sign in"',
          ...event,
        },
      });
    }

    return recording.id;
  }

  it('attaches the recorded targeting data, which the model never supplies', async () => {
    const recordingId = await seedRecording();

    compiled = {
      name: 'Sign in with the seeded account',
      description: 'Signs in from the login form.',
      steps: [
        {
          sourceEventIndex: 3,
          intent: 'submit the sign-in form',
          action: 'CLICK',
          targetDescription: 'the primary submit button in the login form',
          data: { kind: 'NONE' },
          expectation: { kind: 'URL', match: 'prefix', value: '/dashboard' },
          optional: false,
        },
      ],
    };

    const spec = testSpecWithCurrentVersionSchema.parse(
      (
        await request(http)
          .post(`/recordings/${recordingId}/compile`)
          .expect(201)
      ).body,
    );

    const step = spec.currentVersion?.steps[0];

    // The hints are the recorder's, not the model's.
    expect(step?.targetHints.role).toBe('button');
    expect(step?.targetHints.name).toBe('Sign in');
    expect(step?.targetHints.testId).toBe('login-submit');
    expect(step?.targetHints.landmark).toBe('form "Sign in"');
    expect(step?.targetHints.selectorCandidates).toHaveLength(2);
    // And the intent stays free of them.
    expect(step?.intent).not.toContain('login-submit');
  });

  it('keeps a password as an environment reference, never a value', async () => {
    const recordingId = await seedRecording();

    compiled = {
      name: 'Sign in',
      description: null,
      steps: [
        {
          sourceEventIndex: 2,
          intent: 'enter the password for the seeded user',
          action: 'FILL',
          targetDescription: 'the password field',
          data: { kind: 'ENV_REF', envVar: 'DEMO_PASSWORD' },
          expectation: {
            kind: 'SEMANTIC',
            description: 'the field accepts it',
          },
          optional: false,
        },
      ],
    };

    const spec = testSpecWithCurrentVersionSchema.parse(
      (
        await request(http)
          .post(`/recordings/${recordingId}/compile`)
          .expect(201)
      ).body,
    );

    expect(spec.currentVersion?.steps[0]?.data).toEqual({
      kind: 'ENV_REF',
      envVar: 'DEMO_PASSWORD',
    });
    expect(JSON.stringify(spec)).not.toContain('hunter2');
  });

  it('gives an inferred step empty hints rather than invented ones', async () => {
    const recordingId = await seedRecording();

    compiled = {
      name: 'Sign in',
      description: null,
      steps: [
        {
          // A check the human made by looking, with no recorded action behind it.
          sourceEventIndex: null,
          intent: 'confirm the dashboard greets the signed-in user',
          action: 'ASSERT',
          targetDescription: 'the signed-in confirmation message',
          data: { kind: 'NONE' },
          expectation: { kind: 'TEXT', value: 'Signed in as' },
          optional: false,
        },
      ],
    };

    const spec = testSpecWithCurrentVersionSchema.parse(
      (
        await request(http)
          .post(`/recordings/${recordingId}/compile`)
          .expect(201)
      ).body,
    );

    const hints = spec.currentVersion?.steps[0]?.targetHints;
    expect(hints?.selectorCandidates).toEqual([]);
    expect(hints?.role).toBeUndefined();
  });

  it('writes version 1 and leaves it untouched when a second version is saved', async () => {
    const recordingId = await seedRecording();

    compiled = {
      name: 'Sign in',
      description: null,
      steps: [
        {
          sourceEventIndex: 3,
          intent: 'submit the sign-in form',
          action: 'CLICK',
          targetDescription: 'the submit button',
          data: { kind: 'NONE' },
          expectation: { kind: 'URL', match: 'prefix', value: '/dashboard' },
          optional: false,
        },
      ],
    };

    const spec = testSpecWithCurrentVersionSchema.parse(
      (
        await request(http)
          .post(`/recordings/${recordingId}/compile`)
          .expect(201)
      ).body,
    );

    const first = spec.currentVersion;
    expect(first?.version).toBe(1);
    expect(first?.source).toBe('RECORDED');
    expect(first?.recordingId).toBe(recordingId);

    const second = testVersionWithStepsSchema.parse(
      (
        await request(http)
          .post(`/specs/${spec.id}/versions`)
          .send({
            note: 'reworded the intent',
            steps: [
              {
                intent: 'sign in as the seeded user',
                action: 'CLICK',
                targetDescription: 'the submit button',
                targetHints: { selectorCandidates: [] },
                data: null,
                expectation: {
                  kind: 'URL',
                  match: 'prefix',
                  value: '/dashboard',
                },
                optional: false,
              },
            ],
          })
          .expect(201)
      ).body,
    );

    expect(second.version).toBe(2);

    // Version 1 must be byte-identical afterwards — that is what makes an
    // automated change reversible.
    const reread = testVersionWithStepsSchema.parse(
      (await request(http).get(`/specs/versions/${first?.id}`).expect(200))
        .body,
    );
    expect(reread).toEqual(first);

    // ...and the spec now points at the new one.
    const after = testSpecWithCurrentVersionSchema.parse(
      (await request(http).get(`/specs/${spec.id}`).expect(200)).body,
    );
    expect(after.currentVersion?.id).toBe(second.id);
  });

  it('refuses to compile a recording that captured nothing', async () => {
    const empty = await prisma.recording.create({
      data: {
        applicationId,
        startUrl: 'http://localhost:4321',
        status: 'STOPPED',
        stoppedAt: new Date(),
      },
    });

    await request(http).post(`/recordings/${empty.id}/compile`).expect(400);
  });
});
