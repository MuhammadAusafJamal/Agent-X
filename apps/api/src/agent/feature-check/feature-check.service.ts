import { Injectable, Logger } from '@nestjs/common';
import { EMPTY, Subject, type Observable } from 'rxjs';
import type { BrowserContext } from 'playwright';
import {
  acceptanceCriterionSchema,
  authoredExpectationsSchema,
  credentialRefsSchema,
  featureCasePlanSchema,
  featureCaseResultSchema,
  criterionVerdictSchema,
  parseJson,
  stringifyJson,
  type AcceptanceCriterion,
  type AuthoredExpectations,
  type CriterionStatus,
  type CriterionVerdict,
  type DraftTestStep,
  type FeatureCaseResult,
  type FeatureCheck,
  type FeatureCheckSseEvent,
  type FeatureCheckStatus,
  type NetworkEntry,
  type PlannedCase,
  type StartFeatureCheckInput,
} from '@agentx/shared';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { TypedConfigService } from '../../config/typed-config.service';
import { LlmService } from '../../llm/llm.service';
import { SpecsService } from '../../specs/specs.service';
import { ExecutionsService } from '../../executions/executions.service';
import { CredentialsService } from '../../credentials/credentials.service';
import type { Redactor } from '../../credentials/redactor';
import { ObservationCollector } from '../../runner/observation-collector';
import { describeSetupFailure } from '../../runner/launch-failure';
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../common/errors';
import { ExplorerService } from '../explorer/explorer.service';
import { BudgetTracker, isAllowedUrl } from '../explorer/bounds';
import {
  AUTHOR_EXPECTATIONS_PROMPT,
  PLAN_FEATURE_CASES_PROMPT,
} from '../../llm/prompts/feature-check.prompt';
import { assessCoverage, normalizePlan } from './coverage';

const criteriaColumnSchema = z.array(acceptanceCriterionSchema);
const verdictsColumnSchema = z.array(criterionVerdictSchema);
const casesColumnSchema = z.array(featureCaseResultSchema);

/** How long to wait for a queued run to reach a terminal status. */
const RUN_POLL_INTERVAL_MS = 750;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The statuses a check can only be in while a process is actively driving it.
 *
 * Kept as a list rather than "not COMPLETED and not FAILED" so that adding a
 * status forces a decision here about what a restart should do to it.
 */
const UNFINISHED_STATUSES = [
  'PENDING',
  'PLANNING',
  'REALIZING',
  'RUNNING',
] as const satisfies readonly FeatureCheckStatus[];

const TERMINAL_RUN_STATUSES = new Set([
  'PASSED',
  'FAILED',
  'UNCERTAIN',
  'CANCELLED',
  'ERROR',
]);

/**
 * Testing a feature against criteria a human supplied.
 *
 * The difference from everything else in this codebase is where "correct" comes
 * from. A recorded spec's expectations describe what the page did when it was
 * recorded, so the application defines its own correctness and a bug captured on
 * the day of recording is green forever. Here the criteria are an input, and the
 * whole pipeline exists to turn each one into a check that can fail.
 *
 * This service deliberately verifies nothing itself. It plans cases, walks the
 * application to realize them, writes them down as ordinary specs, and then
 * starts ordinary runs — which is what gives a feature check the same runner,
 * verifier, evidence tree, diagnoser, healer, and reports as everything else,
 * without a second implementation of any of them.
 */
