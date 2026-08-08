import { Injectable } from '@nestjs/common';
import type {
  BugReportWithContext,
  ListBugsQuery,
  Paginated,
  UpdateBugInput,
} from '@agentx/shared';
import type { BugReport as BugReportRow } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toBugReport } from './bugs.mapper';

/** What every read needs joined on: the run, its spec, and its application. */
const WITH_CONTEXT = {
  execution: {
    include: {
      spec: { include: { application: { select: { id: true, name: true } } } },
    },
  },
} as const;

type BugRowWithContext = BugReportRow & {
  execution: {
    specId: string;
    spec: { name: string; application: { id: string; name: string } };
  };
};

@Injectable()
export class BugsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListBugsQuery): Promise<Paginated<BugReportWithContext>> {
    const where = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.executionId === undefined
        ? {}
        : { executionId: query.executionId }),
      ...(query.applicationId === undefined
        ? {}
        : { execution: { spec: { applicationId: query.applicationId } } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bugReport.findMany({
        where,
        // Open first, then whatever is still happening most recently — the
        // order someone triaging would ask for.
        orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
        take: query.limit,
        skip: query.offset,
        include: WITH_CONTEXT,
      }),
      this.prisma.bugReport.count({ where }),
    ]);

    const items = await Promise.all(rows.map((row) => this.withContext(row)));

    return { items, total, limit: query.limit, offset: query.offset };
  }

  async get(id: string): Promise<BugReportWithContext> {
    const row = await this.prisma.bugReport.findUnique({
      where: { id },
      include: WITH_CONTEXT,
    });

    if (row === null) throw new NotFoundError('Bug report', id);

    return this.withContext(row);
  }

  async update(
    id: string,
    input: UpdateBugInput,
  ): Promise<BugReportWithContext> {
    const existing = await this.prisma.bugReport.findUnique({
      where: { id },
      select: { id: true },
    });

    if (existing === null) throw new NotFoundError('Bug report', id);

    await this.prisma.bugReport.update({
      where: { id },
      data: { status: input.status },
    });

    return this.get(id);
  }

  /**
   * Resolves the evidence ids the report was filed with into paths the
   * dashboard can link to.
   *
   * Missing artifacts are dropped rather than surfaced as broken links: a report
   * outlives the run that produced it, and evidence gets pruned.
   */
  private async withContext(
    row: BugRowWithContext,
  ): Promise<BugReportWithContext> {
    const bug = toBugReport(row);

    const artifacts =
      bug.evidenceRefs.length === 0
        ? []
        : await this.prisma.artifact.findMany({
            where: { id: { in: bug.evidenceRefs } },
            select: { relPath: true },
            orderBy: { relPath: 'asc' },
          });

    return {
      ...bug,
      applicationId: row.execution.spec.application.id,
      applicationName: row.execution.spec.application.name,
      specId: row.execution.specId,
      specName: row.execution.spec.name,
      evidencePaths: artifacts.map((artifact) => artifact.relPath),
    };
  }
}
