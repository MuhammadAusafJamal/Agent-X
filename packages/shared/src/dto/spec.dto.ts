import { z } from 'zod';
import { draftTestStepSchema } from '../domain/spec';
import { paginationQuerySchema } from '../api';

/**
 * Saving a specification always writes a **new version** — there is no update.
 * That is what makes an automated change to a test auditable: you can always
 * see what the agent changed, and go back to the version a human recorded.
 */
export const saveVersionSchema = z.object({
  /** e.g. "reordered steps", "healed: login button renamed". */
  note: z.string().max(500).nullish(),
  steps: z.array(draftTestStepSchema).min(1),
});
export type SaveVersionInput = z.infer<typeof saveVersionSchema>;

export const listSpecsQuerySchema = paginationQuerySchema.extend({
  applicationId: z.string().min(1).optional(),
});
export type ListSpecsQuery = z.infer<typeof listSpecsQuerySchema>;
