import type { AcceptanceCriterion, PlannedCase } from '@agentx/shared';
import { assessCoverage, normalizePlan } from './coverage';
import { applyExpectations, rollUpCriterion } from './feature-check.service';

const criteria: AcceptanceCriterion[] = [
  { key: 'AC1', text: 'the invoice total equals the amount entered' },
  { key: 'AC2', text: 'an invoice id is returned' },
  { key: 'AC3', text: 'a zero amount is refused' },
];

const planned = (over: Partial<PlannedCase> = {}): PlannedCase => ({
  name: 'Create an invoice',
  goal: 'open the dashboard and submit an amount of 100',
  coversCriteria: ['AC1'],
  kind: 'HAPPY',
  priority: 'CRITICAL',
  ...over,
});

describe('assessCoverage', () => {
  it('names the criteria nobody planned a case for', () => {
    // The planner is asked for full coverage in its prompt. This is the check
    // that runs after it answers, which is the one that holds.
    const report = assessCoverage(criteria, [planned()]);

    expect(report.covered).toEqual(['AC1']);
    expect(report.uncovered).toEqual(['AC2', 'AC3']);
  });

  it('reports nothing uncovered when every criterion has a case', () => {
    const report = assessCoverage(criteria, [
      planned({ coversCriteria: ['AC1', 'AC2'] }),
      planned({ coversCriteria: ['AC3'], kind: 'NEGATIVE' }),
    ]);

    expect(report.uncovered).toEqual([]);
    expect(report.unknown).toEqual([]);
  });

  it('names invented criterion keys instead of counting them as coverage', () => {
    const report = assessCoverage(criteria, [
      planned({ coversCriteria: ['AC1', 'AC9'] }),
    ]);

    expect(report.unknown).toEqual(['AC9']);
    expect(report.covered).toEqual(['AC1']);
  });
});

describe('normalizePlan', () => {
  it('strips invented keys so nothing downstream sees them', () => {
    const [one] = normalizePlan(
      criteria,
      [planned({ coversCriteria: ['AC1', 'AC9'] })],
      4,
    );

    expect(one.coversCriteria).toEqual(['AC1']);
  });

  it('clamps the case count in code, not in the prompt', () => {
    const many = Array.from({ length: 9 }, () => planned());

    expect(normalizePlan(criteria, many, 3)).toHaveLength(3);
  });
});

describe('applyExpectations', () => {
  const walked = [
    {
      intent: 'open the dashboard',
      action: 'NAVIGATE' as const,
      targetDescription: null,
      targetHints: { selectorCandidates: [] },
      data: { kind: 'LITERAL' as const, value: '/dashboard' },
      expectation: {
        kind: 'URL' as const,
        match: 'prefix' as const,
        value: '/',
      },
      optional: false,
    },
    {
      intent: 'submit an amount of 100',
      action: 'CLICK' as const,
      targetDescription: 'the create invoice button',
      targetHints: { selectorCandidates: [] },
      data: null,
      expectation: {
        kind: 'URL' as const,
        match: 'prefix' as const,
        value: '/dashboard',
      },
      optional: false,
    },
  ];

  it('appends one ASSERT step per criterion and records where each landed', () => {
    const { steps, criterionSteps } = applyExpectations(
      walked,
      criteria.slice(0, 2),
      {
        steps: [],
        assertions: [
          {
            criterionKey: 'AC1',
            intent: 'the invoice total equals the amount entered',
            expectation: {
              kind: 'API_RESPONSE',
              urlPattern: '/api/invoices',
              jsonPath: 'invoice.total',
              match: 'equals',
              value: '100',
            },
          },
          {
            criterionKey: 'AC2',
            intent: 'an invoice id is returned',
            expectation: {
              kind: 'API_RESPONSE',
              urlPattern: '/api/invoices',
              jsonPath: 'invoice.id',
              match: 'exists',
            },
          },
        ],
      },
    );

    expect(steps).toHaveLength(4);
    expect(steps[2].action).toBe('ASSERT');
    // Recorded, not inferred from ordering: a verdict attached to the wrong
    // criterion is the kind of wrong nobody notices.
    expect(criterionSteps).toEqual({ AC1: 2, AC2: 3 });
  });

  it('overrides a walked step expectation by index', () => {
    const { steps } = applyExpectations(walked, [], {
      steps: [
        {
          stepIndex: 1,
          expectation: { kind: 'TEXT', value: 'Invoice for 100 created.' },
        },
      ],
      assertions: [],
    });

    expect(steps[1].expectation).toEqual({
      kind: 'TEXT',
      value: 'Invoice for 100 created.',
    });
    // Untouched steps are carried across unchanged.
    expect(steps[0].expectation).toEqual(walked[0].expectation);
  });

  it('drops an assertion against a criterion the user never wrote', () => {
    const { steps, criterionSteps } = applyExpectations(walked, criteria, {
      steps: [],
      assertions: [
        {
          criterionKey: 'AC9',
          intent: 'invented',
          expectation: { kind: 'NO_CONSOLE_ERRORS', allowlist: [] },
        },
      ],
    });

    expect(steps).toHaveLength(2);
    expect(criterionSteps).toEqual({});
  });
});

describe('rollUpCriterion', () => {
  it('lets a known failure outrank an open question, which outranks a pass', () => {
    expect(rollUpCriterion(['PASS', 'UNCERTAIN', 'FAIL'])).toBe('FAIL');
    expect(rollUpCriterion(['PASS', 'UNCERTAIN'])).toBe('UNCERTAIN');
    expect(rollUpCriterion(['PASS', 'HEALED'])).toBe('PASS');
  });

  it('reports NOT_RUN rather than passing when nothing was decided', () => {
    expect(rollUpCriterion([])).toBe('NOT_RUN');
    expect(rollUpCriterion(['PENDING', 'SKIPPED'])).toBe('NOT_RUN');
  });
});
