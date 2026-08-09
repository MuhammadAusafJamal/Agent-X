import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  parseJson,
  type Feature,
  type FeatureRunResult,
  type RunFeatureInput,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionsService } from '../executions/executions.service';
import { BadRequestError, NotFoundError } from '../common/errors';

const criteriaKeysSchema = z.array(z.string());

/**
 * Features, and running the suites generated against them.
 *
 * A feature is only a grouping. The specs under it are ordinary specs and the
 * runs are ordinary runs, which is what makes regression, smoke, and
 * cross-environment the same mechanism rather than three: `ALL` is regression,
 * `CRITICAL` is smoke, and running against staging instead of local is the same
 * call with a different `environmentId`.
 */
@Injectable()
export class FeaturesService {
  private readonly logger = new Logger(FeaturesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executions: ExecutionsService,
  ) {}

  async list(applicationId?: string): Promise<Feature[]> {
    const rows = await this.prisma.feature.findMany({
      where: applicationId === undefined ? {} : { applicationId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { specs: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      applicationId: row.applicationId,
      name: row.name,
      description: row.description,
      specCount: row._count.specs,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async get(id: string): Promise<Feature> {
    const row = await this.prisma.feature.findUnique({
      where: { id },
      include: { _count: { select: { specs: true } } },
    });

    if (row === null) throw new NotFoundError('Feature', id);

    return {
      id: row.id,
      applicationId: row.applicationId,
      name: row.name,
      description: row.description,
      specCount: row._count.specs,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The suite, with the criteria each case was written to settle. */
  async specs(id: string): Promise<
    {
      id: string;
      name: string;
      priority: string;
      criteriaKeys: string[];
      currentVersionId: string | null;
    }[]
  > {
    await this.get(id);

    const rows = await this.prisma.testSpec.findMany({
      where: { featureId: id },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      priority: row.priority ?? 'NORMAL',
      criteriaKeys:
        row.criteriaKeys === null
          ? []
          : parseJson(
              criteriaKeysSchema,
              row.criteriaKeys,
              `TestSpec.criteriaKeys#${row.id}`,
            ),
      currentVersionId: row.currentVersionId,
    }));
  }

  /**
   * Starts one run per member spec.
   *
   * Specs with no version are reported as skipped rather than failing the whole
   * call: a suite where one case never realized is still a suite worth running,
   * and a silent omission would read as "everything passed".
   */
  async run(id: string, input: RunFeatureInput): Promise<FeatureRunResult> {
    const feature = await this.get(id);

    const environment = await this.prisma.environment.findUnique({
      where: { id: input.environmentId },
    });

    if (environment === null) {
      throw new NotFoundError('Environment', input.environmentId);
    }

    if (environment.applicationId !== feature.applicationId) {
      throw new BadRequestError(
        'That environment belongs to a different application than this feature.',
      );
    }

    const specs = await this.prisma.testSpec.findMany({
      where: {
        featureId: id,
        ...(input.filter === 'CRITICAL' ? { priority: 'CRITICAL' } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const executionIds: string[] = [];
    const skipped: { specId: string; why: string }[] = [];

    for (const spec of specs) {
      if (spec.currentVersionId === null) {
        skipped.push({ specId: spec.id, why: 'no version to run' });
        continue;
      }

      try {
        const execution = await this.executions.start({
          specId: spec.id,
          environmentId: input.environmentId,
          mode: 'REPLAY',
        });

        executionIds.push(execution.id);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not start ${spec.name}: ${why}`);
        skipped.push({ specId: spec.id, why });
      }
    }

    return {
      featureId: id,
      environmentId: input.environmentId,
      filter: input.filter,
      executionIds,
      skipped,
    };
  }
}
