import {
  RESOLUTION_LADDER,
  actionTypeSchema,
  artifactKindSchema,
  bugStatusSchema,
  diagnosisSchema,
  executionModeSchema,
  executionStatusSchema,
  healingStatusSchema,
  knowledgeKindSchema,
  observationKindSchema,
  recordedEventTypeSchema,
  recordingStatusSchema,
  resolutionStrategySchema,
  severitySchema,
  specSourceSchema,
  stepStatusSchema,
} from './enums';

/**
 * These enums are stored as plain TEXT in SQLite because Prisma supports no
 * `enum` type there. That makes this file the only guard on what those columns
 * may hold, so a value list changing silently is worth failing a build over —
 * the Prisma schema, the docs, and these lists have to move together.
 */
describe('enum values', () => {
  const cases: [string, { options: readonly string[] }, string[]][] = [
    ['RecordingStatus', recordingStatusSchema, ['RECORDING', 'STOPPED', 'FAILED']],
    [
      'RecordedEventType',
      recordedEventTypeSchema,
      ['NAVIGATE', 'CLICK', 'INPUT', 'SELECT', 'SCROLL', 'KEY', 'SUBMIT'],
    ],
    ['SpecSource', specSourceSchema, ['RECORDED', 'MANUAL', 'HEALED', 'EXPLORED']],
    [
      'ActionType',
      actionTypeSchema,
      ['NAVIGATE', 'CLICK', 'FILL', 'SELECT', 'PRESS', 'SCROLL', 'HOVER', 'UPLOAD', 'WAIT', 'ASSERT'],
    ],
    ['ExecutionMode', executionModeSchema, ['REPLAY', 'EXPLORE']],
    [
      'ExecutionStatus',
      executionStatusSchema,
      ['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'UNCERTAIN', 'CANCELLED', 'ERROR'],
    ],
    [
      'StepStatus',
      stepStatusSchema,
      ['PENDING', 'RUNNING', 'PASS', 'FAIL', 'UNCERTAIN', 'HEALED', 'SKIPPED'],
    ],
    [
      'ResolutionStrategy',
      resolutionStrategySchema,
      ['KNOWLEDGE', 'ROLE_NAME', 'TEST_ID', 'TEXT', 'CSS', 'LLM', 'VISION'],
    ],
    ['ObservationKind', observationKindSchema, ['URL', 'DOM', 'A11Y', 'NETWORK', 'CONSOLE', 'SCREENSHOT']],
    [
      'ArtifactKind',
      artifactKindSchema,
      ['SCREENSHOT', 'DOM', 'A11Y', 'NETWORK', 'CONSOLE', 'VIDEO', 'TRACE'],
    ],
    ['KnowledgeKind', knowledgeKindSchema, ['ELEMENT_ALIAS', 'FLOW', 'SELECTOR_MEMORY', 'DOMAIN_FACT']],
    ['Diagnosis', diagnosisSchema, ['APP_BUG', 'TEST_DRIFT', 'ENVIRONMENT', 'FLAKE', 'UNKNOWN']],
    [
      'HealingStatus',
      healingStatusSchema,
      ['PROPOSED', 'APPLIED', 'APPROVED', 'REJECTED', 'REVERIFY_FAILED'],
    ],
    ['Severity', severitySchema, ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']],
    ['BugStatus', bugStatusSchema, ['OPEN', 'ACKNOWLEDGED', 'DISMISSED']],
  ];

  it.each(cases)('%s holds exactly the documented values', (_name, schema, expected) => {
    expect([...schema.options]).toEqual(expected);
  });
});

describe('RESOLUTION_LADDER', () => {
  it('covers every resolution strategy, so no rung can be silently unreachable', () => {
    expect([...RESOLUTION_LADDER].sort()).toEqual([...resolutionStrategySchema.options].sort());
  });

  it('is ordered cheapest-and-most-stable first', () => {
    // The resolver walks this array in order; deterministic rungs must precede
    // the LLM, and the LLM must precede vision, or a run would pay for a model
    // call it did not need.
    expect(RESOLUTION_LADDER.indexOf('KNOWLEDGE')).toBe(0);
    expect(RESOLUTION_LADDER.indexOf('LLM')).toBeGreaterThan(RESOLUTION_LADDER.indexOf('CSS'));
    expect(RESOLUTION_LADDER.indexOf('VISION')).toBeGreaterThan(RESOLUTION_LADDER.indexOf('LLM'));
  });
});
