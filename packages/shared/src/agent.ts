import { z } from 'zod';
import { diagnosisSchema } from './enums';
import { targetHintsSchema } from './shapes';

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

/**
 * Why a step failed.
 *
 * The classes are not decoration — they decide what happens next. `TEST_DRIFT`
 * is the only one that reaches the healer; `APP_BUG` files a report and is never
 * healed over. Getting this wrong in the permissive direction produces a tool
 * that reports green while the application is broken, so `UNKNOWN` is a first
 * class answer and routes to a human.
 */
export const diagnosisResultSchema = z.object({
  diagnosis: diagnosisSchema,
  confidence: z.number().min(0).max(1),
  /** Must cite the observation it rests on, not restate the class. */
  rationale: z.string().min(1),
});
export type DiagnosisResult = z.infer<typeof diagnosisResultSchema>;

/**
 * What the model is allowed to conclude.
 *
 * `FLAKE` is absent by construction rather than by instruction. It is the one
 * class that cannot be judged from a single failure — it means "this passes
 * sometimes", and the only evidence for it is a retry that actually passed. A
 * model offered the option will reach for it whenever a failure looks
 * timing-shaped, and a QA tool able to explain away its own failures is worth
 * nothing. The runner concludes `FLAKE` from a retry, or not at all.
 */
export const modelDiagnosisSchema = diagnosisResultSchema.extend({
  diagnosis: diagnosisSchema.exclude(['FLAKE']),
});
export type ModelDiagnosis = z.infer<typeof modelDiagnosisSchema>;

/**
 * A proposed repair to a step's targeting.
 *
 * The healer's output vocabulary is deliberately wider than the resolver's: it
 * may set a `landmark` to disambiguate, where the resolver's LLM rung can only
 * answer with a role and a name and must therefore refuse a target that appears
 * twice. That is the class of failure the healer exists to fix.
 *
 * `found: false` is the honest answer when the target is genuinely gone — a
 * field that moved behind a new page is a change no re-target can express, and
 * proposing the nearest plausible control there would heal over a real problem.
 */
export const healProposalSchema = z.object({
  found: z.boolean(),
  /**
   * Null when `found` is false. Otherwise the corrected hints, which are run
   * back through the resolver before anything is written down.
   */
  targetHints: targetHintsSchema.nullable(),
  /** How the target should be described in the repaired specification. */
  targetDescription: z.string().min(1).nullable(),
  rationale: z.string().min(1),
});
export type HealProposal = z.infer<typeof healProposalSchema>;

/**
 * The prose around a bug report — and only the prose.
 *
 * Two fields are conspicuously absent. **Reproduction steps** are taken from the
 * steps that actually executed, because a model asked to recall a sequence it
 * was told about produces something plausible rather than something true, and a
 * reproduction that does not reproduce is worse than none. **Severity** is
 * computed from the evidence, because a model grading its own findings grades on
 * how alarming they read, and a field where everything is HIGH carries no
 * information at all.
 */
export const bugNarrativeSchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
});
export type BugNarrative = z.infer<typeof bugNarrativeSchema>;