@Injectable()
export class FeatureCheckService {
  private readonly logger = new Logger(FeatureCheckService.name);
  private readonly streams = new Map<string, Subject<FeatureCheckSseEvent>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly explorer: ExplorerService,
    private readonly specs: SpecsService,
    private readonly executions: ExecutionsService,
    private readonly credentials: CredentialsService,
    private readonly config: TypedConfigService,
  ) {}

  /**
   * Closes out checks the last process was in the middle of.
   *
   * A check's progress is a row in the database; the work driving it is a
   * promise chain in memory. Stop the API between those two and the row is
   * stranded in whatever status it had reached — nothing marks it failed, its
   * stream died with the process so the SSE endpoint returns `EMPTY`, and the
   * dashboard polls a check that will never move again. In development, where
   * `nest --watch` restarts on every save, this happens constantly.
   *
   * Deliberately not resumed. A check is a browser walking an application; that
   * session is gone, and re-running from a recorded status would repeat moves
   * that already took effect. Ending it honestly is the only correct answer,
   * and `FAILED` with a reason is what makes it visible rather than silent.
   *
   * Assumes one API process per database — see
   * `AGENTX_SWEEP_INTERRUPTED_ON_BOOT`, which exists to switch this off where
   * that does not hold.
   */
  async onModuleInit(): Promise<void> {
    if (!this.config.get('AGENTX_SWEEP_INTERRUPTED_ON_BOOT')) return;

    try {
      const stranded = await this.prisma.featureCheck.updateMany({
        where: { status: { in: [...UNFINISHED_STATUSES] } },
        data: {
          status: 'FAILED',
          error: 'The API restarted while this check was still running.',
          finishedAt: new Date(),
        },
      });

      if (stranded.count > 0) {
        this.logger.warn(
          `Marked ${stranded.count} feature check(s) failed: the API restarted while they were running.`,
        );
      }
    } catch (error) {
      // A sweep that cannot run is not a reason to refuse to boot.
      this.logger.error(
        `Could not close out interrupted feature checks: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Validates, records the check, and queues the work.
   *
   * Returns as soon as there is a row to watch. A check plans, walks the
   * application once per case, and then runs each case — minutes of work that
   * must survive a dashboard reload, which is why this is a persisted row and a
   * stream rather than a synchronous response like `POST /explorations`.
   */
  async start(input: StartFeatureCheckInput): Promise<FeatureCheck> {
    const environment = await this.prisma.environment.findUnique({
      where: { id: input.environmentId },
    });

    if (environment === null) {
      throw new NotFoundError('Environment', input.environmentId);
    }

    const application = await this.prisma.application.findUnique({
      where: { id: input.applicationId },
      select: { id: true },
    });

    if (application === null) {
      throw new NotFoundError('Application', input.applicationId);
    }

    if (environment.applicationId !== input.applicationId) {
      throw new BadRequestError(
        'That environment belongs to a different application, so the generated suite would be filed against the wrong one.',
      );
    }

    const duplicateKeys = duplicates(input.criteria.map((one) => one.key));

    if (duplicateKeys.length > 0) {
      // Two criteria under one key make a verdict ambiguous, and the ambiguity
      // would only surface in the report, long after it could be fixed.
      throw new BadRequestError(
        `Acceptance criteria must have distinct keys. Repeated: ${duplicateKeys.join(', ')}.`,
      );
    }

    const startUrl = input.startUrl ?? environment.baseUrl;

    if (!isAllowedUrl(startUrl, environment.baseUrl)) {
      throw new NotFoundError('Start URL within this environment', startUrl);
    }

    const feature = await this.upsertFeature(
      input.applicationId,
      input.name,
      input.description,
    );

    const row = await this.prisma.featureCheck.create({
      data: {
        featureId: feature.id,
        applicationId: input.applicationId,
        environmentId: input.environmentId,
        name: input.name,
        description: input.description,
        status: 'PENDING',
        criteria: stringifyJson(
          criteriaColumnSchema,
          input.criteria,
          'FeatureCheck.criteria',
        ),
      },
    });

    const stream = new Subject<FeatureCheckSseEvent>();
    this.streams.set(row.id, stream);

    this.queue = this.queue.then(async () => {
      try {
        await this.run(row.id, input, startUrl, environment.baseUrl, stream);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(`Feature check ${row.id} failed: ${message}`);

        await this.prisma.featureCheck
          .update({
            where: { id: row.id },
            data: { status: 'FAILED', error: message, finishedAt: new Date() },
          })
          .catch(() => undefined);

        stream.next({
          type: 'featureCheck.error',
          featureCheckId: row.id,
          message,
        });
      } finally {
        stream.complete();
        this.streams.delete(row.id);
      }
    });

    return this.get(row.id);
  }

  streamOrEmpty(id: string): Observable<FeatureCheckSseEvent> {
    return this.streams.get(id) ?? EMPTY;
  }

  async get(id: string): Promise<FeatureCheck> {
    const row = await this.prisma.featureCheck.findUnique({ where: { id } });

    if (row === null) throw new NotFoundError('Feature check', id);

    return {
      id: row.id,
      featureId: row.featureId,
      applicationId: row.applicationId,
      environmentId: row.environmentId,
      name: row.name,
      description: row.description,
      status: row.status as FeatureCheckStatus,
      criteria: parseJson(
        criteriaColumnSchema,
        row.criteria,
        `FeatureCheck.criteria#${row.id}`,
      ),
      verdicts: parseJson(
        verdictsColumnSchema,
        row.verdicts,
        `FeatureCheck.verdicts#${row.id}`,
      ),
      cases: parseJson(
        casesColumnSchema,
        row.cases,
        `FeatureCheck.cases#${row.id}`,
      ),
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  async list(applicationId?: string): Promise<FeatureCheck[]> {
    const rows = await this.prisma.featureCheck.findMany({
      where: applicationId === undefined ? {} : { applicationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });

    return Promise.all(rows.map((row) => this.get(row.id)));
  }

  // ---------------------------------------------------------------------------

  /** Plan, realize, run, aggregate. One browser for the whole check. */
  private async run(
    checkId: string,
    input: StartFeatureCheckInput,
    startUrl: string,
    baseUrl: string,
    stream: Subject<FeatureCheckSseEvent>,
  ): Promise<void> {
    const emit = (status: FeatureCheckStatus, message: string): void => {
      stream.next({
        type: 'featureCheck.progress',
        featureCheckId: checkId,
        status,
        message,
      });
    };

    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { id: input.environmentId },
    });

    const redactor = this.credentials.redactorFor(
      parseJson(
        credentialRefsSchema,
        environment.credentialRefs,
        `Environment.credentialRefs#${environment.id}`,
      ),
    );

    const budget = new BudgetTracker({
      // Each case gets its own step allowance; the shared ceiling is what stops
      // a check from running all afternoon if every case wanders.
      maxSteps: input.maxCases * input.maxStepsPerCase,
      // Per case: one call per step, plus planning, plus one authoring call,
      // plus slack for a schema retry.
      maxLlmCalls: input.maxCases * (input.maxStepsPerCase + 2) + 4,
      maxDurationMs: input.maxDurationSeconds * 1000,
      minActionIntervalMs: this.config.get('AGENTX_MIN_ACTION_INTERVAL_MS'),
    });

    await this.setStatus(checkId, 'PLANNING');
    emit('PLANNING', 'Reading the starting page.');

    let browser;
    let context: BrowserContext;

    try {
      ({ browser, context } = await this.explorer.openBrowser());
    } catch (error) {
      throw new ServiceUnavailableError(describeSetupFailure(error));
    }

    // The same collector the runner uses, so response bodies are captured the
    // same way here — the expectation author needs to see real endpoints and
    // real payloads to write an API_RESPONSE check against one.
    const collector = new ObservationCollector(redactor, {
      maxPerStep: this.config.get('AGENTX_MAX_STEP_NETWORK'),
      maxPerRun: this.config.get('AGENTX_MAX_RUN_NETWORK'),
    });
    collector.attach(context);

    const cases: FeatureCaseResult[] = [];

    try {
      const plan = await this.plan(
        context,
        input,
        startUrl,
        redactor,
        budget,
        emit,
      );

      const coverage = assessCoverage(input.criteria, plan);

      if (coverage.unknown.length > 0) {
        this.logger.warn(
          `Feature check ${checkId}: plan claimed unknown criteria ${coverage.unknown.join(', ')}`,
        );
      }

      await this.setStatus(checkId, 'REALIZING');

      for (const [index, planned] of plan.entries()) {
        emit(
          'REALIZING',
          `Case ${index + 1} of ${plan.length}: ${planned.name}`,
        );

        const realized = await this.realize(
          context,
          collector,
          planned,
          input,
          startUrl,
          baseUrl,
          redactor,
          budget,
        );

        cases.push(realized);
        await this.saveCases(checkId, cases);

        stream.next({
          type: 'featureCheck.case',
          featureCheckId: checkId,
          case: realized,
        });
      }
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }

    await this.setStatus(checkId, 'RUNNING');

    for (const one of cases) {
      if (one.specId === null) continue;

      emit('RUNNING', `Running “${one.name}”.`);

      const execution = await this.executions.start({
        specId: one.specId,
        environmentId: input.environmentId,
        mode: 'REPLAY',
      });

      one.executionId = execution.id;
      one.status = await this.awaitRun(execution.id);

      await this.saveCases(checkId, cases);

      stream.next({
        type: 'featureCheck.case',
        featureCheckId: checkId,
        case: one,
      });
    }

    const verdicts = await this.aggregate(input.criteria, cases);

    await this.prisma.featureCheck.update({
      where: { id: checkId },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        verdicts: stringifyJson(
          verdictsColumnSchema,
          verdicts,
          'FeatureCheck.verdicts',
        ),
      },
    });

    stream.next({
      type: 'featureCheck.finished',
      featureCheckId: checkId,
      verdicts,
    });
  }

  /** One model call: criteria plus the entry page become a list of cases. */
  private async plan(
    context: BrowserContext,
    input: StartFeatureCheckInput,
    startUrl: string,
    redactor: Redactor,
    budget: BudgetTracker,
    emit: (status: FeatureCheckStatus, message: string) => void,
  ): Promise<PlannedCase[]> {
    const page = await context.newPage();

    try {
      await page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });

      const snapshot = await this.explorer.snapshot(page, redactor);

      budget.spendLlmCall();

      const planned = await this.llm.structured({
        promptId: PLAN_FEATURE_CASES_PROMPT.id,
        promptVersion: PLAN_FEATURE_CASES_PROMPT.version,
        toolName: PLAN_FEATURE_CASES_PROMPT.toolName,
        toolDescription: PLAN_FEATURE_CASES_PROMPT.toolDescription,
        system: PLAN_FEATURE_CASES_PROMPT.system,
        user: PLAN_FEATURE_CASES_PROMPT.user({
          name: input.name,
          description: input.description,
          criteria: describeCriteria(input.criteria),
          url: startUrl,
          snapshot,
          maxCases: input.maxCases,
        }),
        schema: featureCasePlanSchema,
        redactor,
        maxTokens: 3000,
      });

      const normalized = normalizePlan(
        input.criteria,
        planned.cases,
        input.maxCases,
      );

      emit('PLANNING', `Planned ${normalized.length} case(s).`);

      return normalized;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Walks one case, writes its expectations from the criteria, and saves it.
   *
   * The walk and the authoring are deliberately separate calls. Asking for both
   * at once would let the model describe what it meant to do rather than what it
   * did — the same reason the explorer builds its steps from moves that actually
   * worked rather than from the model's account of them.
   */
  private async realize(
    context: BrowserContext,
    collector: ObservationCollector,
    planned: PlannedCase,
    input: StartFeatureCheckInput,
    startUrl: string,
    baseUrl: string,
    redactor: Redactor,
    budget: BudgetTracker,
  ): Promise<FeatureCaseResult> {
    const base: FeatureCaseResult = {
      name: planned.name,
      goal: planned.goal,
      kind: planned.kind,
      priority: planned.priority,
      coversCriteria: planned.coversCriteria,
      specId: null,
      executionId: null,
      status: null,
      skippedBecause: null,
      criterionSteps: {},
    };

    const page = await context.newPage();
    collector.beginStep();

    try {
      const caseBudget = new BudgetTracker({
        maxSteps: input.maxStepsPerCase,
        maxLlmCalls: input.maxStepsPerCase + 2,
        maxDurationMs: input.maxDurationSeconds * 1000,
        minActionIntervalMs: this.config.get('AGENTX_MIN_ACTION_INTERVAL_MS'),
      });

      const walked = await this.explorer.walk(page, context, {
        goal: planned.goal,
        startUrl,
        baseUrl,
        budget: caseBudget,
        redactor,
      });

      // The shared ceiling still applies: per-case budgets stop one case running
      // away, and this stops the check as a whole doing so.
      for (let spent = 0; spent < caseBudget.stepsTaken; spent += 1) {
        budget.spendStep();
      }

      if (walked.steps.length < 2) {
        return {
          ...base,
          skippedBecause: `The walk did not get past the starting page (${walked.stoppedBecause}${
            walked.stoppedDetail === null ? '' : `: ${walked.stoppedDetail}`
          }).`,
        };
      }

      const observed = await collector.drain();
      const snapshot = await this.explorer.snapshot(page, redactor);

      const covered = input.criteria.filter((criterion) =>
        planned.coversCriteria.includes(criterion.key),
      );

      const authored = await this.authorExpectations(
        planned,
        covered,
        walked.steps,
        page.url(),
        snapshot,
        observed.network,
        redactor,
        budget,
      );

      const { steps, criterionSteps } = applyExpectations(
        walked.steps,
        covered,
        authored,
      );

      const spec = await this.saveSpec(input, planned, steps);

      return { ...base, specId: spec.id, criterionSteps };
    } catch (error) {
      // One case failing to realize must not end the check: the others may still
      // settle their criteria, and a partial answer beats none.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Case “${planned.name}” could not be realized: ${message}`,
      );

      return { ...base, skippedBecause: message };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async authorExpectations(
    planned: PlannedCase,
    covered: AcceptanceCriterion[],
    steps: DraftTestStep[],
    url: string,
    snapshot: string,
    network: NetworkEntry[],
    redactor: Redactor,
    budget: BudgetTracker,
  ): Promise<AuthoredExpectations> {
    if (covered.length === 0) {
      // Nothing to assert against. Writing expectations anyway would produce
      // checks nobody asked for, dressed as acceptance criteria.
      return { steps: [], assertions: [] };
    }

    budget.spendLlmCall();

    return this.llm.structured({
      promptId: AUTHOR_EXPECTATIONS_PROMPT.id,
      promptVersion: AUTHOR_EXPECTATIONS_PROMPT.version,
      toolName: AUTHOR_EXPECTATIONS_PROMPT.toolName,
      toolDescription: AUTHOR_EXPECTATIONS_PROMPT.toolDescription,
      system: AUTHOR_EXPECTATIONS_PROMPT.system,
      user: AUTHOR_EXPECTATIONS_PROMPT.user({
        caseName: planned.name,
        goal: planned.goal,
        criteria: describeCriteria(covered),
        steps: steps
          .map((step, index) => `${index}. ${step.intent}`)
          .join('\n'),
        url,
        snapshot,
        network: describeNetwork(network),
      }),
      schema: authoredExpectationsSchema,
      redactor,
      maxTokens: 3000,
    });
  }

  private async saveSpec(
    input: StartFeatureCheckInput,
    planned: PlannedCase,
    steps: DraftTestStep[],
  ): Promise<{ id: string }> {
    const feature = await this.upsertFeature(
      input.applicationId,
      input.name,
      input.description,
    );

    const spec = await this.prisma.testSpec.create({
      data: {
        applicationId: input.applicationId,
        featureId: feature.id,
        name: planned.name,
        description: `${planned.kind} case for “${input.name}”. Goal: ${planned.goal}`,
        source: 'GENERATED',
        priority: planned.priority,
        criteriaKeys: stringifyJson(
          z.array(z.string()),
          planned.coversCriteria,
          'TestSpec.criteriaKeys',
        ),
      },
    });

    await this.specs.createVersion(
      spec.id,
      { note: `generated from acceptance criteria for “${input.name}”`, steps },
      { source: 'GENERATED' },
    );

    return { id: spec.id };
  }

  /**
   * Waits for a queued run to reach a terminal status.
   *
   * Polled rather than subscribed because runs are serialized behind the
   * executions queue: by the time this is called the run may not have started,
   * and a stream subscribed too early or too late would miss it either way.
   */
  private async awaitRun(executionId: string): Promise<string> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;

    for (;;) {
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        select: { status: true },
      });

      if (execution === null) return 'ERROR';
      if (TERMINAL_RUN_STATUSES.has(execution.status)) return execution.status;

      if (Date.now() > deadline) {
        this.logger.warn(`Run ${executionId} did not finish in time`);
        return 'ERROR';
      }

      await sleep(RUN_POLL_INTERVAL_MS);
    }
  }

  /**
   * One verdict per criterion, from the steps that were written to settle it.
   *
   * A criterion nobody planned a case for is `UNCOVERED`, not a pass and not a
   * failure. Folding it into either would report a number that is not true, and
   * "we tested five of five" when one was never tried is exactly the kind of
   * false confidence this whole feature exists to remove.
   */
  private async aggregate(
    criteria: AcceptanceCriterion[],
    cases: FeatureCaseResult[],
  ): Promise<CriterionVerdict[]> {
    const verdicts: CriterionVerdict[] = [];

    for (const criterion of criteria) {
      const owning = cases.filter((one) =>
        one.coversCriteria.includes(criterion.key),
      );

      if (owning.length === 0) {
        verdicts.push({
          key: criterion.key,
          text: criterion.text,
          status: 'UNCOVERED',
          specIds: [],
          executionIds: [],
          rationale: 'No test case was planned for this criterion.',
        });
        continue;
      }

      const statuses: string[] = [];
      const rationales: string[] = [];

      for (const one of owning) {
        const index = one.criterionSteps[criterion.key];

        if (one.executionId === null || index === undefined) {
          statuses.push('NOT_RUN');
          if (one.skippedBecause !== null) rationales.push(one.skippedBecause);
          continue;
        }

        const step = await this.prisma.executionStep.findFirst({
          where: { executionId: one.executionId, index },
          select: { status: true, verifierRationale: true },
        });

        statuses.push(step?.status ?? 'NOT_RUN');
        if (step?.verifierRationale != null) {
          rationales.push(step.verifierRationale);
        }
      }

      verdicts.push({
        key: criterion.key,
        text: criterion.text,
        status: rollUpCriterion(statuses),
        specIds: owning
          .map((one) => one.specId)
          .filter((id): id is string => id !== null),
        executionIds: owning
          .map((one) => one.executionId)
          .filter((id): id is string => id !== null),
        rationale: rationales.length === 0 ? null : rationales.join(' | '),
      });
    }

    return verdicts;
  }

  private async upsertFeature(
    applicationId: string,
    name: string,
    description: string,
  ): Promise<{ id: string }> {
    return this.prisma.feature.upsert({
      where: { applicationId_name: { applicationId, name } },
      create: {
        applicationId,
        name,
        description: description === '' ? null : description,
      },
      update: {},
      select: { id: true },
    });
  }

  private async setStatus(
    id: string,
    status: FeatureCheckStatus,
  ): Promise<void> {
    await this.prisma.featureCheck.update({ where: { id }, data: { status } });
  }

  private async saveCases(
    id: string,
    cases: FeatureCaseResult[],
  ): Promise<void> {
    await this.prisma.featureCheck.update({
      where: { id },
      data: {
        cases: stringifyJson(casesColumnSchema, cases, 'FeatureCheck.cases'),
      },
    });
  }
}

