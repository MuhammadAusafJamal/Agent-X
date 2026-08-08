import { reportBodyOf } from '@agentx/shared';
import { buildReport, renderMarkdown, type ReportInput } from './build-report';

/**
 * The property the report format exists for: **two runs of an unchanged
 * application produce the same bytes**.
 *
 * A report you can `diff` is a report you can review. One whose bytes shift on
 * every run gets skimmed once and ignored afterwards, and then nobody notices
 * the day it starts saying something different.
 */
describe('Report determinism', () => {
  const input = (overrides: Partial<ReportInput> = {}): ReportInput => ({
    run: {
      executionId: 'exec_first',
      specId: 'spec_1',
      versionId: 'ver_1',
      specVersion: 1,
      startedAt: '2026-08-09T01:00:00.000Z',
      finishedAt: '2026-08-09T01:00:20.000Z',
      durationMs: 20_000,
      evidenceBase: 'exec_first',
      llmCallCount: 1,
      inputTokens: 900,
      outputTokens: 40,
      costUsd: null,
    },
    specName: 'Sign in as the seeded user',
    environmentName: 'local',
    status: 'PASSED',
    steps: [
      {
        index: 0,
        intent: 'open the sign-in page',
        action: 'NAVIGATE',
        status: 'PASS',
        resolutionStrategy: null,
        resolvedSelector: null,
        candidateCount: null,
        confidence: null,
        verifierRationale: 'Found “Sign in” on the page.',
        error: null,
        diagnosis: null,
        diagnosisRationale: null,
        evidence: ['exec_first/step-0/shot.jpg', 'exec_first/step-0/dom.html'],
      },
      {
        index: 1,
        intent: 'submit the sign-in form',
        action: 'CLICK',
        status: 'PASS',
        resolutionStrategy: 'ROLE_NAME',
        resolvedSelector: 'role=button[name="Sign in"]',
        candidateCount: 1,
        confidence: 0.9,
        verifierRationale: 'URL prefix “/dashboard”.',
        error: null,
        diagnosis: null,
        diagnosisRationale: null,
        evidence: ['exec_first/step-1/shot.jpg'],
      },
    ],
    healings: [],
    bugs: [],
    ...overrides,
  });

  /** The same run, a second time: new ids, new clock, same application. */
  const secondRun = (base: ReportInput): ReportInput => ({
    ...base,
    run: {
      ...base.run,
      executionId: 'exec_second',
      startedAt: '2026-08-09T09:30:00.000Z',
      finishedAt: '2026-08-09T09:30:31.000Z',
      durationMs: 31_412,
      evidenceBase: 'exec_second',
      inputTokens: 913,
      outputTokens: 44,
    },
    steps: base.steps.map((step) => ({
      ...step,
      evidence: step.evidence.map((path) =>
        path.replace('exec_first', 'exec_second'),
      ),
    })),
  });

  it('produces identical bodies for two runs of the same passing spec', () => {
    const first = buildReport(input());
    const second = buildReport(secondRun(input()));

    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    expect(reportBodyOf(renderMarkdown(second))).toBe(
      reportBodyOf(renderMarkdown(first)),
    );
  });

  it('keeps the parts that legitimately differ out of the body', () => {
    const first = renderMarkdown(buildReport(input()));
    const second = renderMarkdown(buildReport(secondRun(input())));

    // The whole documents differ — ids and timings are real information.
    expect(second).not.toBe(first);
    expect(first).toContain('exec_first');
    expect(reportBodyOf(first)).not.toContain('exec_first');
    expect(reportBodyOf(first)).not.toContain('20000 ms');
  });

  it('makes evidence relative to the run, so the path carries no id', () => {
    const { body } = buildReport(input());

    expect(body.steps[0]?.evidence).toEqual([
      'step-0/dom.html',
      'step-0/shot.jpg',
    ]);
  });

  it('sorts evidence rather than trusting the order rows came back in', () => {
    const shuffled = input();
    shuffled.steps[0].evidence = [
      'exec_first/step-0/shot.jpg',
      'exec_first/step-0/dom.html',
    ];

    const other = input();
    other.steps[0].evidence = [
      'exec_first/step-0/dom.html',
      'exec_first/step-0/shot.jpg',
    ];

    expect(JSON.stringify(buildReport(shuffled).body)).toBe(
      JSON.stringify(buildReport(other).body),
    );
  });

  it('sorts steps by position, whatever order they arrive in', () => {
    const reversed = input();
    reversed.steps = [...reversed.steps].reverse();

    expect(buildReport(reversed).body.steps.map((s) => s.position)).toEqual([
      1, 2,
    ]);
  });

  it('orders defects worst first, and never by id', () => {
    const withBugs = input({
      status: 'FAILED',
      bugs: [
        {
          stepIndex: 1,
          severity: 'MEDIUM',
          title: 'Wrong greeting',
          summary: 's',
          expected: 'e',
          actual: 'a',
          reproSteps: ['1. x'],
        },
        {
          stepIndex: 1,
          severity: 'CRITICAL',
          title: 'Sign-in returns 500',
          summary: 's',
          expected: 'e',
          actual: 'a',
          reproSteps: ['1. x'],
        },
      ],
    });

    expect(buildReport(withBugs).body.bugs.map((bug) => bug.severity)).toEqual([
      'CRITICAL',
      'MEDIUM',
    ]);
  });

  it('orders repairs by step, then by what they proposed', () => {
    const hints = (name: string) => ({ name, selectorCandidates: [] });

    const withHealings = input({
      healings: [
        {
          stepIndex: 1,
          status: 'APPLIED' as const,
          reverifyStatus: 'PASS' as const,
          from: hints('Sign in'),
          to: hints('Zebra'),
          rationale: 'r',
        },
        {
          stepIndex: 1,
          status: 'APPLIED' as const,
          reverifyStatus: 'PASS' as const,
          from: hints('Sign in'),
          to: hints('Alpha'),
          rationale: 'r',
        },
      ],
    });

    expect(buildReport(withHealings).body.healings.map((h) => h.to)).toEqual([
      'name="Alpha"',
      'name="Zebra"',
    ]);
  });

  it('counts outcomes rather than restating statuses', () => {
    const mixed = input({ status: 'UNCERTAIN' });
    mixed.steps[1].status = 'HEALED';

    const { counts } = buildReport(mixed).body;

    expect(counts).toMatchObject({ total: 2, passed: 1, healed: 1, failed: 0 });
  });

  it('reads standalone — outcomes and reasons, not just statuses', () => {
    const markdown = renderMarkdown(buildReport(input()));

    expect(markdown).toContain('Sign in as the seeded user');
    expect(markdown).toContain('Found “Sign in” on the page.');
    expect(markdown).toContain('role=button[name="Sign in"]');
    // Evidence is linked, relatively, so the file works next to its directory.
    expect(markdown).toContain('[step-1/shot.jpg](step-1/shot.jpg)');
  });

  it('records a diagnosis and its reason when a step failed', () => {
    const failing = input({ status: 'FAILED' });
    failing.steps[1] = {
      ...failing.steps[1],
      status: 'FAIL',
      error: 'Could not find button “Sign in”.',
      diagnosis: 'APP_BUG',
      diagnosisRationale: 'POST /login returned 500 during this step.',
    };

    const markdown = renderMarkdown(buildReport(failing));

    expect(markdown).toContain('diagnosed `APP_BUG`');
    expect(markdown).toContain('POST /login returned 500');
  });
});
