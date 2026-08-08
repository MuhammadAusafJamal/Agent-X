import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../primitives';
import { recordedEventTypeSchema, recordingStatusSchema } from '../enums';
import { bboxSchema, selectorCandidateSchema } from '../shapes';

/**
 * What the recorder captures.
 *
 * The fields that matter here are `targetRole`, `targetName`, `targetText`, and
 * `landmark` — the way a human would describe the control. Selector candidates
 * are recorded too, but as fallbacks. A recorder that captured only selectors
 * would be `playwright codegen`, and the specs compiled from it would break the
 * first time a class name changed.
 */

export const recordedEventSchema = z.object({
  id: idSchema,
  recordingId: idSchema,
  index: z.number().int().min(0),
  type: recordedEventTypeSchema,
  url: z.string(),
  timestamp: isoDateTimeSchema,
  /** Typed text or selected option. Redacted when it came from a credential field. */
  value: z.string().nullable(),
  targetRole: z.string().nullable(),
  targetName: z.string().nullable(),
  targetText: z.string().nullable(),
  targetTestId: z.string().nullable(),
  landmark: z.string().nullable(),
  bbox: bboxSchema.nullable(),
  selectorCandidates: z.array(selectorCandidateSchema),
  /** Artifact relative paths. */
  a11yRef: z.string().nullable(),
  screenshotRef: z.string().nullable(),
});
export type RecordedEvent = z.infer<typeof recordedEventSchema>;

export const recordingSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  environmentId: idSchema.nullable(),
  startUrl: z.string(),
  status: recordingStatusSchema,
  startedAt: isoDateTimeSchema,
  stoppedAt: isoDateTimeSchema.nullable(),
  error: z.string().nullable(),
  eventCount: z.number().int().min(0).optional(),
});
export type Recording = z.infer<typeof recordingSchema>;

export const recordingWithEventsSchema = recordingSchema.extend({
  events: z.array(recordedEventSchema),
});
export type RecordingWithEvents = z.infer<typeof recordingWithEventsSchema>;
