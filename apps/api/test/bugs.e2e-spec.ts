import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  bugReportWithContextSchema,
  paginated,
  type DiagnosisResult,
  type NetworkEntry,
} from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LlmService } from './../src/llm/llm.service';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  BugReporterService,
  type BugContext,
} from './../src/bugs/bug-reporter.service';

/**
 * Filing defects, over a real database.
 *
 * Two properties carry the weight: a reproduction is the steps that actually
 * ran, and the same defect seen again updates one report rather than filing a
 * twin. Get the second wrong and the tracker fills with noise until people stop
 * reading it, which costs more than not having filed at all.
 */
describe('Bug reports (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let reporter: BugReporterService;
  let specId: string;
  let executionId: string;
  let executionStepId: string;

  let modelCalls = 0;

  const diagnosis: DiagnosisResult = {
    diagnosis: 'APP_BUG',
    confidence: 0.9,
    rationale: 'POST /login returned 500 during this step.',
  };

  const failing: NetworkEntry = {
    url: 'http://localhost:4321/login',
    method: 'POST',
    status: 500,
  };

  const context = (overrides: Partial<BugContext> = {}): BugContext => ({
    executionId,
    executionStepId,
    specId,
    stepIndex: 2,
    intent: 'submit the sign-in form',
    url: 'http://localhost:4321/login',
    error: null,
    verifierRationale: 'Expected the URL to prefix “/dashboard”.',
    diagnosis,
    network: [failing],
    console: [],
    optional: false,
    executedSteps: [
      'open the sign-in page',
      'fill in the email address',
      'submit the sign-in form',
    ],
    evidenceRefs: [],
    ...overrides,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmService)
      .useValue({
        structured: () => {
          modelCalls += 1;
          return Promise.resolve({
            title: 'Sign-in returns 500 for valid credentials',
            summary:
              'The run submitted valid credentials and the server failed.',
            expected: 'The dashboard loads and shows the signed-in account.',
            actual: 'The server returned 500 and the browser stayed on /login.',
          });
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    reporter = app.get(BugReporterService);

    const project = await prisma.project.create({ data: { name: 'Bugs' } });
    const application = await prisma.application.create({
      data: {
        projectId: project.id,
        name: 'Demo Shop',
        baseUrl: 'http://localhost:4321',
      },
    });
    const environment = await prisma.environment.create({
      data: {
        applicationId: application.id,
        name: 'local',
        baseUrl: 'http://localhost:4321',
      },
    });
    const spec = await prisma.testSpec.create({
      data: {
        applicationId: application.id,
        name: 'Sign in',
        source: 'RECORDED',
      },
    });
    specId = spec.id;

    const version = await prisma.testVersion.create({
      data: { specId, version: 1, source: 'RECORDED' },
    });

    const execution = await prisma.execution.create({
      data: {
        specId,
        versionId: version.id,
        environmentId: environment.id,
        mode: 'REPLAY',
        status: 'FAILED',
      },
    });
    executionId = execution.id;

    const executionStep = await prisma.executionStep.create({
      data: {
        executionId,
        index: 2,
        intent: 'submit the sign-in form',
        action: 'CLICK',
        status: 'FAIL',
      },
    });
    executionStepId = executionStep.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    modelCalls = 0;
    await prisma.bugReport.deleteMany({ where: { executionId } });
  });

  it('files a report a developer could act on unchanged', async () => {
    const id = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    const bug = bugReportWithContextSchema.parse(
      (await request(http).get(`/bugs/${id}`).expect(200)).body,
    );

    expect(bug.title).toContain('500');
    expect(bug.expected).toContain('dashboard');
    expect(bug.actual).toContain('500');
    expect(bug.status).toBe('OPEN');
    expect(bug.applicationName).toBe('Demo Shop');
    expect(bug.specName).toBe('Sign in');
  }, 30_000);

  it('takes reproduction steps from the steps that actually ran', async () => {
    const id = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    const bug = await prisma.bugReport.findUniqueOrThrow({ where: { id } });

    // Not the model's recollection. A reproduction that does not reproduce
    // wastes an afternoon and teaches a developer to distrust the tool.
    expect(JSON.parse(bug.reproSteps)).toEqual([
      '1. open the sign-in page',
      '2. fill in the email address',
      '3. submit the sign-in form',
    ]);
  }, 30_000);

  it('grades severity from the evidence, not from the model', async () => {
    const id = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    const bug = await prisma.bugReport.findUniqueOrThrow({ where: { id } });

    // A 500 that stopped a non-optional step: the application errored and the
    // user could go no further.
    expect(bug.severity).toBe('CRITICAL');
  }, 30_000);

  it('updates the open report instead of filing a duplicate', async () => {
    const first = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    const second = await reporter.file(
      // A later run of the same flow, hitting the same endpoint.
      context({ network: [{ ...failing, url: `${failing.url}?next=/a` }] }),
      {
        redactor: { redact: (text: string) => text } as never,
        allowModel: true,
      },
    );

    expect(second).toBe(first);

    const rows = await prisma.bugReport.findMany({ where: { executionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toBe(2);

    // The write-up a developer is already reading is not rewritten, and the
    // recurrence costs nothing.
    expect(modelCalls).toBe(1);
  }, 30_000);

  it('files a separate report for a different defect', async () => {
    await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    await reporter.file(
      context({
        stepIndex: 4,
        intent: 'create an invoice',
        network: [{ ...failing, url: 'http://localhost:4321/invoices' }],
      }),
      {
        redactor: { redact: (text: string) => text } as never,
        allowModel: true,
      },
    );

    const rows = await prisma.bugReport.findMany({ where: { executionId } });
    expect(rows).toHaveLength(2);
  }, 30_000);

  it('still files a report when the model cannot be reached', async () => {
    const id = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      // A defect going unrecorded because a model was unavailable is the one
      // outcome this phase cannot allow.
      allowModel: false,
    });

    const bug = await prisma.bugReport.findUniqueOrThrow({ where: { id } });

    expect(modelCalls).toBe(0);
    expect(bug.title).toContain('500');
    expect(bug.severity).toBe('CRITICAL');
    expect(JSON.parse(bug.reproSteps)).toHaveLength(3);
  }, 30_000);

  it('acknowledges a report without deleting it', async () => {
    const id = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    const updated = bugReportWithContextSchema.parse(
      (
        await request(http)
          .patch(`/bugs/${id}`)
          .send({ status: 'ACKNOWLEDGED' })
          .expect(200)
      ).body,
    );

    expect(updated.status).toBe('ACKNOWLEDGED');
  }, 30_000);

  it('files again once the open report has been dismissed', async () => {
    const first = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    await request(http)
      .patch(`/bugs/${first}`)
      .send({ status: 'DISMISSED' })
      .expect(200);

    const second = await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    // Dedupe is scoped to what is still open. A defect that comes back after
    // someone closed it is news again.
    expect(second).not.toBe(first);
  }, 30_000);

  it('lists open reports first', async () => {
    await reporter.file(context(), {
      redactor: { redact: (text: string) => text } as never,
      allowModel: true,
    });

    const list = paginated(bugReportWithContextSchema).parse(
      (await request(http).get(`/bugs?executionId=${executionId}`).expect(200))
        .body,
    );

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.status).toBe('OPEN');
  }, 30_000);
});