/**
 * Folds the authored expectations into the walked steps.
 *
 * The assertions become real `ASSERT` steps at the end, and the map from
 * criterion key to step index comes back with them — recorded rather than
 * inferred, so a verdict cannot end up attached to the wrong criterion.
 */
export function applyExpectations(
  walked: DraftTestStep[],
  covered: AcceptanceCriterion[],
  authored: AuthoredExpectations,
): { steps: DraftTestStep[]; criterionSteps: Record<string, number> } {
  const steps = walked.map((step) => ({ ...step }));

  for (const override of authored.steps) {
    const step = steps[override.stepIndex];
    if (step !== undefined) step.expectation = override.expectation;
  }

  const criterionSteps: Record<string, number> = {};
  const known = new Set(covered.map((criterion) => criterion.key));
  const seen = new Set<string>();

  for (const assertion of authored.assertions) {
    // A key the model invented settles nothing, and letting it through would
    // put a verdict against a criterion the user never wrote.
    if (!known.has(assertion.criterionKey)) continue;
    if (seen.has(assertion.criterionKey)) continue;

    seen.add(assertion.criterionKey);
    criterionSteps[assertion.criterionKey] = steps.length;

    steps.push({
      intent: assertion.intent,
      action: 'ASSERT',
      targetDescription: null,
      targetHints: { selectorCandidates: [] },
      data: null,
      expectation: assertion.expectation,
      optional: false,
    });
  }

  return { steps, criterionSteps };
}

