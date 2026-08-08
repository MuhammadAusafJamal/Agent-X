import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { capturedEventSchema, type CapturedEvent } from '@agentx/shared';
import { captureBundle } from './../src/recorder/capture-bundle';

/**
 * The capture script, against a real browser and the real demo app.
 *
 * This is the riskiest code in the recorder: it runs inside the page, cannot be
 * imported into a unit test meaningfully, and everything downstream — the
 * compiled spec, the resolver's fallbacks — is built on what it produces. So it
 * is exercised the way it actually runs.
 */
describe('capture bundle (e2e)', () => {
  const PORT = 4399;
  const BASE = `http://localhost:${PORT}`;

  let app: ChildProcess;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let captured: CapturedEvent[] = [];

  beforeAll(async () => {
    app = spawn(
      process.execPath,
      [
        path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'examples',
          'demo-app',
          'server.js',
        ),
      ],
      { env: { ...process.env, DEMO_PORT: String(PORT) }, stdio: 'pipe' },
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('demo app did not start')),
        10_000,
      );
      app.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('Demo app on')) {
          clearTimeout(timer);
          resolve();
        }
      });
      app.on('error', reject);
    });

    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    app?.kill();
  });

  beforeEach(async () => {
    captured = [];
    context = await browser.newContext();

    await context.exposeBinding(
      '__agentx_emit',
      (_source, payload: unknown) => {
        // Parsed exactly as the service parses it, so the test fails if the
        // script ever emits a shape the server would reject.
        const result = capturedEventSchema.safeParse(payload);
        if (result.success) captured.push(result.data);
      },
    );

    await context.addInitScript(captureBundle);
    page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  });

  afterEach(async () => {
    await context?.close();
  });

  /** Input is debounced in-page, so give it time to flush. */
  const settle = () => page.waitForTimeout(600);

  const ofType = (type: string) => captured.filter((e) => e.type === type);

  it('collapses a typed value into one event, not one per keystroke', async () => {
    await page.fill('#email', 'demo@example.com');
    await settle();

    const inputs = ofType('INPUT').filter((e) => e.targetName === 'Email');

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.value).toBe('demo@example.com');
  });

  it('captures role, accessible name, test id, and landmark for a click', async () => {
    await page.click('[data-testid="login-submit"]');
    await settle();

    const click = ofType('CLICK').at(-1);

    expect(click?.targetRole).toBe('button');
    expect(click?.targetName).toBe('Sign in');
    expect(click?.targetTestId).toBe('login-submit');
    // "the Sign in form", not "the third button on the page".
    expect(click?.landmark).toBe('form "Sign in"');
  });

  it("resolves an input's name from its <label for>", async () => {
    await page.fill('#password', 'hunter2');
    await settle();

    expect(ofType('INPUT').at(-1)?.targetName).toBe('Password');
  });

  it('never captures the value of a password field', async () => {
    await page.fill('#password', 'hunter2');
    await settle();

    const input = ofType('INPUT').at(-1);

    expect(input?.isSecret).toBe(true);
    expect(input?.value).toBeUndefined();
    // Belt and braces: the string must not appear anywhere in the payload.
    expect(JSON.stringify(captured)).not.toContain('hunter2');
  });

  it('ranks a test id above every other selector candidate', async () => {
    await page.click('[data-testid="login-submit"]');
    await settle();

    const candidates = ofType('CLICK').at(-1)?.selectorCandidates ?? [];
    const best = [...candidates].sort((a, b) => b.score - a.score)[0];

    expect(best?.strategy).toBe('TEST_ID');
    expect(best?.value).toBe('login-submit');
    // A CSS path is kept, but as a last resort.
    expect(candidates.some((c) => c.strategy === 'CSS')).toBe(true);
  });

  it('captures a select by its option text, not its value', async () => {
    // Driven by keyboard rather than page.selectOption: that helper dispatches
    // synthetic events, which the recorder deliberately ignores. A human
    // choosing an option produces trusted ones, so this is the real path.
    await page.focus('#account-type');
    await page.keyboard.press('ArrowDown');
    await settle();

    const select = ofType('SELECT').at(-1);

    expect(select?.targetName).toBe('Account type');
    // The human picked "Business"; the underlying value is "business".
    expect(select?.value).toBe('Business');
  });

  it('ignores events the application fired itself', async () => {
    // A page that dispatches its own clicks would otherwise pollute the
    // recording with actions the human never took.
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="login-submit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(ofType('CLICK')).toHaveLength(0);
  });

  it('flushes a pending value before the click that submits it', async () => {
    await page.fill('#email', 'demo@example.com');
    await page.click('[data-testid="login-submit"]');
    await settle();

    const types = captured.map((e) => e.type);
    const input = types.indexOf('INPUT');
    const click = types.indexOf('CLICK');

    // Order is the whole point: a spec that clicks before typing is useless.
    expect(input).toBeGreaterThanOrEqual(0);
    expect(click).toBeGreaterThan(input);
  });

  it('keeps capturing after a full page navigation', async () => {
    await page.fill('#email', 'demo@example.com');
    await page.fill('#password', 'hunter2');
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL(/dashboard/, { timeout: 10_000 });

    captured = [];
    await page.click('[data-testid="create-invoice"]');
    await settle();

    // The init script is re-injected on every document, so the recording
    // survives the login redirect.
    expect(ofType('CLICK').at(-1)?.targetName).toBe('Create invoice');
  });

  it('collapses a scroll burst into a single event', async () => {
    await page.evaluate(() => {
      document.body.style.height = '3000px';
      window.scrollTo(0, 100);
      window.scrollTo(0, 400);
      window.scrollTo(0, 900);
    });
    await settle();

    expect(ofType('SCROLL')).toHaveLength(1);
  });

  it('records meaningful keys but not ordinary typing', async () => {
    await page.click('#email');
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    await settle();

    const keys = ofType('KEY');

    expect(keys.map((k) => k.value)).toEqual(['Enter']);
  });
});
