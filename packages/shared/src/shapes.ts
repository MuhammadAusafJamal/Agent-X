import { z } from 'zod';
import { resolutionStrategySchema } from './enums';

/**
 * The structured values that live inside JSON columns and prompt payloads.
 *
 * These are the shapes that make Agent X's premise work: a step is described by
 * what it means (`Expectation`, `targetDescription`) with selectors kept only as
 * fallbacks (`TargetHints`). Read them alongside `docs/data-model.md`.
 */

export const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BBox = z.infer<typeof bboxSchema>;

/**
 * One way to find an element, with a score from the capture-time ranker.
 * Higher scores are more stable: a `data-testid` outlives a CSS path.
 */
export const selectorCandidateSchema = z.object({
  strategy: resolutionStrategySchema,
  value: z.string().min(1),
  score: z.number().min(0).max(1),
});
export type SelectorCandidate = z.infer<typeof selectorCandidateSchema>;

/**
 * Fallbacks for finding a target — deliberately *not* the primary key.
 *
 * The resolver leads with `targetDescription` (natural language) and drops to
 * these only as the ladder descends. A recording whose button gets renamed has
 * stale hints and a still-true description, which is the whole point.
 */
export const targetHintsSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  testId: z.string().optional(),
  text: z.string().optional(),
  /** Enclosing landmark or section — separates "Save in the toolbar" from "Save in the dialog". */
  landmark: z.string().optional(),
  bbox: bboxSchema.optional(),
  selectorCandidates: z.array(selectorCandidateSchema).default([]),
});
export type TargetHints = z.infer<typeof targetHintsSchema>;

export const urlMatchSchema = z.enum(['exact', 'prefix', 'pattern']);
export type UrlMatch = z.infer<typeof urlMatchSchema>;

/**
 * What a step is expected to produce.
 *
 * Every kind except `SEMANTIC` is checked deterministically and for free. The
 * verifier only escalates to the LLM when a deterministic check returns
 * INCONCLUSIVE, or when the expectation is `SEMANTIC` by construction.
 */
export const expectationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('URL'),
    match: urlMatchSchema,
    value: z.string().min(1),
  }),
  z.object({
    kind: z.literal('VISIBLE'),
    description: z.string().min(1),
    hints: targetHintsSchema.optional(),
  }),
  z.object({
    kind: z.literal('NOT_VISIBLE'),
    description: z.string().min(1),
    hints: targetHintsSchema.optional(),
  }),
  z.object({
    kind: z.literal('TEXT'),
    value: z.string().min(1),
    scope: z.string().optional(),
  }),
  z.object({
    kind: z.literal('NETWORK_OK'),
    urlPattern: z.string().optional(),
    maxStatus: z.number().int().min(100).max(599).default(399),
  }),
  z.object({
    kind: z.literal('NO_CONSOLE_ERRORS'),
    /** Messages matching these patterns are ignored — real apps log noise. */
    allowlist: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal('SEMANTIC'),
    description: z.string().min(1),
  }),
]);
export type Expectation = z.infer<typeof expectationSchema>;
export type ExpectationKind = Expectation['kind'];

/**
 * Credentials, by reference only.
 *
 * These are the *names* of environment variables, never values. The runner reads
 * `process.env[name]` at execution time, so secrets never reach SQLite, the
 * evidence directory, a report, or an LLM prompt.
 */
export const credentialRefsSchema = z.object({
  usernameEnv: z.string().min(1).optional(),
  passwordEnv: z.string().min(1).optional(),
  /** Additional named references, e.g. `{ totpSecret: 'DEMO_TOTP' }`. */
  extra: z.record(z.string(), z.string().min(1)).default({}),
});
export type CredentialRefs = z.infer<typeof credentialRefsSchema>;

/** A step's input value: either a literal, or a reference to an env var for anything secret. */
export const stepDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LITERAL'), value: z.string() }),
  z.object({ kind: z.literal('ENV_REF'), envVar: z.string().min(1) }),
]);
export type StepData = z.infer<typeof stepDataSchema>;

export const knowledgeValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ELEMENT_ALIAS'),
    description: z.string().min(1),
    role: z.string().optional(),
    name: z.string().optional(),
    selector: z.string().min(1),
  }),
  z.object({
    kind: z.literal('SELECTOR_MEMORY'),
    stepKey: z.string().min(1),
    selector: z.string().min(1),
    strategy: resolutionStrategySchema,
  }),
  z.object({
    kind: z.literal('FLOW'),
    name: z.string().min(1),
    steps: z.array(z.string().min(1)),
  }),
  z.object({
    kind: z.literal('DOMAIN_FACT'),
    statement: z.string().min(1),
  }),
]);
export type KnowledgeValue = z.infer<typeof knowledgeValueSchema>;

export const networkEntrySchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().int().optional(),
  ok: z.boolean().optional(),
  durationMs: z.number().optional(),
  resourceType: z.string().optional(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

export const consoleEntrySchema = z.object({
  type: z.enum(['log', 'info', 'warn', 'error', 'debug', 'trace', 'other']),
  text: z.string(),
  location: z.string().optional(),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

/**
 * The small, inline part of an observation. Anything large — the DOM, the a11y
 * tree, a screenshot — is an `Artifact` on disk; this payload just describes it.
 */
export const observationPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('URL'), url: z.string() }),
  z.object({ kind: z.literal('DOM'), bytes: z.number().int().optional(), truncated: z.boolean().default(false) }),
  z.object({ kind: z.literal('A11Y'), nodeCount: z.number().int().optional() }),
  z.object({ kind: z.literal('NETWORK'), entries: z.array(networkEntrySchema) }),
  z.object({ kind: z.literal('CONSOLE'), entries: z.array(consoleEntrySchema) }),
  z.object({
    kind: z.literal('SCREENSHOT'),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  }),
]);
export type ObservationPayload = z.infer<typeof observationPayloadSchema>;

/** A verifier's decision, as returned by the semantic verifier and stored on the step. */
export const verificationResultSchema = z.object({
  status: z.enum(['PASS', 'FAIL', 'UNCERTAIN']),
  rationale: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

/**
 * A deterministic check's decision. `INCONCLUSIVE` is what routes a step to the
 * LLM verifier — a checker that cannot evaluate its own expectation must say so
 * rather than defaulting to PASS.
 */
export const deterministicResultSchema = z.object({
  status: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  rationale: z.string().min(1),
});
export type DeterministicResult = z.infer<typeof deterministicResultSchema>;

export const reproStepsSchema = z.array(z.string().min(1));
export type ReproSteps = z.infer<typeof reproStepsSchema>;
