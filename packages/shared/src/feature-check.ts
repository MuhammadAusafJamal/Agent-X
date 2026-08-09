import { z } from 'zod';
import { idSchema, urlSchema } from './primitives';
import { expectationSchema } from './shapes';

/**
 * Feature checks: testing driven by criteria a human supplied, rather than by a
 * recording.
 *
 * The distinction this file exists to make is where the oracle comes from. A
 * recorded spec's expectations are inferred from what the page became after each
 * action, which makes the recording itself the definition of correct — record a
 * flow that computes the wrong total and the wrong total is green forever. A
 * feature check takes the criteria as **input**, so "correct" is something the
 * user asserted and the system can be wrong about.
 *
 * Everything that bounds the walk still lives in `bounds.ts` as code. Nothing
 * here is a safety control; these are shapes.
 */

/**
 * One acceptance criterion.
 *
 * Keyed rather than positional so a report can say "AC3 regressed" and mean the
 * same criterion it meant last week, even after the list is reordered.
 */
export const acceptanceCriterionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(24)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'A criterion key may contain only letters, digits, dots, underscores, and dashes.',
    ),
  text: z.string().min(1).max(500),
});
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

/** Why a case exists. Reported so a suite's shape is legible at a glance. */
export const testCaseKindSchema = z.enum(['HAPPY', 'NEGATIVE', 'BOUNDARY']);
export type TestCaseKind = z.infer<typeof testCaseKindSchema>;

/** Which cases a smoke run includes. */
export const casePrioritySchema = z.enum(['CRITICAL', 'NORMAL']);
export type CasePriority = z.infer<typeof casePrioritySchema>;

/**
 * One test case the planner proposed.
 *
 * `goal` is what the explorer walks towards, in the same vocabulary its existing
 * prompt already expects — so planning produces work the walk can already do,
 * rather than a second thing to interpret.
 */
export const plannedCaseSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().min(1).max(500),
  /** Criterion keys this case is meant to settle. Validated server-side. */
  coversCriteria: z.array(z.string().min(1)).default([]),
  kind: testCaseKindSchema,
  priority: casePrioritySchema,
});
export type PlannedCase = z.infer<typeof plannedCaseSchema>;

export const featureCasePlanSchema = z.object({
  cases: z.array(plannedCaseSchema).min(1),
});
export type FeatureCasePlan = z.infer<typeof featureCasePlanSchema>;

/**
 * What the expectation author returns for one realized case.
 *
 * Split into two lists because they answer different questions. `steps`
 * re-expresses what each move should have achieved; `assertions` are terminal
 * checks, one per criterion, and they are the part that makes the criteria
 * falsifiable. A case whose walk succeeded but whose assertions fail is exactly
 * the outcome this whole design exists to produce.
 */
export const authoredStepExpectationSchema = z.object({
  stepIndex: z.number().int().min(0),
  expectation: expectationSchema,
});
export type AuthoredStepExpectation = z.infer<
  typeof authoredStepExpectationSchema
>;

export const criterionAssertionSchema = z.object({
  criterionKey: z.string().min(1),
  intent: z.string().min(1).max(300),
  expectation: expectationSchema,
});
export type CriterionAssertion = z.infer<typeof criterionAssertionSchema>;

export const authoredExpectationsSchema = z.object({
  steps: z.array(authoredStepExpectationSchema).default([]),
  assertions: z.array(criterionAssertionSchema).default([]),
});
export type AuthoredExpectations = z.infer<typeof authoredExpectationsSchema>;

export const startFeatureCheckSchema = z.object({
  applicationId: idSchema,
  environmentId: idSchema,
  /** The feature under test: "invoice creation". */
  name: z.string().min(1).max(200),
  /** Prose context — what the feature is for, how a user reaches it. */
  description: z.string().max(4000).default(''),
  criteria: z.array(acceptanceCriterionSchema).min(1).max(20),
  /** Where to begin. Defaults to the environment's base URL. */
  startUrl: urlSchema.nullish(),
  /**
   * Hard ceilings, clamped server-side. Present so a demo can be made smaller,
   * never so it can be made unbounded.
   */
  maxCases: z.coerce.number().int().min(1).max(10).default(4),
  maxStepsPerCase: z.coerce.number().int().min(1).max(25).default(10),
  maxDurationSeconds: z.coerce.number().int().min(30).max(600).default(180),
});
export type StartFeatureCheckInput = z.infer<typeof startFeatureCheckSchema>;

