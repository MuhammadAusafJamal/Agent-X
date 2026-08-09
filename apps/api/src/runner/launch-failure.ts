/**
 * Turns a browser-setup failure into a line someone can act on.
 *
 * Playwright's own message for a missing browser is genuinely helpful, but it
 * arrives as a multi-line block wrapped in a stack trace, and the places this
 * surfaces — a step's `error` column, a run view, an exploration result — show
 * one line. So the one class of failure that has a known fix says the fix.
 *
 * Kept pure and separate from the services so both the runner and the explorer
 * describe the same failure the same way, and so it can be tested without a
 * browser.
 */

/** Playwright's wording when a browser was never downloaded. */
const MISSING_BROWSER =
  /Executable doesn't exist|please run the following command to download new browsers|npx playwright install/i;

/** A machine that cannot open a window at all — headed mode on a bare server. */
const NO_DISPLAY = /Missing X server or \$DISPLAY|cannot open display/i;

export function describeSetupFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (MISSING_BROWSER.test(message)) {
    return "The browser could not be launched: Playwright's Chromium is not installed. Run `npm run playwright:install`, then start the run again.";
  }

  if (NO_DISPLAY.test(message)) {
    return 'The browser could not be launched: this machine has no display, and Agent X is configured to run headed. Set PLAYWRIGHT_HEADLESS=true and restart the API.';
  }

  return `The browser could not be launched: ${message}`;
}
