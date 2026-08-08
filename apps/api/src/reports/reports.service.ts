import { Injectable, Logger } from '@nestjs/common';
import {
  actionTypeSchema,
  bugStatusSchema,
  diagnosisSchema,
  executionStatusSchema,
  healingStatusSchema,
  parseJson,
  reportDocumentSchema,
  reproStepsSchema,
  resolutionStrategySchema,
  severitySchema,
  stepStatusSchema,
  stringifyJson,
  targetHintsSchema,
  type Report,
  type ReportDocument,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toIso, toIsoOrNull } from '../common/mappers';
import { buildReport, renderMarkdown } from './build-report';

/**
 * Turns a finished run into something readable without the dashboard.
 *
 * Generation is **idempotent and free** — no model call, no browser — so it is
 * safe to run at the end of every execution and safe to run again. The stored
 * row is a cache of a pure function over rows that no longer change.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The stored report, generated on first request. */
  async get(executionId: string): Promise<Report> {
    const existing = await this.prisma.report.findUnique({
      where: { executionId },
    });

    if (existing !== null) {
      return {
        id: existing.id,
        executionId: existing.executionId,
        markdown: existing.markdown,
        json: parseJson(
          reportDocumentSchema,
          existing.json,
          `Report.json#${existing.id}`,
        ),
        createdAt: toIso(existing.createdAt),
      };
    }

    return this.generate(executionId);
  }

  async generate(executionId: string): Promise<Report> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        spec: { select: { name: true } },
        version: { select: { version: true } },
        environment: { select: { name: true } },
        llmCalls: true,
        artifacts: true,
        bugs: true,
        steps: {
          orderBy: { index: 'asc' },
          include: { healings: true },
        },
      },
    });

    if (execution === null) throw new NotFoundError('Execution', executionId);

    const finishedAt = execution.finishedAt;

    const document = buildReport({
      run: {
        executionId: execution.id,
        specId: execution.specId,
        versionId: execution.versionId,
        specVersion: execution.version.version,
        startedAt: toIso(execution.startedAt),
        finishedAt: toIsoOrNull(finishedAt),
        durationMs:
          finishedAt === null
            ? null
            : finishedAt.getTime() - execution.startedAt.getTime(),
        evidenceBase: execution.id,
        llmCallCount: execution.llmCalls.length,
        inputTokens: sum(execution.llmCalls.map((call) => call.inputTokens)),
        outputTokens: sum(execution.llmCalls.map((call) => call.outputTokens)),
        costUsd: execution.llmCalls.every((call) => call.costUsd === null)
          ? null
          : sum(execution.llmCalls.map((call) => call.costUsd ?? 0)),
      },
      specName: execution.spec.name,
      environmentName: execution.environment.name,
      status: executionStatusSchema.parse(execution.status),
      steps: execution.steps.map((step) => ({
        index: step.index,
        intent: step.intent,
        action: actionTypeSchema.parse(step.action),
        status: stepStatusSchema.parse(step.status),
        resolutionStrategy:
          step.resolutionStrategy === null
            ? null
            : resolutionStrategySchema.parse(step.resolutionStrategy),
        resolvedSelector: step.resolvedSelector,
        candidateCount: step.candidateCount,
        confidence: step.confidence,
        verifierRationale: step.verifierRationale,
        error: step.error,
        diagnosis:
          step.diagnosis === null
            ? null
            : diagnosisSchema.parse(step.diagnosis),
        diagnosisRationale: step.diagnosisRationale,
        evidence: execution.artifacts
          .filter((artifact) => artifact.executionStepId === step.id)
          .map((artifact) => artifact.relPath),
      })),
      healings: execution.steps.flatMap((step) =>
        step.healings.map((healing) => ({
          stepIndex: step.index,
          status: healingStatusSchema.parse(healing.status),
          reverifyStatus:
            healing.reverifyStatus === null
              ? null
              : stepStatusSchema.parse(healing.reverifyStatus),
          from: parseJson(
            targetHintsSchema,
            healing.originalTarget,
            `HealingRecord.originalTarget#${healing.id}`,
          ),
          to: parseJson(
            targetHintsSchema,
            healing.proposedTarget,
            `HealingRecord.proposedTarget#${healing.id}`,
          ),
          rationale: healing.rationale,
        })),
      ),
      bugs: execution.bugs
        // A dismissed defect is a decision someone made; a report of the run
        // that found it should still say it was found.
        .filter((bug) => bugStatusSchema.parse(bug.status) !== 'DISMISSED')
        .map((bug) => ({
          stepIndex:
            execution.steps.find((step) => step.id === bug.executionStepId)
              ?.index ?? null,
          severity: severitySchema.parse(bug.severity),
          title: bug.title,
          summary: bug.summary,
          expected: bug.expected,
          actual: bug.actual,
          reproSteps: parseJson(
            reproStepsSchema,
            bug.reproSteps,
            `BugReport.reproSteps#${bug.id}`,
          ),
        })),
    });

    return this.store(executionId, document);
  }

  private async store(
    executionId: string,
    document: ReportDocument,
  ): Promise<Report> {
    const markdown = renderMarkdown(document);
    const json = stringifyJson(reportDocumentSchema, document, 'Report.json');

    const row = await this.prisma.report.upsert({
      where: { executionId },
      create: { executionId, markdown, json },
      update: { markdown, json },
    });

    return {
      id: row.id,
      executionId: row.executionId,
      markdown,
      json: document,
      createdAt: toIso(row.createdAt),
    };
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
