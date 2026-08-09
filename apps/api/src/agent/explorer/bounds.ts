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
 * Controls that do something to the world outside the browser.
 *
 * `DESTRUCTIVE` is about damage to the application under test. This is about
 * *reach*: a newsletter signup, a contact form, an enquiry, a booking. Nothing
 * here breaks the site, and on your own staging environment none of it matters
 * much — a stray subscription is a row you can delete.
 *
 * It matters on a site you do not own. An exploration that fills an email field
 * and clicks "Subscribe" has put a real address into a real mailing list, and no
 * amount of tidying afterwards unsends the confirmation. There is no way to try
 * that and find out, which is why it is refused rather than attempted.
 *
 * Kept apart from `DESTRUCTIVE` so the two reasons stay distinguishable in the
 * refusal trail a report renders: "would have damaged something" and "would have
 * contacted somebody" are different things for a person to read.
 */
const SIDE_EFFECTING = new RegExp(
  [
    'subscribe',
    'sign ?up',
    'register',
    'submit',
    '\\bsend\\b',
    'book(ing)?\\b',
    'reserve',
    '\\bbuy\\b',
    'checkout',
    'add to (cart|basket|bag)',
    '\\bpay\\b',
    'donate',
    'contact',
    'enquir',
    'inquir',
    '\\bapply\\b',
    'request',
    'newsletter',
    'download',
    'get in touch',
    'join',
  ].join('|'),
  'i',
);

export function isSideEffecting(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return false;
  return SIDE_EFFECTING.test(name);
}

/**
 * Whether activating this control would submit a form somewhere.
 *
 * A name-based rule catches the honest cases; this catches the ones named
 * "Continue" or "→". The DOM facts are read by the caller — a pure predicate
 * cannot query a page — and handed over here so the rule itself stays testable
 * without a browser.
 *
 * A same-origin `GET` form is exempt: that is a search box, and searching is
 * reading. Everything else is treated as a submission, including a form with no
 * `action` at all, because a JavaScript handler is the most common way a real
 * site posts a newsletter signup and it leaves no attribute behind.
 */
export function isFormSubmit(form: {
  inForm: boolean;
  method: string | null;
  action: string | null;
  currentUrl: string;
}): boolean {
  if (!form.inForm) return false;

  const method = (form.method ?? 'get').toLowerCase();

  if (method !== 'get') return true;

  // A GET form that posts elsewhere is still somebody else's endpoint.
  if (form.action === null || form.action === '') return false;

  try {
    return (
      new URL(form.action, form.currentUrl).origin !==
      new URL(form.currentUrl).origin
    );
  } catch {
    return true;
  }
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
  /**
   * Shortest gap between two actions against the site.
   *
   * Zero on a local application, where politeness is not a concept. Set on a
   * site you do not own: an agent that clicks as fast as the page will answer is
   * indistinguishable from something worth blocking, and being blocked is the
   * one failure this tool cannot diagnose its way out of.
   */
  minActionIntervalMs?: number;
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
  private lastActionAt: number | null = null;

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

  /**
   * Waits until enough time has passed since the last action, then marks now.
   *
   * Lives here rather than as a sleep at each call site because the tracker is
   * already the thing that owns wall-clock, and because a rate limit expressed
   * in three places is a rate limit that will be three different numbers within
   * a month. Wall-clock spent waiting still counts against `maxDurationMs` —
   * throttling makes a walk slower, not longer-lived.
   */
  async throttle(now: number = Date.now()): Promise<void> {
    const interval = this.budget.minActionIntervalMs ?? 0;

    if (interval > 0 && this.lastActionAt !== null) {
      const wait = this.lastActionAt + interval - now;

      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }

    this.lastActionAt = Date.now();
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
