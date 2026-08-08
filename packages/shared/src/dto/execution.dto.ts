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

export const listExecutionsQuerySchema = paginationQuerySchema.extend({
  specId: z.string().min(1).optional(),
  environmentId: z.string().min(1).optional(),
});
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;
