import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Locator, Page } from 'playwright';
import {
  RESOLUTION_LADDER,
  elementChoiceSchema,
  type ResolutionStrategy,
  type TargetHints,
} from '@agentx/shared';
import { LlmService } from '../llm/llm.service';
import type { Redactor } from '../credentials/redactor';
import { RESOLVE_ELEMENT_PROMPT } from '../llm/prompts/resolve-element.prompt';

/** One thing to try: a strategy, and the locator it produces. */
interface Candidate {
  strategy: ResolutionStrategy;
  /**
   * What was tried, stored on the step and — for the rungs worth remembering —
   * written to application knowledge.
   *
   * It has to be a string `page.locator()` can actually parse, not a label.
   * Rung 1 replays this verbatim, so a description like `testid=x` looks like a
   * selector, gets remembered, and fails on every future run.
   */
  selector: string;
  locator: Locator;
}

/**
 * Anything a rung can search inside: the whole page, or one landmark within it.
 *
 * Deliberately narrow. `Page` and `Locator` share these four methods with the
 * same signatures, and naming only the four keeps the scoping helper from
 * quietly depending on something a `Locator` cannot do.
 */
type Scope = Pick<Page, 'getByRole' | 'getByTestId' | 'getByText' | 'locator'>;

export interface ResolutionSuccess {
  ok: true;
  locator: Locator;
  strategy: ResolutionStrategy;
  selector: string;
  /** How many elements the winning strategy matched before visibility filtering. */
  candidateCount: number;
  confidence: number;
  /**
   * Targeting that describes what actually matched, when it differs from what
   * the step recorded.
   *
   * Only the `LLM` rung sets this, and only because it is the one rung whose
   * win means the recorded hints are *wrong* rather than merely unlucky. It is
   * what lets a run propose a repair to the specification without paying for a
   * second model call to rediscover something it already knows.
   */
  learnedHints?: TargetHints;
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
  /**
   * Permission to spend a model call when the deterministic rungs fail.
   *
   * Off by default, and deliberately so: the verifier resolves elements too,
   * and a visibility check quietly costing a model call per step is how a
   * "deterministic" run ends up with a bill.
   */
  llm?: {
    intent: string;
    targetDescription: string;
    executionId: string;
    redactor?: Redactor;
  };
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
const MAX_SNAPSHOT_CHARS = 6000;

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

  /**
   * Optional so the resolver can be constructed bare in tests, and so the
   * deterministic ladder never depends on a model being reachable.
   */
  constructor(@Optional() private readonly llm?: LlmService) {}

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

    // Rung 6, once. Only after every free option is exhausted, and only when
    // the caller has explicitly paid for it.
    if (options.llm !== undefined && this.llm !== undefined) {
      const chosen = await this.resolveWithModel(
        page,
        hints,
        options.llm,
        attempted,
      );

      if (chosen !== null) return chosen;
    }

