import {
  bugStatusSchema,
  evidenceRefsSchema,
  parseJson,
  reproStepsSchema,
  severitySchema,
  type BugReport,
} from '@agentx/shared';
import type { BugReport as BugReportRow } from '../generated/prisma/client';
import { toIso } from '../common/mappers';

export function toBugReport(row: BugReportRow): BugReport {
  return {
    id: row.id,
    executionId: row.executionId,
    executionStepId: row.executionStepId,
    title: row.title,
    severity: severitySchema.parse(row.severity),
    summary: row.summary,
    reproSteps: parseJson(
      reproStepsSchema,
      row.reproSteps,
      `BugReport.reproSteps#${row.id}`,
    ),
    expected: row.expected,
    actual: row.actual,
    evidenceRefs: parseJson(
      evidenceRefsSchema,
      row.evidenceRefs,
      `BugReport.evidenceRefs#${row.id}`,
    ),
    status: bugStatusSchema.parse(row.status),
    fingerprint: row.fingerprint,
    occurrences: row.occurrences,
    lastSeenAt: toIso(row.lastSeenAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
