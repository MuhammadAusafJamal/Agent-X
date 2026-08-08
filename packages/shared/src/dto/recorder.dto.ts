import { z } from 'zod';
import { urlSchema } from '../primitives';
import { paginationQuerySchema } from '../api';

export const startRecordingSchema = z.object({
  applicationId: z.string().min(1),
  environmentId: z.string().min(1).nullish(),
  /** Where the headed browser opens. */
  startUrl: urlSchema,
});
export type StartRecordingInput = z.infer<typeof startRecordingSchema>;

export const listRecordingsQuerySchema = paginationQuerySchema.extend({
  applicationId: z.string().min(1).optional(),
});
export type ListRecordingsQuery = z.infer<typeof listRecordingsQuerySchema>;
