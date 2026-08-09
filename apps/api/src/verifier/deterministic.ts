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

/**
 * A value inside a JSON response body.
 *
 * This is the check that lets an acceptance criterion about a *number* fail.
 * `checkNetwork` reads a status code, so a `200` carrying the wrong total is
 * indistinguishable from a correct one; here the body is read and one path in it
 * is compared.
 *
 * Every way of not knowing returns `INCONCLUSIVE` rather than `PASS`: no request
 * matched, no body was captured, the body was not JSON. The same rule as
 * `checkNetwork` — no evidence of failure is not evidence of success. A
 * malformed *expectation*, though, is `FAIL`: that is the spec's bug, and
 * escalating it to the model would only ask a second component to guess at a
 * value the first one never supplied.
 */
export function checkApiResponse(
  entries: NetworkEntry[],
  expectation: Extract<Expectation, { kind: 'API_RESPONSE' }>,
): DeterministicResult {
  const { urlPattern, jsonPath, match, value } = expectation;

  if (match !== 'exists' && value === undefined) {
    return {
      status: 'FAIL',
      rationale: `This expectation asks the value at “${jsonPath}” to ${match} something, but names no value to compare against.`,
    };
  }

  const scoped = entries.filter((entry) => entry.url.includes(urlPattern));

  if (scoped.length === 0) {
    return {
      status: 'INCONCLUSIVE',
      rationale: `No request matched “${urlPattern}”, so there was no body to read.`,
    };
  }

  // The last match: a step can trigger several calls to the same endpoint, and
  // the one that produced the state being checked is the most recent.
  const withBody = scoped.filter((entry) => entry.responseBody !== undefined);
  const entry = withBody.at(-1);

  if (entry?.responseBody === undefined) {
    return {
      status: 'INCONCLUSIVE',
      rationale: `${scoped.length} request(s) matched “${urlPattern}”, but no JSON body was captured for any of them.`,
    };
  }

  let body: unknown;

  try {
    body = JSON.parse(entry.responseBody);
  } catch {
    return {
      status: 'INCONCLUSIVE',
      rationale: `The response from ${entry.url} could not be parsed as JSON.`,
    };
  }

  const found = readPath(body, jsonPath);

  if (found === undefined) {
    return {
      status: 'FAIL',
      rationale: `The response from ${entry.url} has nothing at “${jsonPath}”.`,
    };
  }

  if (match === 'exists') {
    return {
      status: 'PASS',
      rationale: `“${jsonPath}” is present in the response from ${entry.url}.`,
    };
  }

  const actual = stringifyValue(found);
  const expected = value as string;

  const passed =
    match === 'equals'
      ? actual === expected
      : match === 'contains'
        ? actual.includes(expected)
        : safeMatch(expected, actual);

  return passed
    ? {
        status: 'PASS',
        rationale: `“${jsonPath}” ${match} “${expected}” — was “${actual}”.`,
      }
    : {
        status: 'FAIL',
        rationale: `Expected “${jsonPath}” to ${match} “${expected}”, but it was “${actual}” (from ${entry.url}).`,
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

/**
 * Reads a dot path out of a parsed body: `invoice.total`, `items.0.sku`.
 *
 * Deliberately not JSONPath. A criterion names a field; supporting filters and
 * wildcards would invite expectations whose meaning depends on a query language
 * nobody reading the spec knows.
 */
function readPath(body: unknown, path: string): unknown {
  let current = body;

  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    if (typeof current !== 'object') return undefined;

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Everything compares as a string, so `1500` and `"1500"` are the same claim.
 * A criterion is written in prose and cannot say which the API happened to use.
 */
function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) return 'null';

  // Objects and arrays compare as their JSON, so a criterion can assert against
  // a whole nested value without a second expectation kind for it.
  return JSON.stringify(value) ?? '';
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
