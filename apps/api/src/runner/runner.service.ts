import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  actionTypeSchema,
  credentialRefsSchema,
  expectationSchema,
  observationPayloadSchema,
  parseJson,
  stepDataSchema,
  stringifyJson,
  targetHintsSchema,
  type ConsoleEntry,
  type ExecutionSseEvent,
  type ExecutionStatus,
  type NetworkEntry,
  type StepStatus,
} from '@agentx/shared';
import type { TestStep as TestStepRow } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TypedConfigService } from '../config/typed-config.service';
import { EvidenceService } from '../evidence/evidence.service';
import { ResolverService } from '../resolver/resolver.service';
import { VerifierService } from '../verifier/verifier.service';
import { rollUp } from '../verifier/deterministic';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { stepKey } from '../resolver/step-key';
import {
  CredentialsService,
  type ResolvedCredentials,
} from '../credentials/credentials.service';
import type { Redactor } from '../credentials/redactor';
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

        const outcome = await this.runStep(
          page,
          execution.id,
          step,
          credentials,
          collector,
          execution.environment.baseUrl,
          dir,
          hooks,
          execution.environment.applicationId,
          spent < MAX_LLM_CALLS_PER_RUN,
        );

        outcomes.push({ status: outcome, optional: step.optional });

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

  /** One step: resolve, act, observe, record. */
  private async runStep(
    page: Page,
    executionId: string,
    step: TestStepRow,
    credentials: ResolvedCredentials,
    collector: ObservationCollector,
    fallbackUrl: string,
    dir: string,
    hooks: RunHooks,
    applicationId: string,
    withinBudget: boolean,
  ): Promise<StepStatus> {
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
    let learnedKey: string | null = null;

    try {
      // Enum columns are TEXT in SQLite, so the value is parsed, not asserted.
      const action = actionTypeSchema.parse(step.action);
      let locator = null;

      if (NEEDS_TARGET.has(action)) {
        const key = stepKey({
          action,
          intent: step.intent,
          targetDescription: step.targetDescription,
        });
        learnedKey = key;

        // Rung 1: what worked last time, if it is still trusted.
        const remembered = await this.knowledge.recall(applicationId, key);

        const resolution = await this.resolver.resolve(page, hints, {
          timeoutMs: STEP_TIMEOUT_MS / 2,
          knownSelector: remembered?.selector ?? null,
          // Rung 6 costs money, so it is offered only while the run is within
          // its budget.
          llm: withinBudget
            ? {
                intent: step.intent,
                targetDescription: step.targetDescription ?? step.intent,
                executionId,
                redactor: credentials.redactor,
              }
            : undefined,
        });

        if (!resolution.ok) {
          if (remembered !== null) {
            await this.knowledge.forgetIfWrong(applicationId, key);
          }
          throw new Error(resolution.message);
        }

        // A remembered selector that did not win has gone stale.
        if (remembered !== null && resolution.strategy !== 'KNOWLEDGE') {
          await this.knowledge.forgetIfWrong(applicationId, key);
        }

        // Learned on every success, not only the interesting ones: that is what
        // makes the *second* run of a spec take rung 1 and spend nothing.
        await this.knowledge.remember(
          applicationId,
          key,
          resolution.selector,
          resolution.strategy,
        );

        locator = resolution.locator;
        resolvedSelector = resolution.selector;
        strategy = resolution.strategy;
        candidateCount = resolution.candidateCount;
        confidence = resolution.confidence;
      }

      await performAction(
        page,
        action,
        locator,
        resolveData(data, credentials),
        { timeoutMs: STEP_TIMEOUT_MS, fallbackUrl },
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
    let rationale: string | null = null;

    if (status === 'PASS') {
      const verdict = await this.verifier.verify(
        page,
        parseJson(
          expectationSchema,
          step.expectation,
          `TestStep.expectation#${step.id}`,
        ),
        {
          intent: step.intent,
          hints,
          network: observed.network,
          console: observed.console,
          redactor: credentials.redactor,
          executionId,
        },
      );

      status = verdict.status;
      rationale = verdict.rationale;

      // Resolution succeeding is not the same as having found the right
      // element. If a remembered selector led to a step that then failed
      // verification, that memory is what took us there — decay it, or rung 1
      // will confidently repeat the mistake on every future run.
      if (
        status === 'FAIL' &&
        strategy === 'KNOWLEDGE' &&
        learnedKey !== null
      ) {
        await this.knowledge.forgetIfWrong(applicationId, learnedKey);
      }
    }

    const finishedAt = new Date();

    await this.captureStepEvidence(
      page,
      row.id,
      executionId,
      dir,
      step.index,
      observed,
      credentials.redactor,
    );

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
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    hooks.emit({ type: 'execution.step', step: toExecutionStep(updated) });

    return status;
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

    hooks.emit({
      type: 'execution.finished',
      executionId,
      status,
      summary: summary === '' ? null : summary,
    });
  }
}
