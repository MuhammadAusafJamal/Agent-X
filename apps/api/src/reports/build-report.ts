import {
  REPORT_BODY_MARKER,
  type ReportBody,
  type ReportBug,
  type ReportDocument,
  type ReportHealing,
  type ReportRun,
  type ReportStep,
  type Severity,
  type TargetHints,
} from '@agentx/shared';

/**
 * A run, rendered.
 *
 * Pure functions over already-loaded rows, so the property that matters —
 * **byte-identical bodies for two runs of an unchanged application** — can be
 * tested without a browser, a database, or a model.
 *
 * Determinism here is not decoration. A report you can `diff` is a report you
 * can review; one whose bytes shift every run gets skimmed once and ignored
 * after that. It costs three rules: sort every collection by something stable,
 * keep cuids and clocks out of the body, and make evidence paths relative.
 */

export interface ReportInput {
  run: ReportRun;
  specName: string;
  environmentName: string;
  status: ReportBody['status'];
  steps: {
    index: number;
    intent: string;
    action: ReportStep['action'];
    status: ReportStep['status'];
    resolutionStrategy: ReportStep['resolutionStrategy'];
    resolvedSelector: string | null;
    candidateCount: number | null;
    confidence: number | null;
    verifierRationale: string | null;
    error: string | null;
    diagnosis: ReportStep['diagnosis'];
    diagnosisRationale: string | null;
    evidence: string[];
  }[];
  healings: {
    stepIndex: number;
    status: ReportHealing['status'];
    reverifyStatus: ReportHealing['reverifyStatus'];
    from: TargetHints;
    to: TargetHints;
    rationale: string;
  }[];
  bugs: {
    stepIndex: number | null;
    severity: Severity;
    title: string;
    summary: string;
    expected: string;
    actual: string;
    reproSteps: string[];
  }[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function buildReport(input: ReportInput): ReportDocument {
  const steps: ReportStep[] = [...input.steps]
    .sort((a, b) => a.index - b.index)
    .map((step) => ({
      position: step.index + 1,
      intent: step.intent,
      action: step.action,
      status: step.status,
      resolutionStrategy: step.resolutionStrategy,
      resolvedSelector: step.resolvedSelector,
      candidateCount: step.candidateCount,
      confidence: step.confidence,
      verifierRationale: step.verifierRationale,
      error: step.error,
      diagnosis: step.diagnosis,
      diagnosisRationale: step.diagnosisRationale,
      // Relative to the run's own directory, so the path does not carry an id
      // that changes every run.
      evidence: [...step.evidence]
        .map((path) => relativeToRun(path, input.run.evidenceBase))
        .sort(),
    }));

  const healings: ReportHealing[] = input.healings
    .map((healing) => ({
      stepPosition: healing.stepIndex + 1,
      status: healing.status,
      reverifyStatus: healing.reverifyStatus,
      from: describeHints(healing.from),
      to: describeHints(healing.to),
      rationale: healing.rationale,
    }))
    // Sorted by where they happened, then by what they proposed — never by id,
    // which is a cuid and therefore different on every run.
    .sort((a, b) => a.stepPosition - b.stepPosition || compare(a.to, b.to));

  const bugs: ReportBug[] = input.bugs
    .map((bug) => ({
      stepPosition: bug.stepIndex === null ? null : bug.stepIndex + 1,
      severity: bug.severity,
      title: bug.title,
      summary: bug.summary,
      expected: bug.expected,
      actual: bug.actual,
      reproSteps: bug.reproSteps,
    }))
    // Worst first — the order someone triaging would ask for.
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (a.stepPosition ?? 0) - (b.stepPosition ?? 0) ||
        compare(a.title, b.title),
    );

  const body: ReportBody = {
    specName: input.specName,
    environmentName: input.environmentName,
    status: input.status,
    counts: {
      total: steps.length,
      passed: steps.filter((step) => step.status === 'PASS').length,
      failed: steps.filter((step) => step.status === 'FAIL').length,
      uncertain: steps.filter((step) => step.status === 'UNCERTAIN').length,
      healed: steps.filter((step) => step.status === 'HEALED').length,
      skipped: steps.filter((step) => step.status === 'SKIPPED').length,
    },
    steps,
    healings,
    bugs,
  };

  return { run: input.run, body };
}

/**
 * The Markdown, with the volatile header separated from the comparable body by
 * a marker.
 */
export function renderMarkdown(document: ReportDocument): string {
  const { run, body } = document;

  const header = [
    `# ${body.specName} — ${body.status}`,
    '',
    '| | |',
    '| --- | --- |',
    `| Run | \`${run.executionId}\` |`,
    `| Specification version | ${run.specVersion} |`,
    `| Environment | ${body.environmentName} |`,
    `| Started | ${run.startedAt} |`,
    `| Duration | ${run.durationMs === null ? '—' : `${run.durationMs} ms`} |`,
    `| Model calls | ${run.llmCallCount}${
      run.llmCallCount === 0
        ? ''
        : ` (${run.inputTokens} in / ${run.outputTokens} out)`
    } |`,
    `| Evidence | \`${run.evidenceBase}/\` |`,
    '',
    '> Everything above this line is particular to this run. Everything below it',
    '> is the comparable body: two runs of an unchanged application produce the',
    '> same bytes, so reports can be diffed.',
    '',
    REPORT_BODY_MARKER,
    '',
  ];

  const summary = [
    `## Result: ${body.status}`,
    '',
    describeCounts(body),
    '',
    '## Steps',
    '',
  ];

  const steps = body.steps.flatMap((step) => renderStep(step));

  const healings =
    body.healings.length === 0
      ? []
      : [
          '## Repairs',
          '',
          ...body.healings.flatMap((healing) => [
            `### Step ${healing.stepPosition} — ${healing.status}${
              healing.reverifyStatus === null
                ? ''
                : ` (reverified ${healing.reverifyStatus})`
            }`,
            '',
            `- was: \`${healing.from}\``,
            `- now: \`${healing.to}\``,
            `- ${healing.rationale}`,
            '',
          ]),
        ];

  const bugs =
    body.bugs.length === 0
      ? []
      : [
          '## Defects',
          '',
          ...body.bugs.flatMap((bug) => [
            `### ${bug.severity} — ${bug.title}`,
            '',
            bug.summary,
            '',
            '**Expected.** ' + bug.expected,
            '',
            '**Actual.** ' + bug.actual,
            '',
            '**Steps to reproduce**',
            '',
            ...bug.reproSteps.map((step) => `${step}`),
            '',
          ]),
        ];

  return [...header, ...summary, ...steps, ...healings, ...bugs]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}

function renderStep(step: ReportStep): string[] {
  const lines = [`### ${step.position}. ${step.intent} — ${step.status}`, ''];

  lines.push(`- action: \`${step.action}\``);

  if (step.resolutionStrategy !== null) {
    const ambiguity =
      step.candidateCount !== null && step.candidateCount > 1
        ? `, ${step.candidateCount} candidates`
        : '';

    lines.push(
      `- found by: \`${step.resolutionStrategy}\`${ambiguity}${
        step.confidence === null
          ? ''
          : ` (confidence ${step.confidence.toFixed(2)})`
      }`,
    );
  }

  if (step.resolvedSelector !== null) {
    lines.push(`- matched: \`${step.resolvedSelector}\``);
  }

  if (step.verifierRationale !== null) {
    lines.push(`- verified: ${step.verifierRationale}`);
  }

  if (step.error !== null) {
    lines.push(`- failed: ${step.error}`);
  }

  if (step.diagnosis !== null) {
    lines.push(
      `- diagnosed \`${step.diagnosis}\`${
        step.diagnosisRationale === null ? '' : `: ${step.diagnosisRationale}`
      }`,
    );
  }

  if (step.evidence.length > 0) {
    lines.push(
      `- evidence: ${step.evidence.map((path) => `[${path}](${path})`).join(', ')}`,
    );
  }

  lines.push('');

  return lines;
}

function describeCounts(body: ReportBody): string {
  const { counts } = body;

  const parts = [
    `${counts.passed} passed`,
    counts.healed > 0 ? `${counts.healed} healed` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.uncertain > 0 ? `${counts.uncertain} uncertain` : null,
    counts.skipped > 0 ? `${counts.skipped} skipped` : null,
  ].filter((part) => part !== null);

  return `${parts.join(', ')} — ${counts.total} step${
    counts.total === 1 ? '' : 's'
  } in total.`;
}

/**
 * Targeting as one readable line.
 *
 * The reviewer's question about a repair is "what is it looking for now", and a
 * JSON blob answers it badly.
 */
function describeHints(hints: TargetHints): string {
  const parts = [
    hints.role === undefined ? null : `role=${hints.role}`,
    hints.name === undefined ? null : `name="${hints.name}"`,
    hints.testId === undefined ? null : `testid=${hints.testId}`,
    hints.text === undefined ? null : `text="${hints.text}"`,
    hints.landmark === undefined ? null : `in ${hints.landmark}`,
  ].filter((part) => part !== null);

  return parts.length === 0 ? '(nothing)' : parts.join(' ');
}

/** `<executionId>/step-3/shot.jpg` → `step-3/shot.jpg`. */
function relativeToRun(relPath: string, base: string): string {
  const prefix = `${base}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
}

/** Stable across locales, unlike `localeCompare`. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
