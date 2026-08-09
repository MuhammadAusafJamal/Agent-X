import {
  absoluteUrl,
  BudgetTracker,
  isAllowedUrl,
  isDestructive,
  isFormSubmit,
  isSideEffecting,
} from './bounds';

/**
 * The only things standing between a language model and a live application it
 * was not scripted against.
 *
 * Tested exhaustively and without a browser, because these are the rules whose
 * failure is not "a test went red" but "something irreversible happened to
 * somebody's environment".
 */
describe('Explorer bounds', () => {
  describe('destructive controls', () => {
    it.each([
      'Delete account',
      'Delete',
      'Remove item',
      'Deactivate workspace',
      'Cancel subscription',
      'Close account',
      'Reset password',
      'Revoke access',
      'Wipe data',
      'Erase everything',
      'Purge cache',
      'Terminate instance',
      'Archive project',
      'Suspend user',
      'Log out',
      'Logout',
      'Sign out',
    ])('refuses "%s"', (name) => {
      expect(isDestructive(name)).toBe(true);
    });

    it.each([
      'Sign in',
      'Continue',
      'Save',
      'Add to basket',
      'Checkout',
      'Create invoice',
      'Next',
      'Submit',
      'Search',
    ])('allows "%s"', (name) => {
      expect(isDestructive(name)).toBe(false);
    });

    it('matches regardless of case', () => {
      expect(isDestructive('DELETE ACCOUNT')).toBe(true);
    });

    it('treats an unnamed control as harmless — the name is the signal', () => {
      expect(isDestructive(null)).toBe(false);
      expect(isDestructive(undefined)).toBe(false);
    });
  });

  describe('side-effecting controls', () => {
    it.each([
      'Subscribe',
      'Sign up for our newsletter',
      'Sign up',
      'Register',
      'Submit',
      'Send message',
      'Book now',
      'Reserve a table',
      'Buy tickets',
      'Checkout',
      'Add to cart',
      'Pay now',
      'Donate',
      'Contact us',
      'Make an enquiry',
      'Apply now',
      'Request a callback',
      'Download brochure',
      'Get in touch',
      'Join the mailing list',
    ])('refuses "%s" on a read-only target', (name) => {
      expect(isSideEffecting(name)).toBe(true);
    });

    it.each([
      'Search',
      'Things to do',
      'Where to go',
      'Next',
      'Read more',
      'View map',
      'Close',
      'Sign in',
    ])('allows "%s" — it only reads', (name) => {
      expect(isSideEffecting(name)).toBe(false);
    });

    it('stays separate from the destructive list, so the two reasons differ', () => {
      // "Unsubscribe" damages state and is refused everywhere, read-only or not.
      expect(isDestructive('Unsubscribe')).toBe(true);
      // "Subscribe" damages nothing; it reaches somebody, which is a different
      // problem and only a problem on a site you do not own.
      expect(isDestructive('Subscribe')).toBe(false);
      expect(isSideEffecting('Subscribe')).toBe(true);
    });

    it('treats an unnamed control as harmless — the name is the signal', () => {
      expect(isSideEffecting(null)).toBe(false);
      expect(isSideEffecting(undefined)).toBe(false);
    });
  });

  describe('form submission', () => {
    const currentUrl = 'https://example.test/page';

    it('allows a control that is not in a form at all', () => {
      expect(
        isFormSubmit({ inForm: false, method: null, action: null, currentUrl }),
      ).toBe(false);
    });

    it('allows a same-origin GET form — that is a search box, and searching reads', () => {
      expect(
        isFormSubmit({
          inForm: true,
          method: 'GET',
          action: '/search',
          currentUrl,
        }),
      ).toBe(false);

      expect(
        isFormSubmit({ inForm: true, method: null, action: '', currentUrl }),
      ).toBe(false);
    });

    it('refuses any POST, whatever the button is called', () => {
      // The case a word list cannot catch: a newsletter signup whose button
      // says "Continue".
      expect(
        isFormSubmit({
          inForm: true,
          method: 'post',
          action: '/newsletter',
          currentUrl,
        }),
      ).toBe(true);
    });

    it('refuses a GET that posts to somebody else', () => {
      expect(
        isFormSubmit({
          inForm: true,
          method: 'get',
          action: 'https://mailinglist.example.com/join',
          currentUrl,
        }),
      ).toBe(true);
    });

    it('refuses an action it cannot parse rather than guessing', () => {
      expect(
        isFormSubmit({
          inForm: true,
          method: 'get',
          action: 'http://',
          currentUrl: 'not a url',
        }),
      ).toBe(true);
    });
  });

  describe('origin allowlist', () => {
    const base = 'http://localhost:4321';

    it('allows any path on the same origin', () => {
      expect(isAllowedUrl('http://localhost:4321/checkout', base)).toBe(true);
      // A login redirect to a sibling path is part of exploring an application.
      expect(isAllowedUrl('http://localhost:4321/auth/login', base)).toBe(true);
    });

    it('refuses another origin, however similar', () => {
      expect(isAllowedUrl('http://localhost:4322/', base)).toBe(false);
      expect(isAllowedUrl('https://localhost:4321/', base)).toBe(false);
      expect(isAllowedUrl('http://evil.example.com/', base)).toBe(false);
    });

    it('refuses a host that merely starts the same way', () => {
      expect(isAllowedUrl('http://localhost:4321.evil.com/', base)).toBe(false);
    });

    it('refuses anything unparseable rather than guessing', () => {
      expect(isAllowedUrl('javascript:alert(1)', base)).toBe(false);
      expect(isAllowedUrl('/checkout', base)).toBe(false);
      expect(isAllowedUrl('', base)).toBe(false);
    });

    it('resolves a relative URL against the current page before judging it', () => {
      const resolved = absoluteUrl('/checkout', 'http://localhost:4321/cart');

      expect(resolved).toBe('http://localhost:4321/checkout');
      expect(isAllowedUrl(resolved!, base)).toBe(true);
    });

    it('does not let a relative resolution escape the origin', () => {
      const resolved = absoluteUrl(
        '//evil.example.com/',
        'http://localhost:4321/cart',
      );

      expect(isAllowedUrl(resolved!, base)).toBe(false);
    });
  });

  describe('budgets', () => {
    const budget = {
      maxSteps: 3,
      maxLlmCalls: 5,
      maxDurationMs: 1000,
    };

    it('allows work while there is room', () => {
      const tracker = new BudgetTracker(budget, 0);

      expect(tracker.breach(0)).toBeNull();
      tracker.spendStep();
      expect(tracker.breach(0)).toBeNull();
    });

    it('stops at the step ceiling', () => {
      const tracker = new BudgetTracker(budget, 0);

      for (let i = 0; i < 3; i += 1) tracker.spendStep();

      expect(tracker.breach(0)).toBe('STEP_BUDGET');
      expect(tracker.stepsTaken).toBe(3);
    });

    it('stops at the model ceiling', () => {
      const tracker = new BudgetTracker(budget, 0);

      for (let i = 0; i < 5; i += 1) tracker.spendLlmCall();

      expect(tracker.breach(0)).toBe('MODEL_BUDGET');
    });

    it('stops on wall-clock even when no step has been taken', () => {
      // A single turn can block for a long time on a slow page or a model
      // retry, so a step count is not a bound on anything by itself.
      const tracker = new BudgetTracker(budget, 0);

      expect(tracker.breach(1500)).toBe('TIME_BUDGET');
    });
  });

  describe('action throttle', () => {
    const budget = {
      maxSteps: 10,
      maxLlmCalls: 10,
      maxDurationMs: 60_000,
      minActionIntervalMs: 1500,
    };

    it('does not wait before the first action', async () => {
      const tracker = new BudgetTracker(budget, 0);
      const startedAt = Date.now();

      await tracker.throttle();

      expect(Date.now() - startedAt).toBeLessThan(100);
    });

    it('waits out the remainder of the interval, not the whole of it', async () => {
      const tracker = new BudgetTracker({
        ...budget,
        minActionIntervalMs: 120,
      });

      await tracker.throttle();
      const startedAt = Date.now();
      await tracker.throttle();

      const waited = Date.now() - startedAt;

      expect(waited).toBeGreaterThanOrEqual(80);
      expect(waited).toBeLessThan(400);
    });

    it('is a no-op when no interval is configured', async () => {
      const tracker = new BudgetTracker({
        maxSteps: 10,
        maxLlmCalls: 10,
        maxDurationMs: 60_000,
      });

      const startedAt = Date.now();

      await tracker.throttle();
      await tracker.throttle();
      await tracker.throttle();

      expect(Date.now() - startedAt).toBeLessThan(100);
    });
  });
});
