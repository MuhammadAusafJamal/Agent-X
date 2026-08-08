import type {
  ConsoleEntry,
  DeterministicResult,
  Expectation,
  NetworkEntry,
} from '@agentx/shared';

/**
 * The checks that cost nothing.
 *
 * These run on every step and settle most of them on their own: they are free,
 * fast, and not subject to a model's opinion. The LLM verifier exists only for
 * what these cannot express.
 *
 * The three-way result is the important part. `INCONCLUSIVE` is what routes a
 * step to the semantic verifier — a checker that cannot evaluate its own
 * expectation has to say so, because the alternative is defaulting to PASS and
 * quietly reporting green.
 *
 * Everything here is a pure function of what was observed, which is why it can
 * be tested without a browser.
 */

export function checkUrl(
  actual: string,
  expectation: Extract<Expectation, { kind: 'URL' }>,
): DeterministicResult {
  const { match, value } = expectation;

  // A relative expectation is compared against the path, so a spec written
  // against localhost:4321 still means something on staging.
  const comparable = value.startsWith('/') ? pathOf(actual) : actual;

  const passed =
    match === 'exact'
      ? comparable === value
      : match === 'prefix'
        ? comparable.startsWith(value)
        : safeMatch(value, comparable);

  return passed
    ? {
        status: 'PASS',
        rationale: `URL ${match} “${value}” — was “${actual}”.`,
      }
    : {
        status: 'FAIL',
        rationale: `Expected the URL to ${match} “${value}”, but it was “${actual}”.`,
      };
}

export function checkNetwork(
  entries: NetworkEntry[],
  expectation: Extract<Expectation, { kind: 'NETWORK_OK' }>,
): DeterministicResult {
  const scoped =
    expectation.urlPattern === undefined
      ? entries
      : entries.filter((entry) => entry.url.includes(expectation.urlPattern!));

  if (scoped.length === 0) {
    // Nothing to judge. Saying so is not the same as saying it passed.
    return {
      status: 'INCONCLUSIVE',
      rationale:
        expectation.urlPattern === undefined
          ? 'This step made no requests, so there was nothing to check.'
          : `No request matched “${expectation.urlPattern}”.`,
    };
  }

  const failed = scoped.filter(
    (entry) => (entry.status ?? 0) > expectation.maxStatus,
  );

  return failed.length === 0
    ? {
        status: 'PASS',
        rationale: `${scoped.length} request(s) all returned at or below ${expectation.maxStatus}.`,
      }
    : {
        status: 'FAIL',
        rationale: `${failed.length} request(s) failed: ${failed
          .slice(0, 3)
          .map((entry) => `${entry.status} ${entry.method} ${entry.url}`)
          .join('; ')}.`,
      };
}

export function checkConsole(
  entries: ConsoleEntry[],
  expectation: Extract<Expectation, { kind: 'NO_CONSOLE_ERRORS' }>,
): DeterministicResult {
  const errors = entries
    .filter((entry) => entry.type === 'error')
    // Real applications log noise, and a verifier that cries wolf gets ignored.
    .filter(
      (entry) =>
        !expectation.allowlist.some((allowed) => entry.text.includes(allowed)),
    );

  return errors.length === 0
    ? { status: 'PASS', rationale: 'No console errors during this step.' }
    : {
        status: 'FAIL',
        rationale: `${errors.length} console error(s): ${errors
          .slice(0, 3)
          .map((entry) => entry.text)
          .join(' | ')}.`,
      };
}

/**
 * Roll-up from step statuses to a run status.
 *
 * `UNCERTAIN` outranks `PASSED` and is outranked by `FAILED`: an unresolved
 * question must never be reported as success, and must never hide a known
 * failure either.
 */
export function rollUp(
  steps: { status: string; optional: boolean }[],
): 'PASSED' | 'FAILED' | 'UNCERTAIN' {
  const blocking = steps.filter((step) => !step.optional);

  if (blocking.some((step) => step.status === 'FAIL')) return 'FAILED';
  if (steps.some((step) => step.status === 'UNCERTAIN')) return 'UNCERTAIN';

  return 'PASSED';
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function safeMatch(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // An unparseable pattern is the spec's problem, not a crash.
    return false;
  }
}
