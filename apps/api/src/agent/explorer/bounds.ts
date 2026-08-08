/**
 * What the explorer is not allowed to do.
 *
 * Every rule here is a pure function, for one reason: these are the only things
 * standing between a language model and a live application it was not scripted
 * against. A bound expressed as prompt text is a request. A bound expressed as
 * a function that returns false is a bound.
 *
 * They are also the part most worth testing, and they can be tested without a
 * browser, a model, or a network.
 */

/**
 * Controls the explorer will not activate, by accessible name.
 *
 * Deliberately broad, and deliberately biased towards refusing. The cost of
 * wrongly refusing is one unexplored path; the cost of wrongly allowing is a
 * deleted account on somebody's staging environment — or worse, on something
 * that turned out not to be staging.
 */
const DESTRUCTIVE = new RegExp(
  [
    'delete',
    'remove',
    'destroy',
    'erase',
    'wipe',
    'purge',
    'drop',
    'deactivate',
    'terminate',
    'revoke',
    'cancel subscription',
    'cancel plan',
    'close account',
    'delete account',
    'reset',
    'restore defaults',
    'factory',
    'unsubscribe',
    'archive',
    'ban',
    'suspend',
    'log ?out',
    'sign ?out',
  ].join('|'),
  'i',
);

/**
 * Signing out is not destructive, but it ends the session the exploration is
 * running in and every subsequent turn explores a login page. It is on the list
 * for that reason rather than for safety.
 */
export function isDestructive(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return false;
  return DESTRUCTIVE.test(name);
}

/**
 * Same-origin only.
 *
 * Scoped to the origin rather than to a path prefix: a login redirect to `/auth`
 * is part of exploring an application, while a "Contact us" link to a support
 * vendor is somebody else's website and nothing there is under test.
 */
export function isAllowedUrl(candidate: string, baseUrl: string): boolean {
  try {
    return new URL(candidate).origin === new URL(baseUrl).origin;
  } catch {
    // Unparseable is not allowed. A relative URL is resolved by the caller
    // against the current page before it reaches here.
    return false;
  }
}

/** Resolves what the model asked for against where the browser currently is. */
export function absoluteUrl(value: string, currentUrl: string): string | null {
  try {
    return new URL(value, currentUrl).toString();
  } catch {
    return null;
  }
}

export interface Budget {
  maxSteps: number;
  maxLlmCalls: number;
  maxDurationMs: number;
}

export type BudgetBreach = 'STEP_BUDGET' | 'TIME_BUDGET' | 'MODEL_BUDGET';

/**
 * Tracks what has been spent, and answers one question: may it continue.
 *
 * Wall-clock is checked as well as step count because a single turn can block
 * for a long time — a slow page, a model retry — and "twelve steps" is not a
 * bound on anything if each one may take a minute.
 */
export class BudgetTracker {
  private steps = 0;
  private llmCalls = 0;

  constructor(
    private readonly budget: Budget,
    private readonly startedAt: number = Date.now(),
  ) {}

  get stepsTaken(): number {
    return this.steps;
  }

  spendStep(): void {
    this.steps += 1;
  }

  spendLlmCall(): void {
    this.llmCalls += 1;
  }

  /** Null while there is room left; otherwise which ceiling was reached. */
  breach(now: number = Date.now()): BudgetBreach | null {
    if (this.steps >= this.budget.maxSteps) return 'STEP_BUDGET';
    if (this.llmCalls >= this.budget.maxLlmCalls) return 'MODEL_BUDGET';
    if (now - this.startedAt >= this.budget.maxDurationMs) return 'TIME_BUDGET';
    return null;
  }
}
