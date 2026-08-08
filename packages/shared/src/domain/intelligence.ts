import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../primitives';
import {
  bugStatusSchema,
  diagnosisSchema,
  healingStatusSchema,
  knowledgeKindSchema,
  severitySchema,
  stepStatusSchema,
} from '../enums';
import { knowledgeValueSchema, reproStepsSchema, targetHintsSchema } from '../shapes';
import { reportDocumentSchema } from '../report';

/** Knowledge, healing, bugs, and the LLM audit trail. */

export const knowledgeItemSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  kind: knowledgeKindSchema,
  /** Stable lookup key, e.g. `login.submit`. */
  key: z.string().min(1),
  value: knowledgeValueSchema,
  /**
   * Rises on a hit, decays on a miss and with age. Entries below the floor stop
   * being injected into prompts and stop being trusted at ladder rung 1 — stale
   * knowledge is worse than none, because it sends the resolver confidently at
   * the wrong element.
   */
  confidence: z.number().min(0).max(1),
  hitCount: z.number().int().min(0),
  missCount: z.number().int().min(0),
  lastSeenAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

export const healingRecordSchema = z.object({
  id: idSchema,
  executionStepId: idSchema,
  /** The version that drifted. */
  specVersionId: idSchema,
  diagnosis: diagnosisSchema,
  originalTarget: targetHintsSchema,
  proposedTarget: targetHintsSchema,
  /** Null leaves the step's existing description alone. */
  proposedDescription: z.string().nullable(),
  rationale: z.string().min(1),
  status: healingStatusSchema,
  /** Result of the in-run reverify. A heal that cannot prove itself is not applied. */
  reverifyStatus: stepStatusSchema.nullable(),
  /** The new version that approval produced. */
  appliedToVersionId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.nullable(),
});
export type HealingRecord = z.infer<typeof healingRecordSchema>;

/**
 * A queued heal, with enough around it to decide on without opening the run.
 *
 * A reviewer who has to go and reconstruct what the step was, which spec it
 * belongs to, and what the page looked like will approve on trust instead of on
 * evidence — which defeats the point of asking them.
 */
export const healingRecordWithContextSchema = healingRecordSchema.extend({
  applicationId: idSchema,
  specId: idSchema,
  specName: z.string(),
  /** The version number that drifted, as shown in the spec's history. */
  specVersion: z.number().int().min(1),
  executionId: idSchema,
  stepIndex: z.number().int().min(0),
  stepIntent: z.string(),
  /** Null when the heal was proposed for a step that had no spec step behind it. */
  stepId: idSchema.nullable(),
  /** Evidence relative paths — the page at failure, and after the heal. */
  beforeShotPath: z.string().nullable(),
  afterShotPath: z.string().nullable(),
});
export type HealingRecordWithContext = z.infer<
  typeof healingRecordWithContextSchema
>;

export const bugReportSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  executionStepId: idSchema.nullable(),
  title: z.string().min(1).max(300),
  severity: severitySchema,
  summary: z.string().min(1),
  /** Taken from the steps that actually executed, not from the model's recollection. */
  reproSteps: reproStepsSchema,
  expected: z.string().min(1),
  actual: z.string().min(1),
  /** Artifact ids. */
  evidenceRefs: z.array(idSchema),
  status: bugStatusSchema,
  /**
   * Deterministic identity of the defect — the spec, the step, and the signal.
   * Two runs hitting the same 500 on the same step share one, which is what
   * makes a recurrence update the open report instead of filing a twin.
   */
  fingerprint: z.string().min(1),
  /** Raised on each recurrence. One bug seen thirty times, not thirty bugs. */
  occurrences: z.number().int().min(1),
  lastSeenAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type BugReport = z.infer<typeof bugReportSchema>;

/** A bug report with the run behind it, so the view needs no second lookup. */
export const bugReportWithContextSchema = bugReportSchema.extend({
  applicationId: idSchema,
  applicationName: z.string(),
  specId: idSchema,
  specName: z.string(),
  /** Evidence relative paths, resolved from `evidenceRefs`. */
  evidencePaths: z.array(z.string()),
});
export type BugReportWithContext = z.infer<typeof bugReportWithContextSchema>;

/**
 * One model call. Enough detail to reconstruct, after the fact, which prompt
 * version produced which decision in a run.
 */
export const llmCallSchema = z.object({
  id: idSchema,
  executionId: idSchema.nullable(),
  recordingId: idSchema.nullable(),
  promptId: z.string().min(1),
  promptVersion: z.number().int().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  costUsd: z.number().min(0).nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type LlmCall = z.infer<typeof llmCallSchema>;

export const reportSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  markdown: z.string(),
  json: reportDocumentSchema,
  createdAt: isoDateTimeSchema,
});
export type Report = z.infer<typeof reportSchema>;
