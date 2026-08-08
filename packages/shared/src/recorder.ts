import { z } from 'zod';
import { recordedEventTypeSchema } from './enums';
import { bboxSchema, selectorCandidateSchema } from './shapes';

/**
 * The raw payload the in-page capture script emits, before the server enriches
 * it with an accessibility snapshot and a screenshot.
 *
 * Parsed at the boundary like everything else: the capture script runs inside
 * the page under test, which is hostile territory — a site can call the exposed
 * binding with whatever it likes.
 */
export const capturedEventSchema = z.object({
  type: recordedEventTypeSchema,
  url: z.string(),
  /** Epoch milliseconds, from the page's clock. */
  timestamp: z.number(),
  value: z.string().optional(),
  targetRole: z.string().optional(),
  targetName: z.string().optional(),
  targetText: z.string().optional(),
  targetTestId: z.string().optional(),
  landmark: z.string().optional(),
  bbox: bboxSchema.optional(),
  selectorCandidates: z.array(selectorCandidateSchema).default([]),
  /**
   * Set when the value came from a password field. The server drops the value
   * rather than storing it — a recorded password would otherwise sit in the
   * database and in every prompt built from this recording.
   */
  isSecret: z.boolean().default(false),
});
export type CapturedEvent = z.infer<typeof capturedEventSchema>;