/**
 * A known failure outranks an open question, which outranks a pass — the same
 * ordering `rollUp` uses for a run, for the same reason.
 */
export function rollUpCriterion(statuses: string[]): CriterionStatus {
  if (statuses.length === 0) return 'NOT_RUN';
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNCERTAIN')) return 'UNCERTAIN';
  if (statuses.some((status) => status === 'PASS' || status === 'HEALED')) {
    return 'PASS';
  }
  return 'NOT_RUN';
}

function describeCriteria(criteria: AcceptanceCriterion[]): string {
  return criteria
    .map((criterion) => `- ${criterion.key}: ${criterion.text}`)
    .join('\n');
}

/**
 * The requests, as the expectation author needs to see them: enough of a body to
 * name a field, never so much that the prompt is mostly payload.
 */
function describeNetwork(entries: NetworkEntry[]): string {
  const interesting = entries.filter(
    (entry) => entry.responseBody !== undefined || entry.resourceType === 'xhr',
  );

  if (interesting.length === 0) return '(no JSON responses were captured)';

  return interesting
    .slice(-12)
    .map((entry) => {
      const body =
        entry.responseBody === undefined
          ? '(body not captured)'
          : entry.responseBody.slice(0, 600);

      return `${entry.method} ${entry.url} → ${entry.status ?? '?'}\n  ${body}`;
    })
    .join('\n');
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }

  return [...repeated];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
