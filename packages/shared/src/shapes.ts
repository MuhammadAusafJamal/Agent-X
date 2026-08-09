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
  /**
   * A value inside a JSON response body.
   *
   * `NETWORK_OK` reads a status code and nothing else, so a `200` carrying the
   * wrong number passes it clean. This is the kind that lets an acceptance
   * criterion about a *value* — a total, an id, a status field — fail, and it
   * does so deterministically: no model call, and the same answer every run.
   */
  z.object({
    kind: z.literal('API_RESPONSE'),
    /** Substring of the request URL, the same matching `NETWORK_OK` uses. */
    urlPattern: z.string().min(1),
    /** Dot path into the parsed body: `invoice.total`, `items.0.sku`. */
    jsonPath: z.string().min(1),
    match: z.enum(['equals', 'contains', 'matches', 'exists']),
    /**
     * Compared as a string, so `1500` and `"1500"` are the same claim. Omitted
     * for `exists`, which asks only whether the path is present.
     */
    value: z.string().optional(),
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
  /**
   * The response body, for JSON responses only, truncated and redacted.
   *
   * Captured because a status code cannot answer "did it return the right
   * total". Restricted to JSON and capped in size on purpose: buffering every
   * image and bundle a page loads would bloat the evidence tree for no signal.
   * Absent whenever the body was not JSON, was too large, or could not be read
   * — and absent must never be read as "checked and fine".
   */
  responseBody: z.string().optional(),
  /** True when a body existed but was dropped by the cap or the type filter. */
  bodyOmitted: z.boolean().optional(),
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

/**
 * Artifact ids captured at the moment a defect was observed.
 *
 * Lives here rather than beside its one reader so both ends of the column share
 * a definition: declared privately in the mapper, the write side had nothing to
 * validate against and quietly used a bare `JSON.stringify`.
 */
export const evidenceRefsSchema = z.array(z.string().min(1));
export type EvidenceRefs = z.infer<typeof evidenceRefsSchema>;
