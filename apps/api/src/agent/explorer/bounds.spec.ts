import {
  absoluteUrl,
  BudgetTracker,
  isAllowedUrl,
  isDestructive,
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
});
