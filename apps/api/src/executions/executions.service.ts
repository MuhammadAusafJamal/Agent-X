import { Injectable, Logger } from '@nestjs/common';
import { EMPTY, Subject, type Observable } from 'rxjs';
import type {
  Execution,
  ExecutionDetail,
  ExecutionSseEvent,
  ListExecutionsQuery,
  Paginated,
  StartExecutionInput,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RunnerService } from '../runner/runner.service';
import { BadRequestError, NotFoundError } from '../common/errors';
import {
  toArtifact,
  toExecution,
  toExecutionStep,
  toObservation,
} from '../runner/runner.mapper';

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
  ) {}

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

  streamOrEmpty(id: string): Observable<ExecutionSseEvent> {
    return this.streams.get(id) ?? EMPTY;
  }

  async list(query: ListExecutionsQuery): Promise<Paginated<Execution>> {
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
      }),
      this.prisma.execution.count({ where }),
    ]);

    return {
      items: rows.map(toExecution),
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
      },
    });

    if (row === null) throw new NotFoundError('Execution', id);

    return {
      ...toExecution(row),
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
