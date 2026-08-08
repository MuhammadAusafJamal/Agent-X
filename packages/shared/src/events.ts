import { z } from 'zod';
import { idSchema } from './primitives';
import { executionStatusSchema, observationKindSchema } from './enums';
import { recordedEventSchema } from './domain/recording';
import { executionStepSchema } from './domain/execution';
import { healingRecordSchema } from './domain/intelligence';

/**
 * The SSE payloads.
 *
 * Server→client only, which is why this is SSE and not a socket. The dashboard's
 * `useEventStream` hook parses every frame through these schemas, so a
 * server-side shape change surfaces as a validation error naming the field
 * rather than as a component rendering `undefined`.
 */

export const recordingStartedEventSchema = z.object({
  type: z.literal('recording.started'),
  recordingId: idSchema,
  startUrl: z.string(),
});

export const recordingEventEventSchema = z.object({
  type: z.literal('recording.event'),
  event: recordedEventSchema,
});

export const recordingStoppedEventSchema = z.object({
  type: z.literal('recording.stopped'),
  recordingId: idSchema,
  eventCount: z.number().int().min(0),
});

export const recordingErrorEventSchema = z.object({
  type: z.literal('recording.error'),
  recordingId: idSchema.nullable(),
  message: z.string(),
});

export const executionStartedEventSchema = z.object({
  type: z.literal('execution.started'),
  executionId: idSchema,
  stepCount: z.number().int().min(0),
});

export const executionStepEventSchema = z.object({
  type: z.literal('execution.step'),
  step: executionStepSchema,
});

export const executionObservationEventSchema = z.object({
  type: z.literal('execution.observation'),
  executionStepId: idSchema,
  kind: observationKindSchema,
  artifactId: idSchema.nullable(),
});

export const executionHealingEventSchema = z.object({
  type: z.literal('execution.healing'),
  healing: healingRecordSchema,
});

export const executionFinishedEventSchema = z.object({
  type: z.literal('execution.finished'),
  executionId: idSchema,
  status: executionStatusSchema,
  summary: z.string().nullable(),
});

export const executionErrorEventSchema = z.object({
  type: z.literal('execution.error'),
  executionId: idSchema.nullable(),
  message: z.string(),
});

export const recordingSseEventSchema = z.discriminatedUnion('type', [
  recordingStartedEventSchema,
  recordingEventEventSchema,
  recordingStoppedEventSchema,
  recordingErrorEventSchema,
]);
export type RecordingSseEvent = z.infer<typeof recordingSseEventSchema>;

export const executionSseEventSchema = z.discriminatedUnion('type', [
  executionStartedEventSchema,
  executionStepEventSchema,
  executionObservationEventSchema,
  executionHealingEventSchema,
  executionFinishedEventSchema,
  executionErrorEventSchema,
]);
export type ExecutionSseEvent = z.infer<typeof executionSseEventSchema>;

export const agentXEventSchema = z.discriminatedUnion('type', [
  recordingStartedEventSchema,
  recordingEventEventSchema,
  recordingStoppedEventSchema,
  recordingErrorEventSchema,
  executionStartedEventSchema,
  executionStepEventSchema,
  executionObservationEventSchema,
  executionHealingEventSchema,
  executionFinishedEventSchema,
  executionErrorEventSchema,
]);
export type AgentXEvent = z.infer<typeof agentXEventSchema>;
export type AgentXEventType = AgentXEvent['type'];

/** Terminal events — the hook closes the stream when one arrives. */
export const TERMINAL_EVENT_TYPES: readonly AgentXEventType[] = [
  'recording.stopped',
  'recording.error',
  'execution.finished',
  'execution.error',
] as const;
