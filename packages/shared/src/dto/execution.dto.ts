import { z } from 'zod';
import { executionModeSchema } from '../enums';
import { paginationQuerySchema } from '../api';

export const startExecutionSchema = z.object({
  /** The exact version to run. Omit to run the spec's current version. */
  specId: z.string().min(1),
  versionId: z.string().min(1).nullish(),
  environmentId: z.string().min(1),
  mode: executionModeSchema.default('REPLAY'),
});
export type StartExecutionInput = z.infer<typeof startExecutionSchema>;

/**
 * A human settling an `UNCERTAIN` step.
 *
 * Only those two outcomes: adjudication exists to resolve a question the
 * verifier could not, so re-marking something as uncertain is not a move.
 */
export const adjudicateStepSchema = z.object({
  status: z.enum(['PASS', 'FAIL']),
  note: z.string().max(500).nullish(),
});
export type AdjudicateStepInput = z.infer<typeof adjudicateStepSchema>;

export const listExecutionsQuerySchema = paginationQuerySchema.extend({
  specId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;
