import { z } from 'zod';

/**
 * What the model returns when asked to find an element the deterministic ladder
 * could not.
 *
 * It answers with a **role and accessible name** — the way a person would name
 * the control — not a selector. The deterministic resolver then does the actual
 * finding, so the model's answer still has to survive the same "exactly one
 * visible, enabled element" rule as every other rung. A model that names
 * something ambiguous or imaginary fails the step rather than steering a click.
 */
export const elementChoiceSchema = z.object({
  /** False when the target genuinely is not on the page. */
  found: z.boolean(),
  role: z.string().nullable(),
  name: z.string().nullable(),
  rationale: z.string().min(1),
});
export type ElementChoice = z.infer<typeof elementChoiceSchema>;
