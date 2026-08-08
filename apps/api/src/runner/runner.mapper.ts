import {
  actionTypeSchema,
  diagnosisSchema,
  executionModeSchema,
  executionStatusSchema,
  observationKindSchema,
  observationPayloadSchema,
  parseJson,
  resolutionStrategySchema,
  stepStatusSchema,
  artifactKindSchema,
  type Artifact,
  type Execution,
  type ExecutionStep,
  type Observation,
} from '@agentx/shared';
import type {
  Artifact as ArtifactRow,
  Execution as ExecutionRow,
  ExecutionStep as ExecutionStepRow,
  Observation as ObservationRow,
} from '../generated/prisma/client';
import { toIso, toIsoOrNull } from '../common/mappers';

export function toExecutionStep(row: ExecutionStepRow): ExecutionStep {
  return {
    id: row.id,
    executionId: row.executionId,
    stepId: row.stepId,
    index: row.index,
    intent: row.intent,
    action: actionTypeSchema.parse(row.action),
    status: stepStatusSchema.parse(row.status),
    resolutionStrategy:
      row.resolutionStrategy === null
        ? null
        : resolutionStrategySchema.parse(row.resolutionStrategy),
    resolvedSelector: row.resolvedSelector,
    candidateCount: row.candidateCount,
    confidence: row.confidence,
    attempts: row.attempts,
    startedAt: toIsoOrNull(row.startedAt),
    finishedAt: toIsoOrNull(row.finishedAt),
    durationMs: row.durationMs,
    verifierRationale: row.verifierRationale,
    error: row.error,
    diagnosis:
      row.diagnosis === null ? null : diagnosisSchema.parse(row.diagnosis),
    diagnosisRationale: row.diagnosisRationale,
  };
}

export function toObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    executionStepId: row.executionStepId,
    kind: observationKindSchema.parse(row.kind),
    payload: parseJson(
      observationPayloadSchema,
      row.payload,
      `Observation.payload#${row.id}`,
    ),
    artifactId: row.artifactId,
    createdAt: toIso(row.createdAt),
  };
}

export function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    executionId: row.executionId,
    recordingId: row.recordingId,
    executionStepId: row.executionStepId,
    kind: artifactKindSchema.parse(row.kind),
    relPath: row.relPath,
    bytes: row.bytes,
    createdAt: toIso(row.createdAt),
  };
}

export function toExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    specId: row.specId,
    versionId: row.versionId,
    environmentId: row.environmentId,
    mode: executionModeSchema.parse(row.mode),
    status: executionStatusSchema.parse(row.status),
    startedAt: toIso(row.startedAt),
    finishedAt: toIsoOrNull(row.finishedAt),
    cancelRequested: row.cancelRequested,
    summary: row.summary,
    error: row.error,
  };
}
