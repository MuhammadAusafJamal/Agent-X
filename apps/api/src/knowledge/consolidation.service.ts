import { Injectable, Logger } from '@nestjs/common';
import {
  actionTypeSchema,
  resolutionStrategySchema,
  stepStatusSchema,
  type ResolutionStrategy,
  type StepStatus,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NEEDS_TARGET } from '../runner/actions';
import { stepKey } from '../resolver/step-key';
import { KnowledgeService } from './knowledge.service';

/**
 * One pass that folds a finished run's lessons into what the agent knows.
 *
 * The point of doing it here rather than inside the step loop is that the
 * confidence math gets **one home**. Scattered through the loop it was four
 * calls in three branches, each with its own idea of what counted as a hit, and
 * the Phase 5 demo found a case none of them covered — a step that resolved from
 * memory and then failed verification, which nothing penalised.
 *
 * It is also idempotent, which the in-loop version could not be. A run is
 * consolidated once; re-running this reads the same rows and changes nothing,
 * so replaying history cannot inflate confidence.
 */
@Injectable()
export class ConsolidationService {
  private readonly logger = new Logger(ConsolidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async consolidate(executionId: string): Promise<{ folded: number }> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        environment: { select: { applicationId: true } },
        steps: {
          orderBy: { index: 'asc' },
          include: { step: { select: { targetDescription: true } } },
        },
      },
    });

    if (execution === null) return { folded: 0 };

    if (execution.consolidatedAt !== null) {
      // Already folded in. Saying so is not a failure — the runner does this at
      // the end of a run and a human may ask for it again from the dashboard.
      return { folded: 0 };
    }

    const applicationId = execution.environment.applicationId;
    let folded = 0;

    for (const step of execution.steps) {
      const applied = await this.foldStep(applicationId, {
        action: step.action,
        intent: step.intent,
        targetDescription: step.step?.targetDescription ?? null,
        status: stepStatusSchema.parse(step.status),
        resolvedSelector: step.resolvedSelector,
        resolutionStrategy:
          step.resolutionStrategy === null
            ? null
            : resolutionStrategySchema.parse(step.resolutionStrategy),
      });

      if (applied) folded += 1;
    }

    await this.prisma.execution.update({
      where: { id: executionId },
      data: { consolidatedAt: new Date() },
    });

    this.logger.log(
      `Consolidated ${folded} lesson(s) from execution ${executionId}`,
    );

    return { folded };
  }

  /**
   * A human settling an `UNCERTAIN` step, after the run has been consolidated.
   *
   * Adjudication is the most reliable signal there is — someone looked — so it
   * is folded in even though the run is closed. It is also the only path that
   * writes to knowledge outside `consolidate`.
   */
  async applyAdjudication(
    executionStepId: string,
    status: StepStatus,
  ): Promise<void> {
    const step = await this.prisma.executionStep.findUnique({
      where: { id: executionStepId },
      include: {
        step: { select: { targetDescription: true } },
        execution: {
          select: { environment: { select: { applicationId: true } } },
        },
      },
    });

    if (step === null) return;

    await this.foldStep(step.execution.environment.applicationId, {
      action: step.action,
      intent: step.intent,
      targetDescription: step.step?.targetDescription ?? null,
      status,
      resolvedSelector: step.resolvedSelector,
      resolutionStrategy:
        step.resolutionStrategy === null
          ? null
          : resolutionStrategySchema.parse(step.resolutionStrategy),
    });
  }

  /**
   * What one step taught, if anything.
   *
   * The asymmetry between the branches is deliberate and is the lesson of the
   * Phase 5 demo: **resolving is not the same as having found the right
   * element.** A step that resolved from memory and then failed verification
   * must penalise that memory, or rung 1 repeats the mistake confidently on
   * every future run.
   */
  private async foldStep(
    applicationId: string,
    step: {
      action: string;
      intent: string;
      targetDescription: string | null;
      status: StepStatus;
      resolvedSelector: string | null;
      resolutionStrategy: ResolutionStrategy | null;
    },
  ): Promise<boolean> {
    const action = actionTypeSchema.parse(step.action);

    if (!NEEDS_TARGET.has(action)) return false;

    const key = stepKey({
      action,
      intent: step.intent,
      targetDescription: step.targetDescription,
    });

    // Never found what it was looking for. Whatever is remembered for this
    // target did not help, and should be trusted less next time.
    if (step.resolvedSelector === null || step.resolutionStrategy === null) {
      if (step.status === 'FAIL') {
        await this.knowledge.forgetIfWrong(applicationId, key);
        return true;
      }
      return false;
    }

    switch (step.status) {
      case 'PASS':
      case 'HEALED':
        // Confirmed by the outcome, not merely by the lookup. A healed step
        // records the target that actually worked, so the next run takes rung 1
        // straight to it and spends nothing.
        await this.knowledge.remember(
          applicationId,
          key,
          step.resolvedSelector,
          step.resolutionStrategy,
        );
        return true;

      case 'FAIL':
        await this.knowledge.forgetIfWrong(applicationId, key);
        return true;

      // An unresolved question teaches nothing until a human settles it, which
      // is what `applyAdjudication` is for.
      default:
        return false;
    }
  }
}
