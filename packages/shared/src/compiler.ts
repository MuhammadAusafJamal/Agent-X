import { z } from 'zod';
import { actionTypeSchema } from './enums';
import { expectationSchema } from './shapes';

/**
 * What the intent compiler asks the model for.
 *
 * The model does **not** invent selectors. It maps each step it produces back
 * to the index of the recorded event that caused it, and the server attaches
 * the real captured `targetHints` from that event. A model asked to produce
 * selectors will cheerfully produce plausible ones that never existed; this
 * shape makes that impossible rather than merely discouraged.
 */

export const compiledStepDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }),
  z.object({ kind: z.literal('LITERAL'), value: z.string() }),
  /** For anything secret: the name of an environment variable, never a value. */
  z.object({ kind: z.literal('ENV_REF'), envVar: z.string().min(1) }),
]);

export const compiledStepSchema = z.object({
  /**
   * Index of the recorded event this step came from, or null for a step the
   * model inferred (a check the human performed by looking, not clicking).
   */
  sourceEventIndex: z.number().int().min(0).nullable(),
  /** Human-readable: "sign in as the seeded user". Never a selector. */
  intent: z.string().min(1),
  action: actionTypeSchema,
  /** Natural language: "the primary submit button in the login form". */
  targetDescription: z.string().nullable(),
  data: compiledStepDataSchema,
  expectation: expectationSchema,
  optional: z.boolean(),
});
export type CompiledStep = z.infer<typeof compiledStepSchema>;

export const compiledSpecSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  steps: z.array(compiledStepSchema).min(1),
});
export type CompiledSpec = z.infer<typeof compiledSpecSchema>;
