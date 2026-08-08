import { chromium, type Browser, type Page } from 'playwright';
import type { TargetHints } from '@agentx/shared';
import { ResolverService } from './../src/resolver/resolver.service';

/**
 * The resolver ladder, against a real browser.
 *
 * The property under test is the strict one: a rung wins only on **exactly one**
 * visible, enabled element. Everything downstream — verification, diagnosis,
 * healing — assumes the run acted on the element the step meant, and this is
 * the only thing enforcing that.
 */
describe('Action resolver (e2e)', () => {
  let browser: Browser;
  let page: Page;
  const resolver = new ResolverService();

  const hints = (partial: Partial<TargetHints> = {}): TargetHints => ({
    selectorCandidates: [],
    ...partial,
  });

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page?.close();
  });

  it('prefers role and name — the way a human describes a control', async () => {
    await page.setContent(`
      <button data-testid="submit">Sign in</button>
    `);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Sign in', testId: 'submit' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('ROLE_NAME');
    expect(result.candidateCount).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('falls to the test id when role and name are absent', async () => {
    await page.setContent(`<button data-testid="submit">Go</button>`);

    const result = await resolver.resolve(page, hints({ testId: 'submit' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('TEST_ID');
  });

  it('uses a stored selector before anything else when knowledge has one', async () => {
    await page.setContent(`
      <button id="known" data-testid="submit">Sign in</button>
    `);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Sign in', testId: 'submit' }),
      { knownSelector: '#known' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rung 1: what worked last time is tried first, and costs one query.
    expect(result.strategy).toBe('KNOWLEDGE');
  });

  it('skips a stale stored selector and carries on down the ladder', async () => {
    await page.setContent(`<button data-testid="submit">Sign in</button>`);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Sign in' }),
      { knownSelector: '#no-longer-exists', timeoutMs: 800 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('ROLE_NAME');
  });

  it('refuses to guess between two equally valid matches', async () => {
    await page.setContent(`
      <div role="toolbar"><button>Save</button></div>
      <div role="dialog"><button>Save</button></div>
    `);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Save' }),
      { timeoutMs: 800 },
    );

    // Two visible Save buttons. Picking one would be a coin flip that looks
    // like a pass.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Could not uniquely identify');
    expect(result.attempted.some((entry) => entry.matched === 2)).toBe(true);
  });

  it('resolves when only one of several matches is visible', async () => {
    // Via CSS on purpose. getByRole consults the accessibility tree, which
    // already excludes hidden elements, so a hidden button never even reaches
    // the visibility filter — only the raw strategies can produce this case.
    await page.setContent(`
      <button class="save" style="display:none">Save</button>
      <button class="save">Save</button>
    `);

    const result = await resolver.resolve(
      page,
      hints({
        selectorCandidates: [{ strategy: 'CSS', value: '.save', score: 0.9 }],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('CSS');
    // It matched two, and visibility settled it — recorded as a weaker result
    // than a match that was unique to begin with.
    expect(result.candidateCount).toBe(2);
    expect(result.confidence).toBeLessThan(0.4);
  });

  it('does not even see hidden elements when matching by role', async () => {
    await page.setContent(`
      <button style="display:none">Save</button>
      <button>Save</button>
    `);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Save' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Not ambiguous: the hidden one is not in the accessibility tree at all.
    expect(result.candidateCount).toBe(1);
  });

  it('ignores a disabled element rather than clicking it', async () => {
    await page.setContent(`
      <button disabled>Save</button>
      <button>Save</button>
    `);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Save' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.locator.isEnabled()).resolves.toBe(true);
  });

  it('waits for an element that has not rendered yet', async () => {
    await page.setContent(`<div id="root"></div>`);

    // Appears after the first pass of the ladder has already failed.
    void page.evaluate(() => {
      setTimeout(() => {
        const button = document.createElement('button');
        button.textContent = 'Sign in';
        document.getElementById('root')?.appendChild(button);
      }, 700);
    });

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Sign in' }),
      { timeoutMs: 4000 },
    );

    expect(result.ok).toBe(true);
  });

  it('falls back to a CSS candidate, highest score first', async () => {
    await page.setContent(`<div class="odd-one"><span>x</span></div>`);

    const result = await resolver.resolve(
      page,
      hints({
        selectorCandidates: [
          { strategy: 'CSS', value: '.does-not-exist', score: 0.9 },
          { strategy: 'CSS', value: '.odd-one', score: 0.3 },
        ],
      }),
      { timeoutMs: 800 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe('CSS');
    expect(result.selector).toBe('.odd-one');
  });

  it('survives an invalid selector instead of crashing the run', async () => {
    await page.setContent(`<button>Sign in</button>`);

    const result = await resolver.resolve(
      page,
      hints({
        role: 'button',
        name: 'Sign in',
        selectorCandidates: [
          { strategy: 'CSS', value: '<<not a selector>>', score: 0.9 },
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('explains what it tried when nothing matches', async () => {
    await page.setContent(`<p>nothing here</p>`);

    const result = await resolver.resolve(
      page,
      hints({ role: 'button', name: 'Sign in', testId: 'submit' }),
      { timeoutMs: 600 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A failure a human cannot act on is barely better than a green run.
    expect(result.message).toContain('Sign in');
    expect(result.attempted.map((entry) => entry.strategy)).toEqual(
      expect.arrayContaining(['ROLE_NAME', 'TEST_ID']),
    );
  });

  /**
   * The landmark rungs.
   *
   * A landmark is the only hint that can *resolve* an ambiguity rather than
   * merely refuse it, which is why the healer's proposals are allowed to add
   * one. If the ladder ignored it, the healer would have nothing to offer that
   * the LLM rung had not already tried.
   */
  describe('landmark scoping', () => {
    const twoDialogs = `
      <div role="dialog" aria-label="Delete account"><button>Save</button></div>
      <div role="dialog" aria-label="Preferences"><button>Save</button></div>
    `;

    it('tells apart two identical controls in different landmarks', async () => {
      await page.setContent(twoDialogs);

      const result = await resolver.resolve(
        page,
        hints({
          role: 'button',
          name: 'Save',
          landmark: 'dialog "Preferences"',
        }),
        { timeoutMs: 800 },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.strategy).toBe('ROLE_NAME');
      // Scoped, so it matched one rather than two — the whole point.
      expect(result.candidateCount).toBe(1);
      await expect(
        result.locator.evaluate((el) =>
          el.closest('[role="dialog"]')?.getAttribute('aria-label'),
        ),
      ).resolves.toBe('Preferences');
    });

    it('records a scoped match as a selector that can be replayed', async () => {
      await page.setContent(twoDialogs);

      const result = await resolver.resolve(
        page,
        hints({
          role: 'button',
          name: 'Save',
          landmark: 'dialog "Preferences"',
        }),
        { timeoutMs: 800 },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Rung 1 replays this string verbatim on the next run. A description
      // that merely reads like a selector is the bug this guards against.
      expect(result.selector).toBe(
        'role=dialog[name="Preferences"] >> role=button[name="Save"]',
      );
      await expect(page.locator(result.selector).count()).resolves.toBe(1);
    });

    it('still finds the control when the landmark itself was redesigned away', async () => {
      await page.setContent(`<button>Save</button>`);

      const result = await resolver.resolve(
        page,
        hints({
          role: 'button',
          name: 'Save',
          landmark: 'dialog "Preferences"',
        }),
        { timeoutMs: 800 },
      );

      // The scoped attempt matched nothing and the unscoped one carried the
      // step. A narrowing hint that has gone stale must not fail a step whose
      // target is plainly still there.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.selector).toBe('role=button[name="Save"]');
    });

    it('maps a tag-named landmark onto the role it actually has', async () => {
      await page.setContent(`
        <nav aria-label="Primary"><a href="/a">Home</a></nav>
        <main><a href="/b">Home</a></main>
      `);

      const result = await resolver.resolve(
        page,
        hints({ role: 'link', name: 'Home', landmark: 'nav "Primary"' }),
        { timeoutMs: 800 },
      );

      // The recorder writes the tag when the element carries no explicit role;
      // `role=nav` would match nothing at all.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.selector).toContain('role=navigation');
    });

    it('ignores a landmark it cannot parse rather than failing the step', async () => {
      await page.setContent(`<button>Save</button>`);

      const result = await resolver.resolve(
        page,
        hints({ role: 'button', name: 'Save', landmark: '>>> nonsense' }),
        { timeoutMs: 600 },
      );

      expect(result.ok).toBe(true);
    });
  });

  it('says so plainly when a step carries no hints at all', async () => {
    await page.setContent(`<button>Sign in</button>`);

    const result = await resolver.resolve(page, hints(), { timeoutMs: 400 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('no usable targeting hints');
  });
});
