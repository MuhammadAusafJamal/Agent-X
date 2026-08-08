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
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type BugReport = z.infer<typeof bugReportSchema>;

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
  /** Machine-readable summary. Shape firms up in E7.1. */
  json: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
});
export type Report = z.infer<typeof reportSchema>;
