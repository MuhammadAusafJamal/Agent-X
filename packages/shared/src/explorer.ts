import { z } from 'zod';
import { idSchema } from './primitives';
import { urlSchema } from './primitives';

/**
 * The explorer: the one component that acts on an application without a human
 * having scripted what it does.
 *
 * Everything that constrains it — the step budget, the origin allowlist, the
 * destructive-control denylist — lives in code rather than in these shapes or in
 * a prompt. A model told not to click "Delete account" will eventually click
 * "Delete account"; a check that refuses to hand it that element will not.
 */

/** One turn: what the explorer wants to do next. */
export const exploreActionSchema = z.object({
  /** Why this move, given the goal. Recorded so a trail can be read back. */
  reasoning: z.string().min(1),
  action: z.enum(['CLICK', 'FILL', 'NAVIGATE', 'DONE']),
  /**
   * The control to act on, named the way the snapshot names it. Null for
   * `NAVIGATE` and `DONE`.
   *
   * As everywhere else in this system, the model names a control and the server
   * does the finding — so an invented element fails a turn instead of steering a
   * click.
   */
  role: z.string().nullable(),
  name: z.string().nullable(),
  /** Text to type, or the URL to open. Null otherwise. */
  value: z.string().nullable(),
  /** What this achieved, in the words a test step would use. */
  intent: z.string().nullable(),
});
export type ExploreAction = z.infer<typeof exploreActionSchema>;

/** The write-up of a finished exploration. */
export const exploreSummarySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  /** Named the way a person would describe the journey, for FLOW knowledge. */
  flowName: z.string().min(1).max(200),
});
export type ExploreSummary = z.infer<typeof exploreSummarySchema>;

export const startExplorationSchema = z.object({
  applicationId: idSchema,
  environmentId: idSchema,
  /** e.g. "find every path to checkout". */
  goal: z.string().min(1).max(500),
  /** Where to begin. Defaults to the environment's base URL. */
  startUrl: urlSchema.nullish(),
  /**
   * Hard ceilings, clamped server-side. Present so a demo can be made shorter,
   * never so it can be made unbounded.
   */
  maxSteps: z.coerce.number().int().min(1).max(40).default(12),
  maxDurationSeconds: z.coerce.number().int().min(10).max(300).default(90),
});
export type StartExplorationInput = z.infer<typeof startExplorationSchema>;

/** Why an exploration stopped. Always one of these — it never simply ends. */
export const exploreStopReasonSchema = z.enum([
  'GOAL_REACHED',
  'STEP_BUDGET',
  'TIME_BUDGET',
  'MODEL_BUDGET',
  'STUCK',
  'ERROR',
]);
export type ExploreStopReason = z.infer<typeof exploreStopReasonSchema>;

export const explorationResultSchema = z.object({
  goal: z.string(),
  stoppedBecause: exploreStopReasonSchema,
  /**
   * What actually went wrong, when the reason alone does not say.
   *
   * `ERROR` without this is indistinguishable from an exploration that simply
   * ended: the model call failed, the reason was swallowed, and the caller was
   * left with a one-word verdict and nothing to act on.
   */
  stoppedDetail: z.string().nullable(),
  stepsTaken: z.number().int().min(0),
  /** URLs visited, in order, deduplicated. */
  visited: z.array(z.string()),
  /** What it did, in order — the trail the proposed specification came from. */
  trail: z.array(z.string()),
  /** Moves refused by a bound rather than by the application. */
  refused: z.array(z.string()),
  /** The proposed specification, if the trail was worth one. */
  proposedSpecId: idSchema.nullable(),
  proposedSpecName: z.string().nullable(),
});
export type ExplorationResult = z.infer<typeof explorationResultSchema>;
