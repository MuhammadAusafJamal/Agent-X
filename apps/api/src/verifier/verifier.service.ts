import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import {
  verificationResultSchema,
  type ConsoleEntry,
  type DeterministicResult,
  type Expectation,
  type NetworkEntry,
  type TargetHints,
  type VerificationResult,
} from '@agentx/shared';
import { ResolverService } from '../resolver/resolver.service';
import { LlmService } from '../llm/llm.service';
import type { Redactor } from '../credentials/redactor';
import { VERIFY_STEP_PROMPT } from '../llm/prompts/verify-step.prompt';
import { checkConsole, checkNetwork, checkUrl } from './deterministic';

export interface VerifyContext {
  intent: string;
  hints: TargetHints;
  network: NetworkEntry[];
  console: ConsoleEntry[];
  redactor: Redactor;
  executionId: string;
  /** Set false to keep a run entirely free of model calls. */
  allowSemantic?: boolean;
}

const MAX_SNAPSHOT_CHARS = 6000;

/**
 * Decides whether a step achieved what it intended.
 *
 * Deterministic checks run **always** and settle most steps on their own. The
 * model is consulted only when they cannot — either because the expectation is
 * `SEMANTIC` by construction, or because a checker returned `INCONCLUSIVE`.
 * A run whose every step is deterministically decidable makes zero model calls,
 * which is the property that keeps this affordable per step.
 */
@Injectable()
export class VerifierService {
  private readonly logger = new Logger(VerifierService.name);

  constructor(
    private readonly resolver: ResolverService,
    private readonly llm: LlmService,
  ) {}

  async verify(
    page: Page,
    expectation: Expectation,
    context: VerifyContext,
  ): Promise<VerificationResult> {
    const deterministic = await this.deterministic(page, expectation, context);

    if (deterministic.status !== 'INCONCLUSIVE') {
      return {
        status: deterministic.status,
        rationale: deterministic.rationale,
        evidenceRefs: [],
      };
    }

    if (context.allowSemantic === false) {
      return {
        status: 'UNCERTAIN',
        rationale: `${deterministic.rationale} Semantic verification is disabled for this run.`,

        evidenceRefs: [],
      };
    }

    return this.semantic(page, expectation, context, deterministic);
  }

  private async deterministic(
    page: Page,
    expectation: Expectation,
    context: VerifyContext,
  ): Promise<DeterministicResult> {
    switch (expectation.kind) {
      case 'URL':
        return checkUrl(page.url(), expectation);

      case 'NETWORK_OK':
        return checkNetwork(context.network, expectation);

      case 'NO_CONSOLE_ERRORS':
        return checkConsole(context.console, expectation);

      case 'TEXT':
        return this.checkText(page, expectation);

      case 'VISIBLE':
      case 'NOT_VISIBLE':
        return this.checkVisibility(page, expectation, context);

      case 'SEMANTIC':
        // Inconclusive by construction: this kind exists precisely because no
        // deterministic check can express it.
        return {
          status: 'INCONCLUSIVE',
          rationale: 'This expectation is semantic by design.',
        };
    }
  }

