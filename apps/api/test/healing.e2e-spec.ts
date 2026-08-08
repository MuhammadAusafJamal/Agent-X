import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  healingRecordWithContextSchema,
  paginated,
  testVersionWithStepsSchema,
  type DraftTestStep,
  type TargetHints,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { SpecsService } from './../src/specs/specs.service';

/**
 * The review queue, over a real database.
 *
 * The property that matters is immutability: approving a repair writes a **new**
 * version and leaves the one that drifted exactly as it was. That is what makes
 * an automated change to a test auditable, and what lets you go back to the
 * version a human recorded by simply running it.
 */
describe('Healing review (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let specs: SpecsService;
  let applicationId: string;
  let environmentId: string;

  const original: TargetHints = {
    role: 'button',
    name: 'Sign in',
    testId: 'login-submit',
    landmark: 'form "Sign in"',
    selectorCandidates: [],
  };

  const proposed: TargetHints = {
    role: 'button',
    name: 'Continue',
    landmark: 'form "Account access"',
    selectorCandidates: [],
  };

  const step = (overrides: Partial<DraftTestStep> = {}): DraftTestStep => ({
    intent: 'submit the sign-in form',
    action: 'CLICK',
    targetDescription: 'the primary submit button in the sign-in form',
    targetHints: original,
    data: null,
    expectation: { kind: 'URL', match: 'prefix', value: '/dashboard' },
    optional: false,
    ...overrides,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Nothing here should reach the model: the queue is bookkeeping.
      .overrideProvider(LlmService)
      .useValue({
        structured: () =>
          Promise.reject(new Error('the queue must not call the model')),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    specs = app.get(SpecsService);

    const project = await prisma.project.create({ data: { name: 'Healing' } });

    const application = await prisma.application.create({
      data: {
        projectId: project.id,
        name: 'Demo Shop',
        baseUrl: 'http://localhost:4321',
      },
    });
    applicationId = application.id;

    const environment = await prisma.environment.create({
      data: {
        applicationId,
        name: 'local',
        baseUrl: 'http://localhost:4321',
      },
    });
    environmentId = environment.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /**
   * A run that healed: a specification, an execution against it, and a proposed
   * repair attached to the step that drifted.
   */
  async function arrange(steps: DraftTestStep[], healed: number[]) {
    const spec = await prisma.testSpec.create({
      data: { applicationId, name: 'Sign in', source: 'RECORDED' },
    });

    const version = await specs.createVersion(
      spec.id,
      { steps },
      { source: 'RECORDED' },
    );

    const execution = await prisma.execution.create({
      data: {
        specId: spec.id,
        versionId: version.id,
        environmentId,
        mode: 'REPLAY',
        status: 'PASSED',
      },
    });

    const healingIds: string[] = [];

    for (const index of healed) {
      const specStep = version.steps[index];

      const executionStep = await prisma.executionStep.create({
        data: {
          executionId: execution.id,
          stepId: specStep.id,
          index,
          intent: specStep.intent,
          action: specStep.action,
          status: 'HEALED',
        },
      });

      const healing = await prisma.healingRecord.create({
        data: {
          executionStepId: executionStep.id,
          specVersionId: version.id,
          diagnosis: 'TEST_DRIFT',
          originalTarget: JSON.stringify(original),
          proposedTarget: JSON.stringify(proposed),
          proposedDescription: 'the primary submit button in the account form',
          rationale: 'The form was relabelled and the button renamed.',
          status: 'APPLIED',
          reverifyStatus: 'PASS',
        },
      });

      healingIds.push(healing.id);
    }

    return { spec, version, execution, healingIds };
  }

  const versionOf = async (id: string) =>
    testVersionWithStepsSchema.parse(
      (await request(http).get(`/specs/versions/${id}`).expect(200)).body,
    );

  it('lists what is waiting, with the context to decide on it', async () => {
    const { execution } = await arrange([step()], [0]);

    const queue = paginated(healingRecordWithContextSchema).parse(
      (
        await request(http)
          .get(`/healings?executionId=${execution.id}`)
          .expect(200)
      ).body,
    );

    expect(queue.items).toHaveLength(1);

    const entry = queue.items[0];
    expect(entry.specName).toBe('Sign in');
    expect(entry.specVersion).toBe(1);
    expect(entry.stepIntent).toBe('submit the sign-in form');
    expect(entry.originalTarget.name).toBe('Sign in');
    expect(entry.proposedTarget.name).toBe('Continue');
    expect(entry.executionId).toBe(execution.id);
  }, 30_000);

  it('approving writes version N+1 and leaves version N untouched', async () => {
    const { spec, version, healingIds } = await arrange([step()], [0]);
    const before = await versionOf(version.id);

    const result = (
      await request(http)
        .post(`/healings/${healingIds[0]}/review`)
        .send({ decision: 'APPROVE' })
        .expect(201)
    ).body as { appliedToVersionId: string; reviewed: number };

    const created = await versionOf(result.appliedToVersionId);

    expect(created.version).toBe(2);
    expect(created.source).toBe('HEALED');
    expect(created.note).toContain('healed');

    // The repair landed.
    expect(created.steps[0]?.targetHints.name).toBe('Continue');
    expect(created.steps[0]?.targetHints.landmark).toBe(
      'form "Account access"',
    );
    expect(created.steps[0]?.targetDescription).toBe(
      'the primary submit button in the account form',
    );

    // And the version that drifted is byte-identical to what it was.
    expect(await versionOf(version.id)).toEqual(before);

    // The spec now points at the repaired version.
    const updated = await prisma.testSpec.findUniqueOrThrow({
      where: { id: spec.id },
    });
    expect(updated.currentVersionId).toBe(created.id);
  }, 30_000);

  it('carries untouched steps across unchanged', async () => {
    const { version, healingIds } = await arrange(
      [step({ intent: 'open the sign-in page', action: 'NAVIGATE' }), step()],
      [1],
    );

    const result = (
      await request(http)
        .post(`/healings/${healingIds[0]}/review`)
        .send({ decision: 'APPROVE' })
        .expect(201)
    ).body as { appliedToVersionId: string };

    const before = await versionOf(version.id);
    const created = await versionOf(result.appliedToVersionId);

    expect(created.steps).toHaveLength(2);
    // Only the healed step changed; the other is carried over as it was.
    expect(created.steps[0]?.targetHints).toEqual(before.steps[0]?.targetHints);
    expect(created.steps[1]?.targetHints.name).toBe('Continue');
  }, 30_000);

  it('rejecting leaves the specification alone, so the next run fails the same way', async () => {
    const { spec, version, healingIds } = await arrange([step()], [0]);
    const before = await versionOf(version.id);

    await request(http)
      .post(`/healings/${healingIds[0]}/review`)
      .send({ decision: 'REJECT' })
      .expect(201);

    expect(await versionOf(version.id)).toEqual(before);

    const versions = await prisma.testVersion.count({
      where: { specId: spec.id },
    });
    expect(versions).toBe(1);

    const healing = await prisma.healingRecord.findUniqueOrThrow({
      where: { id: healingIds[0] },
    });
    expect(healing.status).toBe('REJECTED');
    expect(healing.reviewedAt).not.toBeNull();
  }, 30_000);

  it('approves several repairs from one run into a single new version', async () => {
    const { spec, healingIds } = await arrange(
      [step({ intent: 'fill the email field' }), step()],
      [0, 1],
    );

    const result = (
      await request(http)
        .post('/healings/review')
        .send({ healingIds, decision: 'APPROVE' })
        .expect(201)
    ).body as { appliedToVersionId: string; reviewed: number };

    expect(result.reviewed).toBe(2);

    // One version, not one per repair — otherwise the spec's history records a
    // migration that never happened that way.
    const versions = await prisma.testVersion.count({
      where: { specId: spec.id },
    });
    expect(versions).toBe(2);

    const created = await versionOf(result.appliedToVersionId);
    expect(created.steps.every((s) => s.targetHints.name === 'Continue')).toBe(
      true,
    );
  }, 30_000);

  it('links an approved repair back to the version it produced', async () => {
    const { healingIds } = await arrange([step()], [0]);

    const result = (
      await request(http)
        .post(`/healings/${healingIds[0]}/review`)
        .send({ decision: 'APPROVE' })
        .expect(201)
    ).body as { appliedToVersionId: string };

    const healing = await prisma.healingRecord.findUniqueOrThrow({
      where: { id: healingIds[0] },
    });

    expect(healing.status).toBe('APPROVED');
    expect(healing.appliedToVersionId).toBe(result.appliedToVersionId);
  }, 30_000);

  it('refuses to review the same repair twice', async () => {
    const { healingIds } = await arrange([step()], [0]);

    await request(http)
      .post(`/healings/${healingIds[0]}/review`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    await request(http)
      .post(`/healings/${healingIds[0]}/review`)
      .send({ decision: 'APPROVE' })
      .expect(400);
  }, 30_000);

  it('keeps reviewed repairs out of the queue', async () => {
    const { execution, healingIds } = await arrange([step()], [0]);

    await request(http)
      .post(`/healings/${healingIds[0]}/review`)
      .send({ decision: 'REJECT' })
      .expect(201);

    const queue = paginated(healingRecordWithContextSchema).parse(
      (
        await request(http)
          .get(`/healings?executionId=${execution.id}`)
          .expect(200)
      ).body,
    );

    expect(queue.items).toHaveLength(0);
  }, 30_000);
});