    return {
      ok: false,
      attempted,
      message: describeFailure(hints, attempted),
    };
  }

  /**
   * Asks the model to name the control, then finds it deterministically.
   *
   * The model answers with a role and an accessible name, never a selector, so
   * its answer faces the same "exactly one visible, enabled element" rule as
   * every other rung. A model that names something ambiguous or imaginary fails
   * the step instead of steering a click.
   */
  private async resolveWithModel(
    page: Page,
    hints: TargetHints,
    options: NonNullable<ResolveOptions['llm']>,
    attempted: ResolutionFailure['attempted'],
  ): Promise<ResolutionSuccess | null> {
    let snapshot: string;

    try {
      snapshot = await page.locator('body').ariaSnapshot({ timeout: 5000 });
    } catch {
      return null;
    }

    if (snapshot.length > MAX_SNAPSHOT_CHARS) {
      snapshot = `${snapshot.slice(0, MAX_SNAPSHOT_CHARS)}\n… (truncated)`;
    }

    let choice;

    try {
      choice = await this.llm!.structured({
        promptId: RESOLVE_ELEMENT_PROMPT.id,
        promptVersion: RESOLVE_ELEMENT_PROMPT.version,
        toolName: RESOLVE_ELEMENT_PROMPT.toolName,
        toolDescription: RESOLVE_ELEMENT_PROMPT.toolDescription,
        system: RESOLVE_ELEMENT_PROMPT.system,
        user: RESOLVE_ELEMENT_PROMPT.user({
          intent: options.intent,
          targetDescription: options.targetDescription,
          recordedHints: describeHints(hints),
          snapshot,
        }),
        schema: elementChoiceSchema,
        executionId: options.executionId,
        redactor: options.redactor,
        maxTokens: 1000,
      });
    } catch (error) {
      this.logger.warn(
        `LLM resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    if (!choice.found || choice.role === null || choice.name === null) {
      attempted.push({
        strategy: 'LLM',
        selector: choice.rationale,
        matched: 0,
      });
      return null;
    }

    const { role, name } = choice;
    const landmark = parseLandmark(hints.landmark);
    const selector = roleSelector(role, name);

    const build = (scope: Scope): Locator =>
      scope.getByRole(role as Parameters<Page['getByRole']>[0], {
        name,
        exact: false,
      });

    // The model names a control; the landmark says which copy of it. A model
    // that answers "the Save button" on a page with two gets one more chance to
    // be right before the uniqueness rule refuses it.
    const candidates: Candidate[] =
      landmark === null
        ? [{ strategy: 'LLM', selector, locator: build(page) }]
        : [
            {
              strategy: 'LLM',
              selector: `${landmark.selector} >> ${selector}`,
              locator: build(landmark.locator(page)),
            },
            { strategy: 'LLM', selector, locator: build(page) },
          ];

    for (const candidate of candidates) {
      const outcome = await this.evaluate(candidate);

      attempted.push({
        strategy: 'LLM',
        selector: candidate.selector,
        matched: outcome.total,
      });

      if (outcome.locator === null) continue;

      this.logger.log(
        `Resolved by model: ${candidate.selector} — ${choice.rationale}`,
      );

      return {
        ok: true,
        locator: outcome.locator,
        strategy: 'LLM',
        selector: candidate.selector,
        candidateCount: outcome.total,
        confidence: CONFIDENCE.LLM,
        // What the specification should have said. The landmark is carried
        // over only when it was the scoped attempt that won — otherwise it is
        // exactly the hint that has gone stale.
        learnedHints: {
          role,
          name,
          landmark:
            candidate.selector === selector ? undefined : hints.landmark,
          selectorCandidates: [],
        },
      };
    }

    return null;
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
    const landmark = parseLandmark(hints.landmark);

    /**
     * The same lookup, scoped to the recorded landmark first and then to the
     * whole page.
     *
     * Scoping is what tells "Save in the toolbar" from "Save in the dialog" —
     * an ambiguity the uniqueness rule can only refuse, never resolve. Trying
     * the page afterwards is what keeps a step working when the landmark itself
     * was the thing that got redesigned.
     */
    const within = (
      build: (scope: Scope) => Locator,
      selector: string,
    ): Candidate[] => {
      const unscoped: Candidate = {
        strategy,
        selector,
        locator: build(page),
      };

      if (landmark === null) return [unscoped];

      return [
        {
          strategy,
          // `>>` chains Playwright's selector engines, so a scoped match is
          // still a string that can be remembered and replayed at rung 1.
          selector: `${landmark.selector} >> ${selector}`,
          locator: build(landmark.locator(page)),
        },
        unscoped,
      ];
    };

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
        const { role, name } = hints;

        return within(
          (scope) =>
            scope.getByRole(role as Parameters<Page['getByRole']>[0], {
              name,
              exact: false,
            }),
          roleSelector(role, name),
        );
      }

      case 'TEST_ID': {
        if (hints.testId === undefined) return [];
        const { testId } = hints;

        return within(
          (scope) => scope.getByTestId(testId),
          `[data-testid=${JSON.stringify(testId)}]`,
        );
      }

      case 'TEXT': {
        if (hints.text === undefined || hints.text.length > 60) return [];
        const { text, role } = hints;

        // Constrained by the recorded role when there is one. Matching bare
        // text is how a step meant for the "Sign in" *button* ends up clicking
        // the "Sign in" *heading* — a unique match, so the uniqueness rule
        // waves it through, and the run fails later for a reason that points
        // nowhere near the cause.
        return role === undefined
          ? within(
              (scope) => scope.getByText(text, { exact: false }),
              `text=${text}`,
            )
          : within(
              (scope) =>
                scope.getByRole(role as Parameters<Page['getByRole']>[0], {
                  name: text,
                  exact: false,
                }),
              roleSelector(role, text),
            );
      }

      case 'CSS':
        return hints.selectorCandidates
          .filter((candidate) => candidate.strategy === 'CSS')
          .sort((a, b) => b.score - a.score)
          .flatMap((candidate) =>
            within((scope) => scope.locator(candidate.value), candidate.value),
          );

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

/**
 * A role-and-name lookup as a Playwright selector string.
 *
 * `JSON.stringify` rather than bare quotes: this string is remembered and fed
 * back to `page.locator()` on the next run, and a name containing a quote would
 * otherwise produce something that no longer parses.
 */
function roleSelector(role: string, name: string): string {
  return `role=${role}[name=${JSON.stringify(name)}]`;
}

/**
 * ARIA roles for the landmark tags the recorder falls back to when the element
 * carries no explicit role. `<nav>` is a `navigation`; searching for `role=nav`
 * would simply match nothing.
 */
const LANDMARK_ROLE_FOR_TAG: Record<string, string> = {
  nav: 'navigation',
  header: 'banner',
  footer: 'contentinfo',
  section: 'region',
};

interface Landmark {
  /** The selector prefix, so a scoped match stays replayable. */
  selector: string;
  locator: (page: Page) => Locator;
}

/**
 * Parses what the recorder captured — `form "Sign in"`, or a bare `dialog` —
 * into something the ladder can search inside.
 *
 * Anything that does not match that shape returns null and the ladder simply
 * searches the whole page: a landmark is a narrowing hint, and failing to
 * understand one is never a reason to fail a step.
 */
function parseLandmark(landmark: string | undefined): Landmark | null {
  if (landmark === undefined) return null;

  const match = /^([a-zA-Z][a-zA-Z-]*)(?:\s+"(.*)")?$/.exec(landmark.trim());
  if (match === null) return null;

  const tag = match[1].toLowerCase();
  const role = (LANDMARK_ROLE_FOR_TAG[tag] ?? tag) as Parameters<
    Page['getByRole']
  >[0];
  const name = match[2];

  return name === undefined || name === ''
    ? {
        selector: `role=${role}`,
        locator: (page) => page.getByRole(role),
      }
    : {
        selector: roleSelector(role, name),
        locator: (page) => page.getByRole(role, { name, exact: false }),
      };
}

/** The recorded hints, phrased for a prompt rather than for a log line. */
function describeHints(hints: TargetHints): string {
  const parts = [
    hints.role === undefined ? null : `role: ${hints.role}`,
    hints.name === undefined ? null : `accessible name: "${hints.name}"`,
    hints.testId === undefined ? null : `test id: ${hints.testId}`,
    hints.text === undefined ? null : `visible text: "${hints.text}"`,
    hints.landmark === undefined ? null : `inside: ${hints.landmark}`,
  ].filter((part) => part !== null);

  return parts.length === 0 ? '(nothing was captured)' : parts.join('\n');
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
