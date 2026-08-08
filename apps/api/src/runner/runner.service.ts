import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import {
  actionTypeSchema,
  credentialRefsSchema,
  expectationSchema,
  observationPayloadSchema,
  parseJson,
  stepDataSchema,
  stringifyJson,
  targetHintsSchema,
  type ActionType,
  type ConsoleEntry,
  type DiagnosisResult,
  type Expectation,
  type ExecutionSseEvent,
  type ExecutionStatus,
  type NetworkEntry,
  type StepData,
  type StepStatus,
  type TargetHints,
} from '@agentx/shared';
import type { TestStep as TestStepRow } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TypedConfigService } from '../config/typed-config.service';
import { EvidenceService } from '../evidence/evidence.service';
import { ResolverService } from '../resolver/resolver.service';
import { VerifierService } from '../verifier/verifier.service';
import { rollUp } from '../verifier/deterministic';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ConsolidationService } from '../knowledge/consolidation.service';
import { ReportsService } from '../reports/reports.service';
import { stepKey } from '../resolver/step-key';
import {
  CredentialsService,
  type ResolvedCredentials,
} from '../credentials/credentials.service';
import type { Redactor } from '../credentials/redactor';
import { DiagnoserService } from '../agent/diagnoser/diagnoser.service';
import { HealerService } from '../agent/healer/healer.service';
import { BugReporterService } from '../bugs/bug-reporter.service';
import { toHealingRecord } from '../healings/healings.mapper';
import { toExecutionStep } from './runner.mapper';
import { ObservationCollector } from './observation-collector';
import {
  NEEDS_TARGET,
  performAction,
  resolveData,
  UnresolvedDataError,
} from './actions';

const STEP_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 5 * 60_000;

/**
 * How long to let the page settle before reverifying a step that failed its
 * expectation.
 *
 * This is the only evidence `FLAKE` is ever concluded from. It reverifies; it
 * never re-runs the action. Re-running an action that already took effect is
 * how a test framework charges a card twice, and no amount of flake-tolerance
 * is worth that.
 */
const SETTLE_BEFORE_REVERIFY_MS = 1200;

/**
 * Ceiling on model calls for one run, shared by the resolver and the verifier.
 *
 * A guard against a pathological spec quietly costing a fortune — a run that
 * needs more than this is telling you its hints have rotted, not that it needs
 * a bigger allowance.
 */
const MAX_LLM_CALLS_PER_RUN = 20;

export interface RunHooks {
  emit: (event: ExecutionSseEvent) => void;
  isCancelled: () => boolean;
}

/** Run-level state every step needs, kept out of the per-step argument list. */
interface StepRunContext {
  executionId: string;
  specId: string;
  versionId: string;
  applicationId: string;
  environmentBaseUrl: string;
  dir: string;
  credentials: ResolvedCredentials;
  collector: ObservationCollector;
  hooks: RunHooks;
  /** False once the run has spent its allowance of model calls. */
  withinBudget: boolean;
  /** Intents of the steps that already ran, in order. */
  priorIntents: string[];
}

/**
 * Replays a specification against an environment.
 *
 * Deliberately free of any model call. Every rung of the resolver ladder used
 * here is pure DOM and accessibility work, so when the agent layer lands in
 * Phase 5 a failure has one obvious question attached: did the deterministic
 * path break, or did the model decide wrong?
 *
 * In this phase a step passes when its action completed. Whether the *outcome*
 * was correct is Phase 4's job.
 */
