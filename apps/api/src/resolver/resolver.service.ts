import { Injectable, Logger } from '@nestjs/common';
import type { Locator, Page } from 'playwright';
import {
  RESOLUTION_LADDER,
  type ResolutionStrategy,
  type TargetHints,
} from '@agentx/shared';

/** One thing to try: a strategy, and the locator it produces. */
interface Candidate {
  strategy: ResolutionStrategy;
  /** Human-readable description of what was tried, stored on the step. */
  selector: string;
  locator: Locator;
}

export interface ResolutionSuccess {
  ok: true;
  locator: Locator;
  strategy: ResolutionStrategy;
  selector: string;
  /** How many elements the winning strategy matched before visibility filtering. */
  candidateCount: number;
  confidence: number;
}

export interface ResolutionFailure {
  ok: false;
  message: string;
  attempted: {
    strategy: ResolutionStrategy;
    selector: string;
    matched: number;
  }[];
}

export type Resolution = ResolutionSuccess | ResolutionFailure;

export interface ResolveOptions {
  /** Last-known-good selector for this target, from application knowledge. */
  knownSelector?: string | null;
  /** How long to keep retrying the whole ladder while the page settles. */
  timeoutMs?: number;
}

/**
 * How confident we are in a match, per rung.
 *
 * Ordered by how well each survives a redesign, not by how convenient it is.
 * A CSS path is last because it encodes structure that changes for reasons that
 * have nothing to do with the test.
 */
const CONFIDENCE: Record<ResolutionStrategy, number> = {
  KNOWLEDGE: 0.95,
  ROLE_NAME: 0.9,
  TEST_ID: 0.85,
  TEXT: 0.6,
  CSS: 0.4,
  LLM: 0.5,
  VISION: 0.4,
};

const MAX_INSPECTED = 20;

/**
 * Turns a step's description into exactly one element.
 *
 * The rule that matters: a rung wins only when it matches **exactly one**
 * visible, enabled element. Never a blind `.first()` — silently taking the
 * first of six matches is how a test passes while clicking the wrong button,
 * and that failure is invisible until something downstream makes no sense.
 *
 * The whole ladder is retried until the deadline, which is what gives this
 * Playwright's auto-waiting behaviour: an element that has not rendered yet
 * gets a chance to appear rather than failing the step instantly.
 */
@Injectable()
export class ResolverService {
  private readonly logger = new Logger(ResolverService.name);

  async resolve(
    page: Page,
    hints: TargetHints,
    options: ResolveOptions = {},
  ): Promise<Resolution> {
    const deadline = Date.now() + (options.timeoutMs ?? 5000);
    const attempted: ResolutionFailure['attempted'] = [];

    do {
      attempted.length = 0;

      for (const strategy of RESOLUTION_LADDER) {
        for (const candidate of this.candidatesFor(
          page,
          strategy,
          hints,
          options.knownSelector,
        )) {
          const outcome = await this.evaluate(candidate);

          attempted.push({
            strategy: candidate.strategy,
            selector: candidate.selector,
            matched: outcome.total,
          });

          if (outcome.locator !== null) {
            return {
              ok: true,
              locator: outcome.locator,
              strategy: candidate.strategy,
              selector: candidate.selector,
              candidateCount: outcome.total,
              // An ambiguous match that visibility narrowed to one is a weaker
              // result than a match that was unique to begin with. Recording
              // that difference is what lets Phase 5 spot decaying hints.
              confidence:
                outcome.total === 1
                  ? CONFIDENCE[candidate.strategy]
                  : CONFIDENCE[candidate.strategy] * 0.8,
            };
          }
        }
      }

      if (Date.now() >= deadline) break;
      await page.waitForTimeout(200);
    } while (Date.now() < deadline);

    return {
      ok: false,
      attempted,
      message: describeFailure(hints, attempted),
    };
  }

  /**
   * The locators to try for one rung, best first.
   *
   * Returns nothing when the step carries no hint for that strategy — a step
   * recorded without a test id should not spend time querying for one.
   */
  private candidatesFor(
    page: Page,
    strategy: ResolutionStrategy,
    hints: TargetHints,
    knownSelector: string | null | undefined,
  ): Candidate[] {
    switch (strategy) {
      case 'KNOWLEDGE':
        return knownSelector === null || knownSelector === undefined
          ? []
          : [
              {
                strategy,
                selector: knownSelector,
                locator: page.locator(knownSelector),
              },
            ];

      case 'ROLE_NAME': {
        if (hints.role === undefined || hints.name === undefined) return [];
        return [
          {
            strategy,
            selector: `role=${hints.role}[name="${hints.name}"]`,
            locator: page.getByRole(
              hints.role as Parameters<Page['getByRole']>[0],
              { name: hints.name, exact: false },
            ),
          },
        ];
      }

      case 'TEST_ID':
        return hints.testId === undefined
          ? []
          : [
              {
                strategy,
                selector: `testid=${hints.testId}`,
                locator: page.getByTestId(hints.testId),
              },
            ];

      case 'TEXT':
        return hints.text === undefined || hints.text.length > 60
          ? []
          : [
              {
                strategy,
                selector: `text=${hints.text}`,
                locator: page.getByText(hints.text, { exact: false }),
              },
            ];

      case 'CSS':
        return hints.selectorCandidates
          .filter((candidate) => candidate.strategy === 'CSS')
          .sort((a, b) => b.score - a.score)
          .map((candidate) => ({
            strategy,
            selector: candidate.value,
            locator: page.locator(candidate.value),
          }));

      // Phase 5 and Phase 8 respectively. Listed so the ladder stays exhaustive
      // rather than silently skipping a rung nobody noticed was missing.
      case 'LLM':
      case 'VISION':
        return [];
    }
  }

  /** Exactly one visible, enabled element, or nothing. */
  private async evaluate(
    candidate: Candidate,
  ): Promise<{ locator: Locator | null; total: number }> {
    let total = 0;

    try {
      total = await candidate.locator.count();
    } catch {
      // An invalid selector is a dead rung, not a crashed run.
      return { locator: null, total: 0 };
    }

    if (total === 0) return { locator: null, total: 0 };

    const usable: Locator[] = [];

    for (let index = 0; index < Math.min(total, MAX_INSPECTED); index += 1) {
      const nth = candidate.locator.nth(index);

      try {
        if ((await nth.isVisible()) && (await nth.isEnabled())) {
          usable.push(nth);
        }
      } catch {
        // Element detached while we looked at it; it is simply not usable.
      }

      // Two usable matches is already ambiguous — no need to inspect the rest.
      if (usable.length > 1) break;
    }

    return {
      locator: usable.length === 1 ? (usable[0] ?? null) : null,
      total,
    };
  }
}

function describeFailure(
  hints: TargetHints,
  attempted: ResolutionFailure['attempted'],
): string {
  const described =
    hints.name !== undefined
      ? `${hints.role ?? 'element'} “${hints.name}”`
      : (hints.testId ?? hints.text ?? 'the target');

  if (attempted.length === 0) {
    return `Could not look for ${described}: the step carries no usable targeting hints.`;
  }

  const tried = attempted
    .map(
      (entry) =>
        `${entry.strategy} (${entry.selector}) matched ${entry.matched}`,
    )
    .join('; ');

  const ambiguous = attempted.some((entry) => entry.matched > 1);

  return ambiguous
    ? `Could not uniquely identify ${described} — every strategy matched either nothing or several visible elements. Tried: ${tried}.`
    : `Could not find ${described}. Tried: ${tried}.`;
}