export const featureCheckStatusSchema = z.enum([
  'PENDING',
  'PLANNING',
  'REALIZING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
export type FeatureCheckStatus = z.infer<typeof featureCheckStatusSchema>;

/**
 * A criterion's verdict.
 *
 * `UNCOVERED` is deliberately not a failure and deliberately not a pass: the
 * planner produced no case for it, so nothing was ever checked. Folding it into
 * either would report a number that is not true.
 */
export const criterionStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'UNCERTAIN',
  'UNCOVERED',
  'NOT_RUN',
]);
export type CriterionStatus = z.infer<typeof criterionStatusSchema>;

export const criterionVerdictSchema = z.object({
  key: z.string(),
  text: z.string(),
  status: criterionStatusSchema,
  /** Specs that were meant to settle this criterion. */
  specIds: z.array(idSchema).default([]),
  /** The runs that did. */
  executionIds: z.array(idSchema).default([]),
  rationale: z.string().nullable().default(null),
});
export type CriterionVerdict = z.infer<typeof criterionVerdictSchema>;

/** One realized case: a spec, and the run that judged it. */
export const featureCaseResultSchema = z.object({
  name: z.string(),
  goal: z.string(),
  kind: testCaseKindSchema,
  priority: casePrioritySchema,
  coversCriteria: z.array(z.string()),
  specId: idSchema.nullable(),
  executionId: idSchema.nullable(),
  /** Null while the run is still going. */
  status: z.string().nullable(),
  /** Why a case never became a spec — a walk that got nowhere, mostly. */
  skippedBecause: z.string().nullable().default(null),
  /**
   * Criterion key → the index of the step that settles it.
   *
   * Recorded explicitly rather than inferred from ordering. The assertions are
   * appended in a known order today, but a verdict that silently attaches to the
   * wrong criterion is the kind of wrong nobody notices, and the map costs one
   * field.
   */
  criterionSteps: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type FeatureCaseResult = z.infer<typeof featureCaseResultSchema>;

export const featureCheckSchema = z.object({
  id: idSchema,
  featureId: idSchema,
  applicationId: idSchema,
  environmentId: idSchema,
  name: z.string(),
  description: z.string(),
  status: featureCheckStatusSchema,
  criteria: z.array(acceptanceCriterionSchema),
  verdicts: z.array(criterionVerdictSchema).default([]),
  cases: z.array(featureCaseResultSchema).default([]),
  /** Set when the check itself broke, as opposed to a criterion failing. */
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type FeatureCheck = z.infer<typeof featureCheckSchema>;

/** The grouping a generated suite hangs from. */
export const featureSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  specCount: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Feature = z.infer<typeof featureSchema>;

/**
 * A regression or smoke run over a feature's saved suite.
 *
 * `ALL` is regression and `CRITICAL` is smoke; running the same feature against
 * a different environment is the same call with a different `environmentId`,
 * which is why there is no separate cross-environment concept here.
 */
export const runFeatureSchema = z.object({
  environmentId: idSchema,
  filter: z.enum(['ALL', 'CRITICAL']).default('ALL'),
});
export type RunFeatureInput = z.infer<typeof runFeatureSchema>;

export const featureRunResultSchema = z.object({
  featureId: idSchema,
  environmentId: idSchema,
  filter: z.enum(['ALL', 'CRITICAL']),
  executionIds: z.array(idSchema),
  /** Specs the filter matched but that had no runnable version. */
  skipped: z.array(z.object({ specId: idSchema, why: z.string() })).default([]),
});
export type FeatureRunResult = z.infer<typeof featureRunResultSchema>;