  private async checkText(
    page: Page,
    expectation: Extract<Expectation, { kind: 'TEXT' }>,
  ): Promise<DeterministicResult> {
    try {
      const root =
        expectation.scope === undefined
          ? page.locator('body')
          : page.locator(expectation.scope);

      const found = await root
        .getByText(expectation.value, { exact: false })
        .count();

      return found > 0
        ? {
            status: 'PASS',
            rationale: `Found “${expectation.value}” on the page.`,
          }
        : {
            status: 'FAIL',
            rationale: `“${expectation.value}” does not appear on the page.`,
          };
    } catch (error) {
      return {
        status: 'INCONCLUSIVE',
        rationale: `Could not search the page for “${expectation.value}”: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async checkVisibility(
    page: Page,
    expectation: Extract<Expectation, { kind: 'VISIBLE' | 'NOT_VISIBLE' }>,
    context: VerifyContext,
  ): Promise<DeterministicResult> {
    const hints = expectation.hints ?? context.hints;
    const hasHints =
      hints.role !== undefined ||
      hints.testId !== undefined ||
      hints.text !== undefined ||
      hints.selectorCandidates.length > 0;

    if (!hasHints) {
      // Nothing to look for deterministically. Handing this to the model is
      // honest; guessing PASS would not be.
      return {
        status: 'INCONCLUSIVE',
        rationale: `“${expectation.description}” has no targeting hints to check deterministically.`,
      };
    }

    const resolution = await this.resolver.resolve(page, hints, {
      timeoutMs: expectation.kind === 'VISIBLE' ? 3000 : 800,
    });

    if (expectation.kind === 'VISIBLE') {
      return resolution.ok
        ? {
            status: 'PASS',
            rationale: `“${expectation.description}” is visible (matched by ${resolution.strategy}).`,
          }
        : {
            status: 'FAIL',
            rationale: `“${expectation.description}” is not visible. ${resolution.message}`,
          };
    }

    return resolution.ok
      ? {
          status: 'FAIL',
          rationale: `“${expectation.description}” is still visible, but should be gone.`,
        }
      : {
          status: 'PASS',
          rationale: `“${expectation.description}” is no longer visible.`,
        };
  }

  /** The model, consulted only when the cheap checks could not decide. */
  private async semantic(
    page: Page,
    expectation: Expectation,
    context: VerifyContext,
    deterministic: DeterministicResult,
  ): Promise<VerificationResult> {
    let snapshot = '(not captured)';

    try {
      // The accessibility tree, not raw DOM: smaller, and better signal.
      snapshot = context.redactor.redact(
        await page.locator('body').ariaSnapshot({ timeout: 5000 }),
      );
    } catch {
      this.logger.debug('No ARIA snapshot for semantic verification');
    }

    if (snapshot.length > MAX_SNAPSHOT_CHARS) {
      snapshot = `${snapshot.slice(0, MAX_SNAPSHOT_CHARS)}\n… (truncated)`;
    }

    const errors = context.console.filter((entry) => entry.type === 'error');

    try {
      const verdict = await this.llm.structured({
        promptId: VERIFY_STEP_PROMPT.id,
        promptVersion: VERIFY_STEP_PROMPT.version,
        toolName: VERIFY_STEP_PROMPT.toolName,
        toolDescription: VERIFY_STEP_PROMPT.toolDescription,
        system: VERIFY_STEP_PROMPT.system,
        user: VERIFY_STEP_PROMPT.user({
          intent: context.intent,
          expectation: describeExpectation(expectation),
          url: page.url(),
          snapshot,
          consoleErrors:
            errors.length === 0
              ? '(none)'
              : errors.map((entry) => `- ${entry.text}`).join('\n'),
        }),
        schema: verificationResultSchema,
        executionId: context.executionId,
        redactor: context.redactor,
        maxTokens: 1500,
      });

      return verdict;
    } catch (error) {
      // A failed model call must not become a PASS. The step stays unresolved
      // and a human decides.
      return {
        status: 'UNCERTAIN',
        rationale: `${deterministic.rationale} Semantic verification could not run: ${
          error instanceof Error ? error.message : String(error)
        }`,
        evidenceRefs: [],
      };
    }
  }
}

function describeExpectation(expectation: Expectation): string {
  switch (expectation.kind) {
    case 'URL':
      return `the URL should ${expectation.match} “${expectation.value}”`;
    case 'VISIBLE':
      return `“${expectation.description}” should be visible`;
    case 'NOT_VISIBLE':
      return `“${expectation.description}” should no longer be visible`;
    case 'TEXT':
      return `the text “${expectation.value}” should appear`;
    case 'NETWORK_OK':
      return `no request should fail (above ${expectation.maxStatus})`;
    case 'NO_CONSOLE_ERRORS':
      return 'there should be no console errors';
    case 'SEMANTIC':
      return expectation.description;
  }
}
