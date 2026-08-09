import type { Page } from 'playwright';
import type { Redactor } from '../credentials/redactor';

/**
 * How long to wait for the accessibility tree before giving up on it.
 *
 * A snapshot is an input to a prompt, never the thing being asserted. Blocking a
 * step on one is the wrong trade: the caller has a fallback for "could not read
 * the page", and none for "the step timed out reading it".
 */
const SNAPSHOT_TIMEOUT_MS = 5000;

/**
 * The cap for callers with no configuration to hand.
 *
 * Kept in step with `AGENTX_MAX_SNAPSHOT_CHARS` in `config/env.schema.ts`, so a
 * resolver constructed bare in a test behaves like one wired to the real config.
 */
export const DEFAULT_MAX_SNAPSHOT_CHARS = 6000;

/**
 * The page as a model sees it: accessibility tree, redacted, and capped.
 *
 * The accessibility tree rather than the DOM because it is an order of magnitude
 * smaller and carries the roles and names every rung of the resolver already
 * reasons in. Redacted because Playwright reports a textbox's *value*, so a
 * password typed into a real form is in the tree even though the screenshot
 * shows dots.
 *
 * The cap is the part worth understanding. It is not a safety limit, it is a
 * cost limit, and going over it is silent: the model receives the top of the
 * page and answers confidently about it. On a long marketing page that means
 * every resolution lands in the header. `AGENTX_MAX_SNAPSHOT_CHARS` exists so
 * the ceiling can follow the site rather than the other way round.
 *
 * Returns `null` when the page could not be read at all — a closed page, a
 * navigation mid-capture — so each caller keeps its own wording for that, which
 * ends up in a rationale a person reads.
 */
export async function capturePrunedSnapshot(
  page: Page,
  redactor: Redactor | undefined,
  maxChars: number,
): Promise<string | null> {
  let snapshot: string;

  try {
    snapshot = await page
      .locator('body')
      .ariaSnapshot({ timeout: SNAPSHOT_TIMEOUT_MS });
  } catch {
    return null;
  }

  if (redactor !== undefined) snapshot = redactor.redact(snapshot);

  return snapshot.length > maxChars
    ? `${snapshot.slice(0, maxChars)}\n… (truncated)`
    : snapshot;
}
