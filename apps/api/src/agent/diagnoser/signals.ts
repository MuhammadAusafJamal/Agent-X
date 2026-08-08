import type {
  ActionType,
  ConsoleEntry,
  DiagnosisResult,
  NetworkEntry,
} from '@agentx/shared';

/**
 * The evidence a failed step leaves behind, and what can be concluded from it
 * without asking anything.
 *
 * Pure on purpose. Classification is the load-bearing decision of Phase 6 — it
 * decides whether a failure gets healed or filed as a defect — so the part of it
 * that can be settled by looking at a status code is settled by looking at a
 * status code, where it is cheap, instant, and unit-testable.
 */

export interface FailureContext {
  intent: string;
  /** How the specification described the target, in natural language. */
  targetDescription?: string | null;
  action: ActionType;
  /** Where the browser was when the step failed. */
  url: string;
  /** The error recorded on the step: a resolution failure, or a thrown action. */
  error: string | null;
  /** The verifier's reason, when the action ran but the outcome was wrong. */
  verifierRationale: string | null;
  /** True when the step never found its target, so nothing was acted on. */
  unresolvedTarget: boolean;
  network: NetworkEntry[];
  console: ConsoleEntry[];
}

export interface Signals {
  /** Responses the server itself failed on. */
  serverErrors: NetworkEntry[];
  /** The page was refused rather than served — 4xx on a document request. */
  loadRejected: NetworkEntry[];
  consoleErrors: ConsoleEntry[];
  /** The browser could not reach the site at all. */
  navigationFailed: boolean;
  unresolvedTarget: boolean;
  /** The action ran and the outcome was judged wrong. */
  verificationFailed: boolean;
}

/**
 * Transport-level failures, which mean the application was never reached.
 *
 * Deliberately only the unambiguous codes. A navigation *timeout* is not in
 * here: a site that takes 40 seconds to answer is an application problem, and
 * calling it an environment problem is how a real defect gets waved through as
 * someone else's infrastructure.
 */
const UNREACHABLE =
  /net::ERR_|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

export function collectSignals(context: FailureContext): Signals {
  return {
    serverErrors: context.network.filter((entry) => (entry.status ?? 0) >= 500),
    loadRejected: context.network.filter(
      (entry) =>
        entry.resourceType === 'document' &&
        (entry.status ?? 0) >= 400 &&
        (entry.status ?? 0) < 500,
    ),
    consoleErrors: context.console.filter((entry) => entry.type === 'error'),
    navigationFailed: context.error !== null && UNREACHABLE.test(context.error),
    unresolvedTarget: context.unresolvedTarget,
    verificationFailed:
      !context.unresolvedTarget && context.verifierRationale !== null,
  };
}

/**
 * The diagnosis the evidence settles on its own, or null to ask the model.
 *
 * Order matters, and it is not the order of confidence — it is the order of
 * consequence. A 500 outranks an unresolvable target because the expensive
 * mistake in this system runs one way: healing a step whose real problem was a
 * broken server produces a green run over a broken application. Refusing to
 * heal something that turned out to be drift merely wastes a review.
 */
export function classifyDeterministically(
  signals: Signals,
): DiagnosisResult | null {
  if (signals.navigationFailed) {
    return {
      diagnosis: 'ENVIRONMENT',
      confidence: 0.95,
      rationale:
        'The browser could not reach the application at all, so nothing about the test was exercised.',
    };
  }

  if (signals.serverErrors.length > 0) {
    const worst = signals.serverErrors[0];

    return {
      diagnosis: 'APP_BUG',
      confidence: 0.9,
      rationale: `${worst.method} ${worst.url} returned ${worst.status ?? 'a server error'} during this step. The test asked the application to do something and the application failed to do it.`,
    };
  }

  if (signals.loadRejected.length > 0) {
    const refused = signals.loadRejected[0];

    return {
      diagnosis: 'ENVIRONMENT',
      confidence: 0.8,
      rationale: `The page itself was refused: ${refused.method} ${refused.url} returned ${refused.status ?? 'a client error'}. That is access or configuration, not a broken test.`,
    };
  }

  // Everything else — an unresolvable target on a healthy page, an outcome that
  // is merely wrong — needs judgement about whether the application or the
  // specification is the thing that moved.
  return null;
}

/**
 * A one-line summary of the evidence, for the prompt.
 *
 * The model is given the signals rather than left to infer them from raw logs:
 * it is being asked to judge *which side moved*, and that judgement is better
 * when the arithmetic has already been done for it.
 */
export function describeSignals(signals: Signals): string {
  const lines = [
    `target resolved: ${signals.unresolvedTarget ? 'no — the step never found what it was looking for' : 'yes'}`,
    `outcome verified: ${signals.verificationFailed ? 'no — the action ran but the result was judged wrong' : 'not reached'}`,
    `server errors this step: ${signals.serverErrors.length}`,
    `console errors this step: ${
      signals.consoleErrors.length === 0
        ? '0'
        : `${signals.consoleErrors.length} — ${signals.consoleErrors
            .slice(0, 3)
            .map((entry) => entry.text)
            .join(' | ')}`
    }`,
  ];

  return lines.join('\n');
}
