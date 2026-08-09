import { Injectable, Logger } from '@nestjs/common';
import { EMPTY, Subject, type Observable } from 'rxjs';
import type {
  AdjudicateStepInput,
  Execution,
  ExecutionDetail,
  ExecutionListItem,
  ExecutionSseEvent,
  ListExecutionsQuery,
  Paginated,
  StartExecutionInput,
} from '@agentx/shared';
import { rollUp } from '../verifier/deterministic';
import { PrismaService } from '../prisma/prisma.service';
import { RunnerService } from '../runner/runner.service';
import { ConsolidationService } from '../knowledge/consolidation.service';
import { TypedConfigService } from '../config/typed-config.service';
import { BadRequestError, NotFoundError } from '../common/errors';
import {
  toArtifact,
  toExecution,
  toExecutionStep,
  toObservation,
} from '../runner/runner.mapper';

/**
 * The joins behind `specName` / `specVersion` / `environmentName`.
 *
 * Narrow on purpose: a run view needs three strings, not three whole rows, and
 * this include is applied to every row of a list.
 */
const NAME_INCLUDES = {
  spec: { select: { name: true } },
  version: { select: { version: true } },
  environment: { select: { name: true } },
} as const;

function namesOf(row: {
  spec: { name: string };
  version: { version: number };
  environment: { name: string };
}): { specName: string; specVersion: number; environmentName: string } {
  return {
    specName: row.spec.name,
    specVersion: row.version.version,
    environmentName: row.environment.name,
  };
}

/**
 * Owns run lifecycle: queueing, cancellation, and the live event stream.
 *
 * Runs are **serialized**. Parallel workers are Phase 8; until then two headed
 * browsers competing for the screen is worse than a short wait, and a single
 * queue makes a run's timeline mean something.
 */
