import { z } from 'zod';

/**
 * Maintenance operations. Currently one, and it deletes everything.
 */

/**
 * The exact phrase a caller must send to wipe the database.
 *
 * A boolean would be satisfied by `{"confirm":true}`, which is what a stray
 * fetch in a dashboard, a replayed request, or a curl from shell history all
 * look like. A phrase this specific cannot be arrived at by accident, and it
 * reads as a sentence in the request body of whoever has to review the call
 * later.
 */
export const RESET_CONFIRMATION = 'DELETE ALL DATA' as const;

export const resetDataSchema = z.object({
  confirm: z.literal(RESET_CONFIRMATION, {
    error: `must be exactly "${RESET_CONFIRMATION}" — this deletes every row in the database`,
  }),
  /**
   * Also empty the evidence tree on disk.
   *
   * On by default because the two halves are one thing: screenshots, traces, and
   * videos are reachable only through `Artifact` rows, so clearing the database
   * without them leaves gigabytes that nothing can ever reference again.
   */
  evidence: z.boolean().default(true),
  /**
   * Proceed even though something is mid-flight.
   *
   * A reset while a run or a check is executing leaves that work writing rows
   * into a database that no longer has the parents they point at. Refused by
   * default; this is the escape hatch for a queue stranded by a process that is
   * already gone.
   */
  force: z.boolean().default(false),
});
export type ResetDataInput = z.infer<typeof resetDataSchema>;

export const resetDataResultSchema = z.object({
  /** Rows deleted per table, largest first. Tables that were already empty are omitted. */
  deleted: z.record(z.string(), z.number().int()),
  rowsDeleted: z.number().int(),
  tablesCleared: z.number().int(),
  /** Null when `evidence` was false. */
  evidenceRemoved: z.boolean().nullable(),
  /** What the schema still has, proving the tables were emptied rather than dropped. */
  tablesRemaining: z.number().int(),
});
export type ResetDataResult = z.infer<typeof resetDataResultSchema>;
