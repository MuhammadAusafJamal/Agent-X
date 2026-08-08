import { z } from 'zod';
import { bugStatusSchema, healingStatusSchema } from '../enums';
import { paginationQuerySchema } from '../api';

/** Review queue and bug tracker request shapes. */

export const listHealingsQuerySchema = paginationQuerySchema.extend({
  applicationId: z.string().min(1).optional(),
  specId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  /** Defaults to the queue: what is still awaiting a decision. */
  status: healingStatusSchema.optional(),
});
export type ListHealingsQuery = z.infer<typeof listHealingsQuerySchema>;

/**
 * A human's decision on a proposed heal.
 *
 * Approving writes a **new** `TestVersion` with `source: HEALED`; it never edits
 * the version that drifted. Rejecting leaves the specification untouched, which
 * means the next run fails the same way — that is the point, not an oversight.
 */
export const reviewHealingSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  /** Appended to the new version's note when approving. */
  note: z.string().max(500).nullish(),
});
export type ReviewHealingInput = z.infer<typeof reviewHealingSchema>;

/**
 * Approving several heals from one run together.
 *
 * All of them land in a single new version. Approving them one at a time would
 * write one version per heal, and a run that healed four steps would leave three
 * versions nobody ever ran.
 */
export const reviewHealingsSchema = z.object({
  healingIds: z.array(z.string().min(1)).min(1).max(100),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).nullish(),
});
export type ReviewHealingsInput = z.infer<typeof reviewHealingsSchema>;

export const listBugsQuerySchema = paginationQuerySchema.extend({
  applicationId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  status: bugStatusSchema.optional(),
});
export type ListBugsQuery = z.infer<typeof listBugsQuerySchema>;

export const updateBugSchema = z.object({
  status: bugStatusSchema,
});
export type UpdateBugInput = z.infer<typeof updateBugSchema>;
