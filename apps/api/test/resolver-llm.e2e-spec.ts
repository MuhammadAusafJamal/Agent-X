import { chromium, type Browser, type Page } from 'playwright';
import type { ElementChoice, TargetHints } from '@agentx/shared';
import { ResolverService } from './../src/resolver/resolver.service';
import type { LlmService } from './../src/llm/llm.service';

/**
 * Rung 6 of the ladder: the model, when everything free has failed.
 *
 * The model is stubbed here on purpose. What needs pinning down is not whether
 * a real model picks well — that was confirmed by hand against a live key — but
 * the *contract* around it: that it is asked only as a last resort, that it is
 * never asked without permission, and above all that its answer is checked
 * rather than trusted.
 */
describe('Resolver, LLM rung (e2e)', () => {
  let browser: Browser;
  let page: Page;

  /** What the stubbed model "chooses", and how often it was asked. */
  let choice: ElementChoice;
  let calls = 0;

  const llm = {
    structured: () => {
      calls += 1;
      return Promise.resolve(choice);
    },
  } as unknown as LlmService;

  const resolver = new ResolverService(llm);

  const hints = (partial: Partial<TargetHints> = {}): TargetHints => ({
    selectorCandidates: [],
    ...partial,
  });

  /** What the spec recorded, against a page where none of it matches any more. */
  const staleHints = hints({
    role: 'button',
    name: 'Sign in',
    testId: 'login-submit',
    text: 'Sign in',
  });

  const permission = {
    intent: 'submit the sign-in form',
    targetDescription: 'the primary submit button in the sign-in form',
    executionId: 'exec-1',
  };

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    calls = 0;
    choice = {
      found: true,
      role: 'button',
      name: 'Continue',
      rationale:
        'The submit button in the sign-in form is now labelled Continue.',
    };
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page?.close();
  });

  /** The redesigned page: same control, new label, new test id. */
  const renamedPage = `
    <h1>Sign in</h1>
    <form aria-label="Sign in">
      <button data-testid="continue-cta">Continue</button>
    </form>
  `;

  it('finds the renamed control the deterministic rungs could not', async () => {
    await page.setContent(renamedPage);

    const result = await resolver.resolve(page, staleHints, {
      timeoutMs: 600,
      llm: permission,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('LLM');
    expect(result.selector).toBe('role=button[name="Continue"]');
    expect(calls).toBe(1);
  });

  it('is never asked when a deterministic rung succeeds', async () => {
    await page.setContent(
      `<button data-testid="login-submit">Sign in</button>`,
    );

    const result = await resolver.resolve(page, staleHints, {
      llm: permission,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('ROLE_NAME');
    // The expensive rung stays unspent whenever a free one can answer.
    expect(calls).toBe(0);
  });

  it('is never asked without explicit permission', async () => {
    await page.setContent(renamedPage);

    // No `llm` option: this is the path the verifier's visibility checks take,
    // and it must not quietly spend a model call per step.
    const result = await resolver.resolve(page, staleHints, { timeoutMs: 400 });

    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('is asked at most once, however long the ladder retried', async () => {
    await page.setContent(renamedPage);

    await resolver.resolve(page, staleHints, {
      // Long enough for several deterministic passes.
      timeoutMs: 1200,
      llm: permission,
    });

    expect(calls).toBe(1);
  });

  it('fails the step when the model says the target is not there', async () => {
    choice = {
      found: false,
      role: null,
      name: null,
      rationale: 'There is no submit control on this page.',
    };

    await page.setContent(`<p>Nothing here</p>`);

    const result = await resolver.resolve(page, staleHints, {
      timeoutMs: 400,
      llm: permission,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The model's reason is kept, so the failure explains itself.
    expect(
      result.attempted.some(
        (entry) =>
          entry.strategy === 'LLM' && entry.selector.includes('no submit'),
      ),
    ).toBe(true);
  });

  it('refuses an element the model invented', async () => {
    choice = {
      found: true,
      role: 'button',
      name: 'Definitely Not On This Page',
      rationale: 'confidently wrong',
    };

    await page.setContent(renamedPage);

    const result = await resolver.resolve(page, staleHints, {
      timeoutMs: 400,
      llm: permission,
    });

    // The model's answer faces the same uniqueness rule as every other rung, so
    // a hallucinated control fails the step instead of steering a click.
    expect(result.ok).toBe(false);
  });

  it('refuses an ambiguous choice rather than picking one', async () => {
    choice = {
      found: true,
      role: 'button',
      name: 'Save',
      rationale: 'either of these will do',
    };

    await page.setContent(`
      <div role="toolbar"><button>Save</button></div>
      <div role="dialog"><button>Save</button></div>
    `);

    const result = await resolver.resolve(page, staleHints, {
      timeoutMs: 400,
      llm: permission,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.attempted.some(
        (entry) => entry.strategy === 'LLM' && entry.matched === 2,
      ),
    ).toBe(true);
  });

  it('survives the model being unreachable', async () => {
    const failing = {
      structured: () => Promise.reject(new Error('model unavailable')),
    } as unknown as LlmService;

    await page.setContent(renamedPage);

    const result = await new ResolverService(failing).resolve(
      page,
      staleHints,
      { timeoutMs: 400, llm: permission },
    );

    // A dead model degrades the run to deterministic-only; it does not crash it.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Sign in');
  });

  it('is asked when a step carries no hints at all', async () => {
    await page.setContent(renamedPage);

    const result = await resolver.resolve(page, hints(), {
      timeoutMs: 400,
      llm: permission,
    });

    // Nothing deterministic to try is still a reason to ask — the description
    // is all there is — so the model *is* consulted here.
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('records the LLM rung so a decaying spec is visible in run history', async () => {
    await page.setContent(renamedPage);

    const result = await resolver.resolve(page, staleHints, {
      timeoutMs: 600,
      llm: permission,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Lower than any deterministic rung: it worked, but the spec's own hints
    // have rotted and the run history should say so.
    expect(result.confidence).toBeLessThan(0.85);
  });
});
