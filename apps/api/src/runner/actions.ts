import type { Locator, Page } from 'playwright';
import type { ActionType, StepData } from '@agentx/shared';
import type { ResolvedCredentials } from '../credentials/credentials.service';

/** Actions that need an element; the rest operate on the page. */
export const NEEDS_TARGET: ReadonlySet<ActionType> = new Set<ActionType>([
  'CLICK',
  'FILL',
  'SELECT',
  'HOVER',
  'UPLOAD',
]);

export class UnresolvedDataError extends Error {}

/**
 * Turns a step's `data` into the string to type.
 *
 * An `ENV_REF` is resolved from the credentials the run already loaded, so the
 * value exists only for the moment it is typed and never enters a row, a log,
 * or a prompt.
 */
export function resolveData(
  data: StepData | null,
  credentials: ResolvedCredentials,
): string | null {
  if (data === null) return null;

  if (data.kind === 'LITERAL') return data.value;

  const known: Record<string, string | undefined> = {
    ...credentials.extra,
    ...(credentials.username === undefined
      ? {}
      : { username: credentials.username }),
    ...(credentials.password === undefined
      ? {}
      : { password: credentials.password }),
  };

  // Match by the variable name the spec references, or by role when the
  // environment names it differently.
  const value =
    process.env[data.envVar] ??
    known[data.envVar] ??
    (/pass/i.test(data.envVar) ? credentials.password : undefined) ??
    (/user|email|login/i.test(data.envVar) ? credentials.username : undefined);

  if (value === undefined) {
    throw new UnresolvedDataError(
      `This step needs ${data.envVar}, which is not set and is not one of the environment's credentials.`,
    );
  }

  return value;
}

/**
 * Performs one step against the page.
 *
 * Every locator call carries the step's timeout: Playwright auto-waits, and a
 * step that hangs forever is worse than one that fails with a reason.
 */
export async function performAction(
  page: Page,
  action: ActionType,
  locator: Locator | null,
  value: string | null,
  options: { timeoutMs: number; fallbackUrl: string },
): Promise<void> {
  const timeout = options.timeoutMs;

  switch (action) {
    case 'NAVIGATE':
      await page.goto(value ?? options.fallbackUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      return;

    case 'CLICK':
      await required(locator).click({ timeout });
      return;

    case 'FILL':
      await required(locator).fill(value ?? '', { timeout });
      return;

    case 'SELECT':
      // By visible label first — that is what the recorder captured, and what a
      // human would say they chose.
      try {
        await required(locator).selectOption(
          { label: value ?? '' },
          { timeout },
        );
      } catch {
        await required(locator).selectOption(value ?? '', { timeout });
      }
      return;

    case 'HOVER':
      await required(locator).hover({ timeout });
      return;

    case 'UPLOAD':
      await required(locator).setInputFiles(value ?? '', { timeout });
      return;

    case 'PRESS':
      await page.keyboard.press(value ?? 'Enter');
      return;

    case 'SCROLL': {
      const [x, y] = (value ?? '0,0')
        .split(',')
        .map((part) => Number(part) || 0);
      await page.evaluate(([left, top]) => window.scrollTo({ left, top }), [
        x ?? 0,
        y ?? 0,
      ] as const);
      return;
    }

    case 'WAIT':
      await page.waitForTimeout(Math.min(Number(value) || 500, timeout));
      return;

    case 'ASSERT':
      // Nothing to do: an assertion is entirely the verifier's business, and
      // in this phase it is recorded without being checked.
      return;
  }
}

function required(locator: Locator | null): Locator {
  if (locator === null) {
    throw new Error('This action needs an element, but none was resolved.');
  }

  return locator;
}
