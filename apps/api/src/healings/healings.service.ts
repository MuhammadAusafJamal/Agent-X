import { Injectable, Logger } from '@nestjs/common';
import type {
  DraftTestStep,
  HealingRecordWithContext,
  ListHealingsQuery,
  Paginated,
  ReviewHealingsInput,
  TargetHints,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestError, NotFoundError } from '../common/errors';
import { SpecsService } from '../specs/specs.service';
import { toTestStep } from '../specs/specs.mapper';
import { toHealingRecord } from './healings.mapper';

/** Everything the queue shows, joined in one read. */
const WITH_CONTEXT = {
  specVersion: {
    include: {
      spec: { select: { id: true, name: true, applicationId: true } },
    },
  },
  executionStep: {
    include: {
      artifacts: {
        where: { kind: 'SCREENSHOT' },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
} as const;

/**
 * The review queue.
 *
 * Its whole reason for existing is that **a specification is never mutated in
 * place**. An approved heal writes version N+1 with `source: HEALED`; version N
 * stays exactly as it was, so every automated change to a test is attributable
 * and can be rolled back by running the earlier version.
 */
@Injectable()
export class HealingsService {
  private readonly logger = new Logger(HealingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly specs: SpecsService,
  ) {}

  async list(
    query: ListHealingsQuery,
  ): Promise<Paginated<HealingRecordWithContext>> {
    const where = {
      // The default is the queue: what is waiting on a person. A heal that
      // could not prove itself is visible on its run, not here.
      status:
        query.status === undefined
          ? { in: ['PROPOSED', 'APPLIED'] }
          : query.status,
      ...(query.executionId === undefined
        ? {}
        : { executionStep: { executionId: query.executionId } }),
      ...(query.specId === undefined
        ? {}
        : { specVersion: { specId: query.specId } }),
      ...(query.applicationId === undefined
        ? {}
        : { specVersion: { spec: { applicationId: query.applicationId } } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.healingRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: WITH_CONTEXT,
      }),
      this.prisma.healingRecord.count({ where }),
    ]);

    return {
      items: rows.map(toContext),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<HealingRecordWithContext> {
    const row = await this.prisma.healingRecord.findUnique({
      where: { id },
      include: WITH_CONTEXT,
    });

    if (row === null) throw new NotFoundError('Healing record', id);

    return toContext(row);
  }

  /**
   * Approves or rejects a batch, writing at most one new version.
   *
   * Batching is not a convenience: approving four heals from one run one at a
   * time would write four versions, three of which nobody ever ran, and the
   * spec's history would record a migration that never happened that way.
   */
  async review(
    input: ReviewHealingsInput,
  ): Promise<{ appliedToVersionId: string | null; reviewed: number }> {
    const rows = await this.prisma.healingRecord.findMany({
      where: { id: { in: input.healingIds } },
      include: {
        executionStep: { select: { stepId: true, intent: true } },
      },
    });

    if (rows.length !== input.healingIds.length) {
      throw new NotFoundError('Healing record', input.healingIds.join(', '));
    }

    const open = rows.filter(
      (row) => row.status === 'PROPOSED' || row.status === 'APPLIED',
    );

    if (open.length === 0) {
      throw new BadRequestError(
        'Every one of these healings has already been reviewed.',
      );
    }

    if (input.decision === 'REJECT') {
      await this.prisma.healingRecord.updateMany({
        where: { id: { in: open.map((row) => row.id) } },
        data: { status: 'REJECTED', reviewedAt: new Date() },
      });

      // The specification is untouched, so the next run fails exactly as this
      // one did. That is the point of rejecting, not a shortcoming of it.
      return { appliedToVersionId: null, reviewed: open.length };
    }

    const versionIds = new Set(open.map((row) => row.specVersionId));

    if (versionIds.size > 1) {
      throw new BadRequestError(
        'These healings belong to different versions of the specification, so they cannot be approved together.',
      );
    }

    const versionId = open[0].specVersionId;

    const version = await this.prisma.testVersion.findUnique({
      where: { id: versionId },
      include: { steps: { orderBy: { index: 'asc' } } },
    });

    if (version === null) throw new NotFoundError('Test version', versionId);

    // Keyed by the spec step each heal repairs. A heal whose execution step was
    // invented by the agent has nothing to write back to.
    const repairs = new Map<
      string,
      { hints: TargetHints; description: string | null }
    >();

    for (const row of open) {
      const stepId = row.executionStep.stepId;

      if (stepId === null) {
        throw new BadRequestError(
          `The heal for "${row.executionStep.intent}" is not attached to a step in this specification, so it cannot be approved into one.`,
        );
      }

      const healing = toHealingRecord(row);
      repairs.set(stepId, {
        hints: healing.proposedTarget,
        description: healing.proposedDescription,
      });
    }

    const steps: DraftTestStep[] = version.steps.map((row) => {
      const step = toTestStep(row);
      const repair = repairs.get(row.id);

      return {
        intent: step.intent,
        action: step.action,
        targetDescription: repair?.description ?? step.targetDescription,
        targetHints: repair?.hints ?? step.targetHints,
        data: step.data,
        expectation: step.expectation,
        optional: step.optional,
      };
    });

    const note = [
      `healed: ${open.length} step${open.length === 1 ? '' : 's'} re-targeted`,
      input.note ?? null,
    ]
      .filter((part) => part !== null)
      .join(' — ');

    const created = await this.specs.createVersion(
      version.specId,
      { note, steps },
      { source: 'HEALED' },
    );

    await this.prisma.healingRecord.updateMany({
      where: { id: { in: open.map((row) => row.id) } },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        appliedToVersionId: created.id,
      },
    });

    this.logger.log(
      `Approved ${open.length} heal(s) into version ${created.version} of spec ${version.specId}`,
    );

    return { appliedToVersionId: created.id, reviewed: open.length };
  }
}

type HealingRowWithContext = Parameters<typeof toHealingRecord>[0] & {
  specVersion: {
    version: number;
    spec: { id: string; name: string; applicationId: string };
  };
  executionStep: {
    executionId: string;
    index: number;
    intent: string;
    stepId: string | null;
    artifacts: { relPath: string }[];
  };
};

function toContext(row: HealingRowWithContext): HealingRecordWithContext {
  // The failing state is captured before the heal is applied, the settled state
  // at the end of the step — so oldest and newest are before and after.
  const shots = row.executionStep.artifacts;

  return {
    ...toHealingRecord(row),
    applicationId: row.specVersion.spec.applicationId,
    specId: row.specVersion.spec.id,
    specName: row.specVersion.spec.name,
    specVersion: row.specVersion.version,
    executionId: row.executionStep.executionId,
    stepIndex: row.executionStep.index,
    stepIntent: row.executionStep.intent,
    stepId: row.executionStep.stepId,
    beforeShotPath: shots.length > 1 ? (shots[0]?.relPath ?? null) : null,
    afterShotPath: shots[shots.length - 1]?.relPath ?? null,
  };
}
