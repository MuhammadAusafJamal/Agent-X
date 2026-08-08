import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  actionTypeSchema,
  credentialRefsSchema,
  observationPayloadSchema,
  parseJson,
  stepDataSchema,
  stringifyJson,
  targetHintsSchema,
  type ExecutionSseEvent,
  type ExecutionStatus,
  type StepStatus,
} from '@agentx/shared';
import type { TestStep as TestStepRow } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TypedConfigService } from '../config/typed-config.service';
import { EvidenceService } from '../evidence/evidence.service';
import { ResolverService } from '../resolver/resolver.service';
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
    let status: ExecutionStatus = 'PASSED';
    let runError: string | null = null;

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

        const outcome = await this.runStep(
          page,
          execution.id,
          step,
          credentials,
          collector,
          execution.environment.baseUrl,
          dir,
          hooks,
        );

        if (outcome === 'FAIL' && !step.optional) {
          status = 'FAILED';
          break;
        }
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

    await this.finish(executionId, status, hooks, { error: runError });
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

    try {
      // Enum columns are TEXT in SQLite, so the value is parsed, not asserted.
      const action = actionTypeSchema.parse(step.action);
      let locator = null;

      if (NEEDS_TARGET.has(action)) {
        const resolution = await this.resolver.resolve(page, hints, {
          timeoutMs: STEP_TIMEOUT_MS / 2,
        });

        if (!resolution.ok) {
          throw new Error(resolution.message);
        }

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

    const finishedAt = new Date();

    await this.captureStepEvidence(
      page,
      row.id,
      executionId,
      dir,
      step.index,
      collector,
      credentials.redactor,
    );

    const updated = await this.prisma.executionStep.update({
      where: { id: row.id },
      data: {
        status,
        error,
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
    collector: ObservationCollector,
    redactor: Redactor,
  ): Promise<void> {
    const stepDir = `${dir}/step-${index}`;
    const observed = collector.drain();

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
