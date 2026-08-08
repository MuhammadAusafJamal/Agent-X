import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './primitives';
import {
  actionTypeSchema,
  diagnosisSchema,
  executionStatusSchema,
  healingStatusSchema,
  resolutionStrategySchema,
  severitySchema,
  stepStatusSchema,
} from './enums';

/**
 * A run, written down.
 *
 * The split between `run` and `body` is the whole design. **`body` is
 * deterministic**: run it twice against an unchanged application and the bytes
 * match, which is what makes a report diffable and therefore useful in review.
 * Everything that legitimately differs between two identical runs — the id, the
 * clock, how long it took, what it cost — lives in `run`, where nobody expects
 * it to be stable.
 *
 * Keeping that line honest means the body contains no cuids, no timestamps, no
 * durations, and no absolute paths. Evidence is referenced relative to the run's
 * own directory, which `run.evidenceBase` names.
 */

export const reportStepSchema = z.object({
  /** 1-based, as a reader would count them. */
  position: z.number().int().min(1),
  intent: z.string(),
  action: actionTypeSchema,
  status: stepStatusSchema,
  /** Which rung of the ladder won. Null for steps that need no target. */
  resolutionStrategy: resolutionStrategySchema.nullable(),
  resolvedSelector: z.string().nullable(),
  /** How ambiguous the lookup was before visibility narrowed it. */
  candidateCount: z.number().int().min(0).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  verifierRationale: z.string().nullable(),
  error: z.string().nullable(),
  diagnosis: diagnosisSchema.nullable(),
  diagnosisRationale: z.string().nullable(),
  /** Paths relative to the run's evidence directory, sorted. */
  evidence: z.array(z.string()),
});
export type ReportStep = z.infer<typeof reportStepSchema>;

export const reportHealingSchema = z.object({
  stepPosition: z.number().int().min(1),
  status: healingStatusSchema,
  reverifyStatus: stepStatusSchema.nullable(),
  /** Rendered as `role=… name=…`, so the diff reads as a change of targeting. */
  from: z.string(),
  to: z.string(),
  rationale: z.string(),
});
export type ReportHealing = z.infer<typeof reportHealingSchema>;

export const reportBugSchema = z.object({
  stepPosition: z.number().int().min(1).nullable(),
  severity: severitySchema,
  title: z.string(),
  summary: z.string(),
  expected: z.string(),
  actual: z.string(),
  reproSteps: z.array(z.string()),
});
export type ReportBug = z.infer<typeof reportBugSchema>;

/** The comparable half. Two runs of an unchanged application produce the same one. */
export const reportBodySchema = z.object({
  specName: z.string(),
  environmentName: z.string(),
  status: executionStatusSchema,
  counts: z.object({
    total: z.number().int().min(0),
    passed: z.number().int().min(0),
    failed: z.number().int().min(0),
    uncertain: z.number().int().min(0),
    healed: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  steps: z.array(reportStepSchema),
  healings: z.array(reportHealingSchema),
  bugs: z.array(reportBugSchema),
});
export type ReportBody = z.infer<typeof reportBodySchema>;

/** The half that is expected to differ, and is excluded from any comparison. */
export const reportRunSchema = z.object({
  executionId: idSchema,
  specId: idSchema,
  versionId: idSchema,
  specVersion: z.number().int().min(1),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  /** Every evidence path in the body is relative to this. */
  evidenceBase: z.string(),
  llmCallCount: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0).nullable(),
});
export type ReportRun = z.infer<typeof reportRunSchema>;

export const reportDocumentSchema = z.object({
  run: reportRunSchema,
  body: reportBodySchema,
});
export type ReportDocument = z.infer<typeof reportDocumentSchema>;

/**
 * Separates the volatile header from the comparable body in the Markdown.
 *
 * A marker rather than a convention: "compare everything after the third
 * heading" is the kind of rule that silently stops being true.
 */
export const REPORT_BODY_MARKER = '<!-- agent-x:body -->';

/** Everything after the marker — what two runs are expected to agree on. */
export function reportBodyOf(markdown: string): string {
  const at = markdown.indexOf(REPORT_BODY_MARKER);
  return at === -1
    ? markdown
    : markdown.slice(at + REPORT_BODY_MARKER.length).trimStart();
}
