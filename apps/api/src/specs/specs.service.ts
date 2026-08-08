import { Injectable } from '@nestjs/common';
import {
  expectationSchema,
  stepDataSchema,
  stringifyJson,
  targetHintsSchema,
  type DraftTestStep,
  type ListSpecsQuery,
  type Paginated,
  type SaveVersionInput,
  type SpecSource,
  type TestSpec,
  type TestSpecWithCurrentVersion,
  type TestVersion,
  type TestVersionWithSteps,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toTestSpec, toTestStep, toTestVersion } from './specs.mapper';

@Injectable()
export class SpecsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSpecsQuery): Promise<Paginated<TestSpec>> {
    const where =
      query.applicationId === undefined
        ? {}
        : { applicationId: query.applicationId };

    const [rows, total] = await Promise.all([
      this.prisma.testSpec.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.testSpec.count({ where }),
    ]);

    return {
      items: rows.map(toTestSpec),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<TestSpecWithCurrentVersion> {
    const row = await this.prisma.testSpec.findUnique({ where: { id } });

    if (row === null) {
      throw new NotFoundError('Test specification', id);
    }

    const spec = toTestSpec(row);
    const currentVersion =
      spec.currentVersionId === null
        ? null
        : await this.getVersion(spec.currentVersionId);

    return { ...spec, currentVersion };
  }

  async getVersion(versionId: string): Promise<TestVersionWithSteps> {
    const row = await this.prisma.testVersion.findUnique({
      where: { id: versionId },
      include: { steps: { orderBy: { index: 'asc' } } },
    });

    if (row === null) {
      throw new NotFoundError('Test version', versionId);
    }

    return { ...toTestVersion(row), steps: row.steps.map(toTestStep) };
  }

  async listVersions(specId: string): Promise<TestVersion[]> {
    await this.assertSpecExists(specId);

    const rows = await this.prisma.testVersion.findMany({
      where: { specId },
      orderBy: { version: 'desc' },
    });

    return rows.map(toTestVersion);
  }

  /**
   * Writes a new version. Existing versions are never modified.
   *
   * The version number is derived from the current maximum rather than a
   * counter on the spec, so two concurrent saves collide on the
   * `@@unique([specId, version])` constraint instead of silently overwriting
   * each other.
   */
  async createVersion(
    specId: string,
    input: SaveVersionInput,
    options: { source?: SpecSource; recordingId?: string | null } = {},
  ): Promise<TestVersionWithSteps> {
    await this.assertSpecExists(specId);

    const latest = await this.prisma.testVersion.findFirst({
      where: { specId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const version = await this.prisma.$transaction(async (tx) => {
      const created = await tx.testVersion.create({
        data: {
          specId,
          version: (latest?.version ?? 0) + 1,
          source: options.source ?? 'MANUAL',
          note: input.note ?? null,
          recordingId: options.recordingId ?? null,
        },
      });

      for (const [index, step] of input.steps.entries()) {
        await tx.testStep.create({
          data: stepData(created.id, index, step),
        });
      }

      await tx.testSpec.update({
        where: { id: specId },
        data: { currentVersionId: created.id },
      });

      return created;
    });

    return this.getVersion(version.id);
  }

  private async assertSpecExists(id: string): Promise<void> {
    const found = await this.prisma.testSpec.findUnique({
      where: { id },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundError('Test specification', id);
    }
  }
}

/** Shared by the spec editor and the compiler, so both store steps identically. */
export function stepData(
  versionId: string,
  index: number,
  step: DraftTestStep,
): {
  versionId: string;
  index: number;
  intent: string;
  action: string;
  targetDescription: string | null;
  targetHints: string;
  data: string | null;
  expectation: string;
  optional: boolean;
} {
  return {
    versionId,
    // Index is assigned from position, so reordering in the editor cannot
    // produce gaps or collisions.
    index,
    intent: step.intent,
    action: step.action,
    targetDescription: step.targetDescription,
    targetHints: stringifyJson(
      targetHintsSchema,
      step.targetHints,
      'TestStep.targetHints',
    ),
    data:
      step.data === null
        ? null
        : stringifyJson(stepDataSchema, step.data, 'TestStep.data'),
    expectation: stringifyJson(
      expectationSchema,
      step.expectation,
      'TestStep.expectation',
    ),
    optional: step.optional,
  };
}