@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TypedConfigService,
    private readonly evidence: EvidenceService,
    private readonly resolver: ResolverService,
    private readonly credentials: CredentialsService,
    private readonly verifier: VerifierService,
    private readonly knowledge: KnowledgeService,
    private readonly diagnoser: DiagnoserService,
    private readonly healer: HealerService,
    private readonly bugs: BugReporterService,
    private readonly consolidation: ConsolidationService,
    private readonly reports: ReportsService,
  ) {}

  async run(executionId: string, hooks: RunHooks): Promise<void> {
    const execution = await this.prisma.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        environment: true,
        version: { include: { steps: { orderBy: { index: 'asc' } } } },
      },
    });

    const steps = execution.version.steps;
    const deadline = Date.now() + RUN_TIMEOUT_MS;

    // Credentials are resolved before the browser opens: a run that gets as far
    // as a login form and then types `undefined` wastes a browser session and
    // reports a confusing failure against the application under test.
    let credentials: ResolvedCredentials;

    try {
      credentials = this.credentials.resolve(
        parseJson(
          credentialRefsSchema,
          execution.environment.credentialRefs,
          `Environment.credentialRefs#${execution.environmentId}`,
        ),
      );
    } catch (error) {
      await this.finish(execution.id, 'ERROR', hooks, {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    hooks.emit({
      type: 'execution.started',
      executionId,
      stepCount: steps.length,
    });

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { status: 'RUNNING' },
    });

    const dir = executionId;
    const absoluteDir = this.evidence.resolve(dir);
    await fs.mkdir(absoluteDir, { recursive: true });

    const browser = await chromium.launch({
      headless: this.config.get('PLAYWRIGHT_HEADLESS'),
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir: absoluteDir },
    });

    const collector = new ObservationCollector(credentials.redactor);
    collector.attach(context);

    await context.tracing.start({ screenshots: true, snapshots: true });

    let page: Page | null = null;
    // Null means "let the roll-up decide"; only cancellation and hard errors
    // short-circuit that.
    let status: ExecutionStatus | null = null;
    let runError: string | null = null;
    let budgetWarned = false;
    const outcomes: { status: StepStatus; optional: boolean }[] = [];
    // What a bug report's reproduction steps are built from: the steps that
    // actually ran, in the order they ran.
    const priorIntents: string[] = [];

    try {
      page = await context.newPage();

      for (const step of steps) {
        if (hooks.isCancelled()) {
          status = 'CANCELLED';
          break;
        }

        if (Date.now() > deadline) {
          status = 'ERROR';
          runError = 'The run exceeded its time budget.';
          break;
        }

        // Counted from the audit rows, so the verifier's calls count against
        // the same budget as the resolver's. Exceeding it degrades the run to
        // deterministic-only rather than ending it — a spec that has already
        // spent its allowance still produces evidence.
        const spent = await this.prisma.llmCall.count({
          where: { executionId: execution.id },
        });

        if (spent >= MAX_LLM_CALLS_PER_RUN && !budgetWarned) {
          budgetWarned = true;
          this.logger.warn(
            `Execution ${executionId} hit its budget of ${MAX_LLM_CALLS_PER_RUN} model calls; remaining steps are deterministic only.`,
          );
        }

        const outcome = await this.runStep(page, step, {
          executionId: execution.id,
          specId: execution.specId,
          versionId: execution.versionId,
          applicationId: execution.environment.applicationId,
          environmentBaseUrl: execution.environment.baseUrl,
          dir,
          credentials,
          collector,
          hooks,
          withinBudget: spent < MAX_LLM_CALLS_PER_RUN,
          priorIntents,
        });

        outcomes.push({ status: outcome, optional: step.optional });
        priorIntents.push(step.intent);

        // A failure stops the run; an UNCERTAIN does not. An unresolved
        // question is for a human to settle afterwards, and the remaining
        // steps may still produce useful evidence.
        if (outcome === 'FAIL' && !step.optional) break;
      }
    } catch (error) {
      status = 'ERROR';
      runError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Execution ${executionId} crashed`, error as Error);
    } finally {
      // Trace and video are finalized whatever happened — a failed run is
      // exactly when its evidence matters most.
      await this.finalizeEvidence(context, page, executionId, dir);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }

    await this.finish(executionId, status ?? rollUp(outcomes), hooks, {
      error: runError,
    });
  }

  /** One step: resolve, act, observe, verify — and, when it fails, react. */
  private async runStep(
    page: Page,
    step: TestStepRow,
    run: StepRunContext,
  ): Promise<StepStatus> {
    const { executionId, applicationId, credentials, collector, hooks } = run;

    const hints = parseJson(
      targetHintsSchema,
      step.targetHints,
      `TestStep.targetHints#${step.id}`,
    );

    const data =
      step.data === null
        ? null
        : parseJson(stepDataSchema, step.data, `TestStep.data#${step.id}`);

    const startedAt = new Date();
    collector.beginStep();

    const row = await this.prisma.executionStep.create({
      data: {
        executionId,
        stepId: step.id,
        index: step.index,
        intent: step.intent,
        action: step.action,
        status: 'RUNNING',
        attempts: 1,
        startedAt,
      },
    });

    let status: StepStatus = 'PASS';
    let error: string | null = null;
    let resolvedSelector: string | null = null;
    let strategy: string | null = null;
    let candidateCount: number | null = null;
    let confidence: number | null = null;
    let learnedHints: TargetHints | null = null;
    // Set when the step never found what it was looking for, which is a
    // different kind of failure from one where the action ran and the outcome
    // was wrong — and the diagnoser needs to tell them apart.
    let unresolvedTarget = false;
    let action: ActionType | null = null;
    let locator: Locator | null = null;

    try {
      // Enum columns are TEXT in SQLite, so the value is parsed, not asserted.
      action = actionTypeSchema.parse(step.action);

      if (NEEDS_TARGET.has(action)) {
        // Rung 1: what worked last time, if it is still trusted.
        const remembered = await this.knowledge.recall(
          applicationId,
          stepKey({
            action,
            intent: step.intent,
            targetDescription: step.targetDescription,
          }),
        );

        const resolution = await this.resolver.resolve(page, hints, {
          timeoutMs: STEP_TIMEOUT_MS / 2,
          knownSelector: remembered?.selector ?? null,
          // Rung 6 costs money, so it is offered only while the run is within
          // its budget.
          llm: run.withinBudget
            ? {
                intent: step.intent,
                targetDescription: step.targetDescription ?? step.intent,
                executionId,
                redactor: credentials.redactor,
              }
            : undefined,
        });

        if (!resolution.ok) {
          unresolvedTarget = true;
          throw new Error(resolution.message);
        }

        // Nothing is written to knowledge here. What this step taught is
        // decided once, after the run, by the consolidation pass — because what
        // a resolution was worth depends on whether the step then *verified*,
        // and that is not known yet.
        locator = resolution.locator;
        resolvedSelector = resolution.selector;
        strategy = resolution.strategy;
        candidateCount = resolution.candidateCount;
        confidence = resolution.confidence;
        learnedHints = resolution.learnedHints ?? null;
      }

      await performAction(
        page,
        action,
        locator,
        resolveData(data, credentials),
        { timeoutMs: STEP_TIMEOUT_MS, fallbackUrl: run.environmentBaseUrl },
      );
    } catch (caught) {
      status = 'FAIL';
      error =
        caught instanceof UnresolvedDataError
          ? caught.message
          : credentials.redactor.redact(
              caught instanceof Error ? caught.message : String(caught),
            );
    }

    // Drained before verification, because the verifier judges on what the
    // browser reported during *this* step.
    const observed = collector.drain();

    const expectation = parseJson(
      expectationSchema,
      step.expectation,
      `TestStep.expectation#${step.id}`,
    );

    let rationale: string | null = null;
    let diagnosis: DiagnosisResult | null = null;

    if (status === 'PASS') {
      const verdict = await this.verify(page, {
        expectation,
        intent: step.intent,
        hints,
        observed,
        run,
      });

      status = verdict.status;
      rationale = verdict.rationale;
    }

    // Evidence of a failure is captured before anything reacts to it. A heal is
    // about to change the page, and the state that failed is the state worth
    // keeping — it is what a bug report cites and what a reviewer compares
    // against.
    let evidenceCaptured = false;

    if (status === 'FAIL') {
      await this.captureStepEvidence(
        page,
        row.id,
        executionId,
        run.dir,
        step.index,
        observed,
        credentials.redactor,
      );
      evidenceCaptured = true;

      const reaction = await this.react(page, {
        step,
        executionStepId: row.id,
        expectation,
        hints,
        data,
        action,
        error,
        rationale,
        unresolvedTarget,
        observed,
        run,
      });

      status = reaction.status;
      rationale = reaction.rationale;
      diagnosis = reaction.diagnosis;

      if (reaction.healedSelector !== null) {
        resolvedSelector = reaction.healedSelector;
        strategy = 'LLM';
        await this.captureHealedShot(
          page,
          row.id,
          executionId,
          run.dir,
          step.index,
        );
      }
    } else if (learnedHints !== null) {
      // The step passed, but only because the model found what the recorded
      // hints could not. The run survived; the *specification* is still wrong,
      // and will need a model call on every future run until someone fixes it.
      // That is drift by definition, so it goes to the queue as a proposal —
      // with no second model call, because the winning target is already known.
      await this.proposeDriftRepair(row.id, step, hints, learnedHints, run);
    }

    const finishedAt = new Date();

    if (!evidenceCaptured) {
      await this.captureStepEvidence(
        page,
        row.id,
        executionId,
        run.dir,
        step.index,
        observed,
        credentials.redactor,
      );
    }

    const updated = await this.prisma.executionStep.update({
      where: { id: row.id },
      data: {
        status,
        error,
        verifierRationale: rationale,
        resolvedSelector,
        resolutionStrategy: strategy,
        candidateCount,
        confidence,
        diagnosis: diagnosis?.diagnosis ?? null,
        diagnosisRationale: diagnosis?.rationale ?? null,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    hooks.emit({ type: 'execution.step', step: toExecutionStep(updated) });

    return status;
  }

  /** One verification pass, with the run's budget applied. */
  private async verify(
    page: Page,
    input: {
      expectation: Expectation;
      intent: string;
      hints: TargetHints;
      observed: { network: NetworkEntry[]; console: ConsoleEntry[] };
      run: StepRunContext;
    },
  ): Promise<{ status: StepStatus; rationale: string }> {
    const verdict = await this.verifier.verify(page, input.expectation, {
      intent: input.intent,
      hints: input.hints,
      network: input.observed.network,
      console: input.observed.console,
      redactor: input.run.credentials.redactor,
      executionId: input.run.executionId,
      allowSemantic: input.run.withinBudget,
    });

    return { status: verdict.status, rationale: verdict.rationale };
  }

  /**
   * What happens after a step fails: classify it, then either repair the test or
   * file a defect against the application.
   *
   * The asymmetry between those two is the whole point of this phase. A tool
   * that heals every failure reports green over a broken application, so the
   * healer is reachable from exactly one classification and the gate is code in
   * `HealerService`, not an instruction in a prompt.
   */
  private async react(
    page: Page,
    input: {
      step: TestStepRow;
      executionStepId: string;
      expectation: Expectation;
      hints: TargetHints;
      data: StepData | null;
      action: ActionType | null;
      error: string | null;
      rationale: string | null;
      unresolvedTarget: boolean;
      /** Mutated to include anything observed while reacting. */
      observed: { network: NetworkEntry[]; console: ConsoleEntry[] };
      run: StepRunContext;
    },
  ): Promise<{
    status: StepStatus;
    rationale: string | null;
    diagnosis: DiagnosisResult | null;
    healedSelector: string | null;
  }> {
    const { step, run, observed } = input;
    const action = input.action ?? actionTypeSchema.parse(step.action);

    // A verification failure, where the action itself ran, gets one more look
    // after the page settles. This is the only evidence FLAKE is ever concluded
    // from, and nothing is re-run to obtain it.
    if (!input.unresolvedTarget && input.error === null) {
      await page.waitForTimeout(SETTLE_BEFORE_REVERIFY_MS);
      this.absorb(observed, run.collector.drain());

      const second = await this.verify(page, {
        expectation: input.expectation,
        intent: step.intent,
        hints: input.hints,
        observed,
        run,
      });

      if (second.status === 'PASS') {
        return {
          status: 'PASS',
          rationale: `${input.rationale ?? 'The step failed its expectation.'} It passed on a second look ${SETTLE_BEFORE_REVERIFY_MS}ms later, with no further action taken.`,
          diagnosis: {
            diagnosis: 'FLAKE',
            confidence: 0.7,
            rationale:
              'The same expectation failed and then passed without anything being retried, so the step is timing-dependent rather than broken.',
          },
          healedSelector: null,
        };
      }
    }

    const diagnosis = await this.diagnoser.diagnose(
      page,
      {
        intent: step.intent,
        targetDescription: step.targetDescription,
        action,
        url: page.url(),
        error: input.error,
        verifierRationale: input.rationale,
        unresolvedTarget: input.unresolvedTarget,
        network: observed.network,
        console: observed.console,
      },
      {
        executionId: run.executionId,
        redactor: run.credentials.redactor,
        priorSteps: run.priorIntents,
        knowledge: await this.knowledgeLines(run.applicationId),
        allowModel: run.withinBudget,
      },
    );

    const failed = {
      status: 'FAIL' as StepStatus,
      rationale: input.rationale,
      diagnosis,
      healedSelector: null,
    };

    if (diagnosis.diagnosis === 'APP_BUG') {
      await this.fileBug({ ...input, url: page.url() }, diagnosis);
      return failed;
    }

    if (diagnosis.diagnosis !== 'TEST_DRIFT') return failed;

    return this.heal(page, input, diagnosis, action);
  }

  /**
   * Repairs the step's targeting, re-runs the action against it, and proves the
   * result before the step counts as healed.
   *
   * One attempt. A heal that cannot prove itself is recorded and the step stays
   * failed — a healer allowed to keep guessing will eventually find something
   * that passes for the wrong reason, and that is indistinguishable from working
   * software right up until it matters.
   */
  private async heal(
    page: Page,
    input: {
      step: TestStepRow;
      executionStepId: string;
      expectation: Expectation;
      hints: TargetHints;
      data: StepData | null;
      rationale: string | null;
      error: string | null;
      observed: { network: NetworkEntry[]; console: ConsoleEntry[] };
      run: StepRunContext;
    },
    diagnosis: DiagnosisResult,
    action: ActionType,
  ): Promise<{
    status: StepStatus;
    rationale: string | null;
    diagnosis: DiagnosisResult;
    healedSelector: string | null;
  }> {
    const { step, run, observed } = input;

    const failed = {
      status: 'FAIL' as StepStatus,
      rationale: input.rationale,
      diagnosis,
      healedSelector: null,
    };

    if (!run.withinBudget) {
      return {
        ...failed,
        rationale: `${input.rationale ?? input.error ?? 'The step failed.'} It looks like test drift, but the run had no model budget left to attempt a repair.`,
      };
    }

    const proposal = await this.healer.propose(
      page,
      {
        executionStepId: input.executionStepId,
        specVersionId: run.versionId,
        intent: step.intent,
        action,
        targetDescription: step.targetDescription,
        originalHints: input.hints,
        diagnosis,
        failure: input.error ?? input.rationale ?? 'The step failed.',
      },
      {
        executionId: run.executionId,
        redactor: run.credentials.redactor,
      },
    );

    if (!proposal.ok) {
      if (proposal.healingId !== null) {
        await this.emitHealing(proposal.healingId, run);
      }

      return {
        ...failed,
        rationale: `${input.rationale ?? input.error ?? 'The step failed.'} ${proposal.reason}`,
      };
    }

    let applyError: string | null = null;

    try {
      await performAction(
        page,
        action,
        proposal.locator,
        resolveData(input.data, run.credentials),
        { timeoutMs: STEP_TIMEOUT_MS, fallbackUrl: run.environmentBaseUrl },
      );
    } catch (caught) {
      applyError = run.credentials.redactor.redact(
        caught instanceof Error ? caught.message : String(caught),
      );
    }

    this.absorb(observed, run.collector.drain());

    const reverified =
      applyError !== null
        ? { status: 'FAIL' as StepStatus, rationale: applyError }
        : await this.verify(page, {
            expectation: input.expectation,
            intent: step.intent,
            hints: proposal.hints,
            observed,
            run,
          });

    // UNCERTAIN is not proof. A heal counts only when the verifier says so.
    const proved = reverified.status === 'PASS';

    await this.healer.settle(proposal.healingId, proved ? 'PASS' : 'FAIL');
    await this.emitHealing(proposal.healingId, run);

    if (!proved) {
      return {
        ...failed,
        rationale: `A repair was attempted (${proposal.selector}) and did not hold: ${reverified.rationale}`,
      };
    }

    return {
      status: 'HEALED',
      rationale: `Healed: ${proposal.rationale} Re-targeted to ${proposal.selector}, and the step then passed — ${reverified.rationale}`,
      diagnosis,
      healedSelector: proposal.selector,
    };
  }

  /**
   * Queues a repair for a step that **passed**, because it only passed via the
   * model.
   *
   * The resolver's LLM rung rescues the run and writes a selector memory, but
   * memories decay and are invisible in the specification — which still carries
   * hints that match nothing and will need a model call on every future run.
   * This is the cheapest heal there is: the target that worked is already known,
   * so no second model call is needed to propose it.
   */
  private async proposeDriftRepair(
    executionStepId: string,
    step: TestStepRow,
    original: TargetHints,
    learned: TargetHints,
    run: StepRunContext,
  ): Promise<void> {
    try {
      const record = await this.prisma.healingRecord.create({
        data: {
          executionStepId,
          specVersionId: run.versionId,
          diagnosis: 'TEST_DRIFT',
          originalTarget: stringifyJson(
            targetHintsSchema,
            original,
            'HealingRecord.originalTarget',
          ),
          proposedTarget: stringifyJson(
            targetHintsSchema,
            learned,
            'HealingRecord.proposedTarget',
          ),
          proposedDescription: null,
          rationale:
            'The recorded targeting no longer matches anything; the step only passed because the model identified the control from its description. Adopting what it found lets future runs resolve this step deterministically.',
          // Already proven: the step ran against this target and verified.
          status: 'APPLIED',
          reverifyStatus: 'PASS',
        },
      });

      await this.emitHealing(record.id, run);
    } catch (error) {
      // A proposal is an improvement, never a requirement. A run that passed
      // must not be failed by the bookkeeping that follows it.
      this.logger.warn(
        `Could not queue a drift repair for "${step.intent}"`,
        error as Error,
      );
    }
  }

  private async fileBug(
    input: {
      step: TestStepRow;
      executionStepId: string;
      url: string;
      error: string | null;
      rationale: string | null;
      observed: { network: NetworkEntry[]; console: ConsoleEntry[] };
      run: StepRunContext;
    },
    diagnosis: DiagnosisResult,
  ): Promise<void> {
    const { step, run } = input;

    try {
      const artifacts = await this.prisma.artifact.findMany({
        where: { executionStepId: input.executionStepId },
        select: { id: true },
      });

      await this.bugs.file(
        {
          executionId: run.executionId,
          executionStepId: input.executionStepId,
          specId: run.specId,
          stepIndex: step.index,
          intent: step.intent,
          url: input.url,
          error: input.error,
          verifierRationale: input.rationale,
          diagnosis,
          network: input.observed.network,
          console: input.observed.console,
          optional: step.optional,
          // The steps that actually ran, including this one.
          executedSteps: [...run.priorIntents, step.intent],
          evidenceRefs: artifacts.map((artifact) => artifact.id),
        },
        {
          redactor: run.credentials.redactor,
          allowModel: run.withinBudget,
        },
      );
    } catch (error) {
      this.logger.error(
        `Could not file a bug for "${step.intent}"`,
        error as Error,
      );
    }
  }

  /** Publishes a healing record to whoever is watching the run. */
  private async emitHealing(
    healingId: string,
    run: StepRunContext,
  ): Promise<void> {
    try {
      const row = await this.prisma.healingRecord.findUnique({
        where: { id: healingId },
      });

      if (row === null) return;

      run.hooks.emit({
        type: 'execution.healing',
        healing: toHealingRecord(row),
      });
    } catch {
      /* the stream is a convenience; the record is the record */
    }
  }

  /** The handful of things worth telling the diagnoser about this application. */
  private async knowledgeLines(applicationId: string): Promise<string[]> {
    try {
      const { items } = await this.knowledge.list(applicationId, {
        limit: 10,
        offset: 0,
      });

      return items
        .filter((item) => item.value.kind === 'SELECTOR_MEMORY')
        .map(
          (item) =>
            `${item.key} resolved to ${
              item.value.kind === 'SELECTOR_MEMORY' ? item.value.selector : ''
            } (confidence ${item.confidence.toFixed(2)})`,
        );
    } catch {
      return [];
    }
  }

  /** Folds a later drain into the step's running observations. */
  private absorb(
    observed: { network: NetworkEntry[]; console: ConsoleEntry[] },
    more: { network: NetworkEntry[]; console: ConsoleEntry[] },
  ): void {
    observed.network.push(...more.network);
    observed.console.push(...more.console);
  }

  /**
   * Screenshot, DOM, accessibility tree, network, and console for one step.
   *
   * **Every text artifact goes through the redactor.** A password typed into a
   * real form appears in the DOM as a `value` attribute and — less obviously —
   * in Playwright's ARIA snapshot, which reports the textbox's value. Evidence
   * is written to disk and shared, so a leak here outlives the run that caused
   * it. Screenshots need no redaction: the browser renders a password field as
   * dots.
   */
  private async captureStepEvidence(
    page: Page,
    executionStepId: string,
    executionId: string,
    dir: string,
    index: number,
    observed: { network: NetworkEntry[]; console: ConsoleEntry[] },
    redactor: Redactor,
  ): Promise<void> {
    const stepDir = `${dir}/step-${index}`;

    const write = async (
      name: string,
      body: Buffer | string,
      kind: 'SCREENSHOT' | 'DOM' | 'A11Y' | 'NETWORK' | 'CONSOLE',
    ): Promise<string | null> => {
      try {
        const relPath = await this.evidence.write(`${stepDir}/${name}`, body);
        await this.prisma.artifact.create({
          data: {
            executionId,
            executionStepId,
            kind,
            relPath,
            bytes: await this.evidence.size(relPath),
          },
        });
        return relPath;
      } catch {
        return null;
      }
    };

    const observation = async (
      kind: 'URL' | 'DOM' | 'A11Y' | 'NETWORK' | 'CONSOLE' | 'SCREENSHOT',
      payload: unknown,
    ): Promise<void> => {
      await this.prisma.observation.create({
        data: {
          executionStepId,
          kind,
          payload: stringifyJson(
            observationPayloadSchema,
            payload,
            'Observation.payload',
          ),
        },
      });
    };

    try {
      await observation('URL', { kind: 'URL', url: page.url() });
    } catch {
      /* the page may be gone; the rest of the evidence still matters */
    }

    try {
      const shot = await page.screenshot({
        type: 'jpeg',
        quality: 60,
        timeout: 5000,
      });
      await write('shot.jpg', shot, 'SCREENSHOT');
      await observation('SCREENSHOT', { kind: 'SCREENSHOT' });
    } catch {
      /* best effort */
    }

    try {
      const html = redactor.redact(await page.content());
      await write('dom.html', html, 'DOM');
      await observation('DOM', {
        kind: 'DOM',
        bytes: html.length,
        truncated: false,
      });
    } catch {
      /* best effort */
    }

    try {
      // Playwright reports a textbox's value here, and for a password field
      // that value is the real password.
      const aria = redactor.redact(
        await page.locator('body').ariaSnapshot({ timeout: 5000 }),
      );
      await write('a11y.yaml', aria, 'A11Y');
      await observation('A11Y', { kind: 'A11Y' });
    } catch {
      /* best effort */
    }

    await write(
      'network.json',
      JSON.stringify(observed.network, null, 1),
      'NETWORK',
    );
    await observation('NETWORK', {
      kind: 'NETWORK',
      entries: observed.network,
    });

    await write(
      'console.json',
      JSON.stringify(observed.console, null, 1),
      'CONSOLE',
    );
    await observation('CONSOLE', {
      kind: 'CONSOLE',
      entries: observed.console,
    });
  }

  /**
   * The page after a repair held.
   *
   * A second screenshot rather than an overwrite: the reviewer's question is
   * "what changed", and answering it needs both the state that failed and the
   * state that passed.
   */
  private async captureHealedShot(
    page: Page,
    executionStepId: string,
    executionId: string,
    dir: string,
    index: number,
  ): Promise<void> {
    try {
      const shot = await page.screenshot({
        type: 'jpeg',
        quality: 60,
        timeout: 5000,
      });

      const relPath = await this.evidence.write(
        `${dir}/step-${index}/healed-shot.jpg`,
        shot,
      );

      await this.prisma.artifact.create({
        data: {
          executionId,
          executionStepId,
          kind: 'SCREENSHOT',
          relPath,
          bytes: await this.evidence.size(relPath),
        },
      });
    } catch {
      /* best effort — the heal itself is already recorded */
    }
  }

  private async finalizeEvidence(
    context: BrowserContext,
    page: Page | null,
    executionId: string,
    dir: string,
  ): Promise<void> {
    try {
      await context.tracing.stop({
        path: this.evidence.resolve(`${dir}/trace.zip`),
      });
      await this.prisma.artifact.create({
        data: {
          executionId,
          kind: 'TRACE',
          relPath: `${dir}/trace.zip`,
          bytes: await this.evidence.size(`${dir}/trace.zip`),
        },
      });
    } catch (error) {
      this.logger.warn(`No trace for execution ${executionId}`, error as Error);
    }

    // Playwright only finalizes a video when the context closes, so the close
    // has to happen here rather than in the caller's `finally`, with the
    // artifact recorded afterwards. Closing twice is harmless.
    const video = page?.video();

    try {
      await context.close();
    } catch {
      /* already closed */
    }

    if (video !== null && video !== undefined) {
      try {
        const absolute = await video.path();
        const relPath = `${dir}/${path.basename(absolute)}`;

        await this.prisma.artifact.create({
          data: {
            executionId,
            kind: 'VIDEO',
            relPath,
            bytes: await this.evidence.size(relPath),
          },
        });
      } catch (error) {
        this.logger.warn(
          `No video for execution ${executionId}`,
          error as Error,
        );
      }
    }
  }

  private async finish(
    executionId: string,
    status: ExecutionStatus,
    hooks: RunHooks,
    extra: { error?: string | null } = {},
  ): Promise<void> {
    const counts = await this.prisma.executionStep.groupBy({
      by: ['status'],
      where: { executionId },
      _count: true,
    });

    const summary = counts
      .map((entry) => `${entry._count} ${entry.status.toLowerCase()}`)
      .sort()
      .join(', ');

    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status,
        finishedAt: new Date(),
        summary: summary === '' ? null : summary,
        error: extra.error ?? null,
      },
    });

    // Both are free — no model, no browser — and both read rows that will not
    // change again. Doing them here means a finished run is complete: what it
    // learned is folded in, and there is a report to read.
    await this.consolidation
      .consolidate(executionId)
      .catch((error: unknown) =>
        this.logger.error(
          `Could not consolidate knowledge for ${executionId}`,
          error as Error,
        ),
      );

    await this.reports
      .generate(executionId)
      .catch((error: unknown) =>
        this.logger.error(
          `Could not write a report for ${executionId}`,
          error as Error,
        ),
      );

    hooks.emit({
      type: 'execution.finished',
      executionId,
      status,
      summary: summary === '' ? null : summary,
    });
  }
}