@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly streams = new Map<string, Subject<ExecutionSseEvent>>();
  private readonly cancelled = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: RunnerService,
    private readonly consolidation: ConsolidationService,
    private readonly config: TypedConfigService,
  ) {}

  /**
   * Closes out runs the last process was in the middle of.
   *
   * The queue below is in memory and the status is a row, so stopping the API
   * mid-run strands that row at `RUNNING` — and anything queued behind it at
   * `PENDING` — with nothing left to move either. The dashboard then shows a run
   * that never finishes and never fails.
   *
   * Not resumed, and not for want of trying: a half-executed browser session
   * cannot be picked back up, and replaying a spec whose earlier steps already
   * took effect is exactly what `SETTLE_BEFORE_REVERIFY_MS` refuses to do for
   * the same reason. `ERROR` is the honest status — the run did not fail, the
   * tool stopped.
   *
   * Assumes one API process per database. A second instance sharing the file
   * would error the first one's live runs on boot, because from here "nobody is
   * driving that row" and "somebody else is driving that row" look identical.
   * `AGENTX_SWEEP_INTERRUPTED_ON_BOOT` turns it off where that assumption fails
   * — chiefly the e2e harness, which starts an app per test file on purpose.
   */
  async onModuleInit(): Promise<void> {
    if (!this.config.get('AGENTX_SWEEP_INTERRUPTED_ON_BOOT')) return;

    try {
      const stranded = await this.prisma.execution.updateMany({
        where: { status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'ERROR',
          error: 'The API restarted while this run was in progress.',
          finishedAt: new Date(),
        },
      });

      if (stranded.count > 0) {
        this.logger.warn(
          `Marked ${stranded.count} run(s) errored: the API restarted while they were in progress.`,
        );
      }
    } catch (error) {
      // A sweep that cannot run is not a reason to refuse to boot.
      this.logger.error(
        `Could not close out interrupted runs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async start(input: StartExecutionInput): Promise<Execution> {
    const spec = await this.prisma.testSpec.findUnique({
      where: { id: input.specId },
    });

    if (spec === null) {
      throw new NotFoundError('Test specification', input.specId);
    }

    const versionId = input.versionId ?? spec.currentVersionId;

    if (versionId === null || versionId === undefined) {
      throw new BadRequestError(
        'This specification has no version to run. Compile a recording first.',
      );
    }

    const [version, environment] = await Promise.all([
      this.prisma.testVersion.findUnique({
        where: { id: versionId },
        include: { _count: { select: { steps: true } } },
      }),
      this.prisma.environment.findUnique({
        where: { id: input.environmentId },
      }),
    ]);

    if (version === null) throw new NotFoundError('Test version', versionId);
    if (environment === null) {
      throw new NotFoundError('Environment', input.environmentId);
    }
    if (version._count.steps === 0) {
      throw new BadRequestError('This version has no steps to run.');
    }

    const execution = await this.prisma.execution.create({
      data: {
        specId: spec.id,
        versionId,
        environmentId: input.environmentId,
        mode: input.mode,
        status: 'PENDING',
      },
    });

    const stream = new Subject<ExecutionSseEvent>();
    this.streams.set(execution.id, stream);

    // Queued, not awaited: the caller gets an id immediately and watches the
    // stream, rather than holding an HTTP request open for the whole run.
    this.queue = this.queue.then(async () => {
      try {
        await this.runner.run(execution.id, {
          emit: (event) => stream.next(event),
          isCancelled: () => this.cancelled.has(execution.id),
        });
      } catch (error) {
        this.logger.error(
          `Execution ${execution.id} failed outside the runner`,
          error as Error,
        );
        stream.next({
          type: 'execution.error',
          executionId: execution.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        stream.complete();
        this.streams.delete(execution.id);
        this.cancelled.delete(execution.id);
      }
    });

    return toExecution(execution);
  }

  /**
   * Cooperative cancellation: the runner checks between steps, so a run stops
   * at a step boundary with its evidence intact rather than being killed
   * mid-action.
   */
  async cancel(id: string): Promise<Execution> {
    const execution = await this.prisma.execution.findUnique({
      where: { id },
    });

    if (execution === null) throw new NotFoundError('Execution', id);

    this.cancelled.add(id);

    const updated = await this.prisma.execution.update({
      where: { id },
      data: { cancelRequested: true },
    });

    return toExecution(updated);
  }

  /**
   * A human settles a step the verifier could not.
   *
   * The original rationale is kept and the human's decision appended, so the
   * record shows both what the verifier said and who overruled it. The run
   * status is then recomputed — settling the last open question is what turns
   * an UNCERTAIN run green.
   */
  async adjudicate(
    executionId: string,
    stepId: string,
    input: AdjudicateStepInput,
  ): Promise<ExecutionDetail> {
    const step = await this.prisma.executionStep.findUnique({
      where: { id: stepId },
    });

    if (step === null || step.executionId !== executionId) {
      throw new NotFoundError('Execution step', stepId);
    }

    if (step.status !== 'UNCERTAIN') {
      throw new BadRequestError(
        `Only an UNCERTAIN step can be adjudicated; this one is ${step.status}.`,
      );
    }

    // The most reliable signal the system gets — someone actually looked — so it
    // is folded into knowledge even though the run is already closed.
    await this.consolidation.applyAdjudication(stepId, input.status);

    await this.prisma.executionStep.update({
      where: { id: stepId },
      data: {
        status: input.status,
        verifierRationale: [
          step.verifierRationale,
          `Adjudicated ${input.status} by a human${
            input.note === null || input.note === undefined
              ? ''
              : `: ${input.note}`
          }.`,
        ]
          .filter((part) => part !== null && part !== '')
          .join(' '),
      },
    });

    const steps = await this.prisma.executionStep.findMany({
      where: { executionId },
      include: { step: { select: { optional: true } } },
    });

    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: rollUp(
          steps.map((executed) => ({
            status: executed.status,
            optional: executed.step?.optional ?? false,
          })),
        ),
      },
    });

    return this.get(executionId);
  }

  streamOrEmpty(id: string): Observable<ExecutionSseEvent> {
    return this.streams.get(id) ?? EMPTY;
  }

  async list(
    query: ListExecutionsQuery,
  ): Promise<Paginated<ExecutionListItem>> {
    const where = {
      ...(query.specId === undefined ? {} : { specId: query.specId }),
      ...(query.environmentId === undefined
        ? {}
        : { environmentId: query.environmentId }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.execution.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        // Three names, one query. Without them the runs list can only show ids,
        // and the dashboard's only way to say what ran is to fetch every spec
        // separately — which is exactly what it was doing.
        include: NAME_INCLUDES,
      }),
      this.prisma.execution.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({ ...toExecution(row), ...namesOf(row) })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<ExecutionDetail> {
    const row = await this.prisma.execution.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { index: 'asc' },
          include: { observations: true },
        },
        artifacts: true,
        llmCalls: true,
        ...NAME_INCLUDES,
      },
    });

    if (row === null) throw new NotFoundError('Execution', id);

    return {
      ...toExecution(row),
      ...namesOf(row),
      steps: row.steps.map((step) => ({
        ...toExecutionStep(step),
        observations: step.observations.map(toObservation),
      })),
      artifacts: row.artifacts.map(toArtifact),
      // Computed from the audit rows rather than denormalized, so the totals
      // cannot drift from the calls they summarize.
      totals: {
        llmCallCount: row.llmCalls.length,
        inputTokens: row.llmCalls.reduce(
          (sum, call) => sum + call.inputTokens,
          0,
        ),
        outputTokens: row.llmCalls.reduce(
          (sum, call) => sum + call.outputTokens,
          0,
        ),
        costUsd: row.llmCalls.every((call) => call.costUsd === null)
          ? null
          : row.llmCalls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
      },
    };
  }
}
