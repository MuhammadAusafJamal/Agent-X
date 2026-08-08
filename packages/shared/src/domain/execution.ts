import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../primitives';
import {
  actionTypeSchema,
  artifactKindSchema,
  diagnosisSchema,
  executionModeSchema,
  executionStatusSchema,
  observationKindSchema,
  resolutionStrategySchema,
  stepStatusSchema,
} from '../enums';
import { observationPayloadSchema } from '../shapes';

/** Runs, their steps, and the evidence they produce. */

export const artifactSchema = z.object({
  id: idSchema,
  executionId: idSchema.nullable(),
  recordingId: idSchema.nullable(),
  executionStepId: idSchema.nullable(),
  kind: artifactKindSchema,
  /** Relative to `EVIDENCE_DIR`, so the directory can be moved or zipped. */
  relPath: z.string().min(1),
  bytes: z.number().int().min(0).nullable(),
  createdAt: isoDateTimeSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const observationSchema = z.object({
  id: idSchema,
  executionStepId: idSchema,
  kind: observationKindSchema,
  payload: observationPayloadSchema,
  artifactId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Observation = z.infer<typeof observationSchema>;

export const executionStepSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  /** Null for steps an agent invented — explore mode, or a healed replacement. */
  stepId: idSchema.nullable(),
  index: z.number().int().min(0),
  /** Denormalized from the spec so a run reads standalone once the spec moves on. */
  intent: z.string(),
  action: actionTypeSchema,
  status: stepStatusSchema,
  /**
   * Which rung of the ladder won, and how ambiguous the lookup was.
   *
   * These are the feedback signal the intelligence layer reads — a target that
   * has needed the `LLM` rung three runs running has stale hints — not merely
   * diagnostics.
   */
  resolutionStrategy: resolutionStrategySchema.nullable(),
  resolvedSelector: z.string().nullable(),
  candidateCount: z.number().int().min(0).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  attempts: z.number().int().min(0),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  verifierRationale: z.string().nullable(),
  error: z.string().nullable(),
  /** Why it failed, when it did. Null on a step that never failed. */
  diagnosis: diagnosisSchema.nullable(),
  diagnosisRationale: z.string().nullable(),
});
export type ExecutionStep = z.infer<typeof executionStepSchema>;

export const executionStepWithObservationsSchema = executionStepSchema.extend({
  observations: z.array(observationSchema),
});
export type ExecutionStepWithObservations = z.infer<typeof executionStepWithObservationsSchema>;

export const executionSchema = z.object({
  id: idSchema,
  specId: idSchema,
  versionId: idSchema,
  environmentId: idSchema,
  mode: executionModeSchema,
  status: executionStatusSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  cancelRequested: z.boolean(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
});
export type Execution = z.infer<typeof executionSchema>;

/**
 * Aggregates over an execution's `LlmCall` rows. Computed on read rather than
 * denormalized onto `Execution`, so the totals cannot drift from the audit rows
 * they summarize.
 */
export const executionTotalsSchema = z.object({
  llmCallCount: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0).nullable(),
});
export type ExecutionTotals = z.infer<typeof executionTotalsSchema>;

export const executionDetailSchema = executionSchema.extend({
  steps: z.array(executionStepWithObservationsSchema),
  artifacts: z.array(artifactSchema),
  totals: executionTotalsSchema,
});
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;
