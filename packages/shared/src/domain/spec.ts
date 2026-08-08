import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../primitives';
import { actionTypeSchema, specSourceSchema } from '../enums';
import { expectationSchema, stepDataSchema, targetHintsSchema } from '../shapes';

/**
 * Test specifications: what to do, expressed as intent.
 *
 * `TestVersion` is immutable. Editing a spec or approving a heal writes a new
 * version rather than mutating one, which is what makes an automated change to a
 * test auditable — you can always see what the agent changed and roll back to
 * the version a human recorded.
 */

export const testStepSchema = z.object({
  id: idSchema,
  versionId: idSchema,
  index: z.number().int().min(0),
  /** Human-readable: "sign in as the seeded user" — never a selector. */
  intent: z.string().min(1),
  action: actionTypeSchema,
  /** Natural language: "the primary submit button in the login form". */
  targetDescription: z.string().nullable(),
  targetHints: targetHintsSchema,
  data: stepDataSchema.nullable(),
  expectation: expectationSchema,
  /** A failure here does not fail the run, but is still surfaced. */
  optional: z.boolean(),
});
export type TestStep = z.infer<typeof testStepSchema>;

export const testVersionSchema = z.object({
  id: idSchema,
  specId: idSchema,
  version: z.number().int().min(1),
  source: specSourceSchema,
  /** e.g. "healed: login button renamed". */
  note: z.string().nullable(),
  recordingId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type TestVersion = z.infer<typeof testVersionSchema>;

export const testVersionWithStepsSchema = testVersionSchema.extend({
  steps: z.array(testStepSchema),
});
export type TestVersionWithSteps = z.infer<typeof testVersionWithStepsSchema>;

export const testSpecSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  source: specSourceSchema,
  currentVersionId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TestSpec = z.infer<typeof testSpecSchema>;

export const testSpecWithCurrentVersionSchema = testSpecSchema.extend({
  currentVersion: testVersionWithStepsSchema.nullable(),
});
export type TestSpecWithCurrentVersion = z.infer<typeof testSpecWithCurrentVersionSchema>;

/**
 * A step as the LLM compiler emits it — no ids yet, since nothing is persisted
 * until the whole compilation validates. Used for the E2.4 structured output.
 */
export const draftTestStepSchema = z.object({
  intent: z.string().min(1),
  action: actionTypeSchema,
  targetDescription: z.string().nullable(),
  targetHints: targetHintsSchema,
  data: stepDataSchema.nullable(),
  expectation: expectationSchema,
  optional: z.boolean().default(false),
});
export type DraftTestStep = z.infer<typeof draftTestStepSchema>;

export const draftTestSpecSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  steps: z.array(draftTestStepSchema).min(1),
});
export type DraftTestSpec = z.infer<typeof draftTestSpecSchema>;
