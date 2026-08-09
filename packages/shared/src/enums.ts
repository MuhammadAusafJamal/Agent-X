import { z } from 'zod';

/**
 * Every enum in the system.
 *
 * Prisma does not support `enum` on SQLite, so these are stored as plain TEXT
 * columns. That means the database will happily accept garbage in them — these
 * schemas are the only thing that does not. Anything writing an enum-backed
 * column parses through the matching schema first.
 *
 * The value lists here and the ones documented in `docs/data-model.md` are the
 * same list; `enums.spec.ts` asserts they stay that way.
 */

export const recordingStatusSchema = z.enum(['RECORDING', 'STOPPED', 'FAILED']);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;

export const recordedEventTypeSchema = z.enum([
  'NAVIGATE',
  'CLICK',
  'INPUT',
  'SELECT',
  'SCROLL',
  'KEY',
  'SUBMIT',
]);
export type RecordedEventType = z.infer<typeof recordedEventTypeSchema>;

/**
 * `GENERATED` is distinct from `EXPLORED` on purpose: an explored spec came from
 * a goal-directed walk whose expectations describe what the page became, while a
 * generated one was written against acceptance criteria a human supplied. Only
 * the second carries an oracle, and a reader of the spec list should be able to
 * tell which is which.
 */
export const specSourceSchema = z.enum([
  'RECORDED',
  'MANUAL',
  'HEALED',
  'EXPLORED',
  'GENERATED',
]);
export type SpecSource = z.infer<typeof specSourceSchema>;

export const actionTypeSchema = z.enum([
  'NAVIGATE',
  'CLICK',
  'FILL',
  'SELECT',
  'PRESS',
  'SCROLL',
  'HOVER',
  'UPLOAD',
  'WAIT',
  'ASSERT',
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const executionModeSchema = z.enum(['REPLAY', 'EXPLORE']);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const executionStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'PASSED',
  'FAILED',
  'UNCERTAIN',
  'CANCELLED',
  'ERROR',
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const stepStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'PASS',
  'FAIL',
  'UNCERTAIN',
  'HEALED',
  'SKIPPED',
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/**
 * The Action Resolver ladder, in the order it is tried. `LLM` arrives in Phase 5
 * and `VISION` in Phase 8; the earlier rungs are pure DOM and accessibility work.
 */
export const resolutionStrategySchema = z.enum([
  'KNOWLEDGE',
  'ROLE_NAME',
  'TEST_ID',
  'TEXT',
  'CSS',
  'LLM',
  'VISION',
]);
export type ResolutionStrategy = z.infer<typeof resolutionStrategySchema>;

/** The ladder in try-order. The resolver walks this array; it does not hardcode an order. */
export const RESOLUTION_LADDER: readonly ResolutionStrategy[] = [
  'KNOWLEDGE',
  'ROLE_NAME',
  'TEST_ID',
  'TEXT',
  'CSS',
  'LLM',
  'VISION',
] as const;

export const observationKindSchema = z.enum([
  'URL',
  'DOM',
  'A11Y',
  'NETWORK',
  'CONSOLE',
  'SCREENSHOT',
]);
export type ObservationKind = z.infer<typeof observationKindSchema>;

export const artifactKindSchema = z.enum([
  'SCREENSHOT',
  'DOM',
  'A11Y',
  'NETWORK',
  'CONSOLE',
  'VIDEO',
  'TRACE',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const knowledgeKindSchema = z.enum([
  'ELEMENT_ALIAS',
  'FLOW',
  'SELECTOR_MEMORY',
  'DOMAIN_FACT',
]);
export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;

export const diagnosisSchema = z.enum([
  'APP_BUG',
  'TEST_DRIFT',
  'ENVIRONMENT',
  'FLAKE',
  'UNKNOWN',
]);
export type Diagnosis = z.infer<typeof diagnosisSchema>;

export const healingStatusSchema = z.enum([
  'PROPOSED',
  'APPLIED',
  'APPROVED',
  'REJECTED',
  'REVERIFY_FAILED',
]);
export type HealingStatus = z.infer<typeof healingStatusSchema>;

export const severitySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type Severity = z.infer<typeof severitySchema>;

export const bugStatusSchema = z.enum(['OPEN', 'ACKNOWLEDGED', 'DISMISSED']);
export type BugStatus = z.infer<typeof bugStatusSchema>;
