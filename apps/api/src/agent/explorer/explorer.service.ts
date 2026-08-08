import { Injectable, Logger } from '@nestjs/common';
import { chromium, type Page } from 'playwright';
import {
  exploreActionSchema,
  exploreSummarySchema,
  knowledgeValueSchema,
  stringifyJson,
  type DraftTestStep,
  type ExplorationResult,
  type ExploreStopReason,
  type StartExplorationInput,
  type TargetHints,
} from '@agentx/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TypedConfigService } from '../../config/typed-config.service';
import { LlmService } from '../../llm/llm.service';
import { ResolverService } from '../../resolver/resolver.service';
import { SpecsService } from '../../specs/specs.service';
import { CredentialsService } from '../../credentials/credentials.service';
import { BadRequestError, NotFoundError } from '../../common/errors';
import {
  EXPLORE_STEP_PROMPT,
  EXPLORE_SUMMARY_PROMPT,
} from '../../llm/prompts/explore.prompt';
import {
  absoluteUrl,
  BudgetTracker,
  isAllowedUrl,
  isDestructive,
} from './bounds';

const MAX_SNAPSHOT_CHARS = 6000;
const ACTION_TIMEOUT_MS = 10_000;

/**
 * A goal-driven walk through an application, to find tests nobody wrote.
 *
 * This is the only part of Agent X that acts on a live application without a
 * human having decided each move, which is why the interesting code here is all
 * refusal: an origin check, a destructive-control check, three budgets, and a
 * dialog handler that always dismisses. Those live in `bounds.ts` as pure
 * functions and are enforced **before** the model's choice reaches a locator.
 *
 * What it produces is a *proposal*: a `TestSpec` with `source: EXPLORED`, whose
 * steps are the moves that actually succeeded — not the model's recollection of
 * them. A person decides whether it becomes a test they trust.
 */
@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TypedConfigService,
    private readonly llm: LlmService,
    private readonly resolver: ResolverService,
    private readonly specs: SpecsService,
    private readonly credentials: CredentialsService,
  ) {}

  async explore(input: StartExplorationInput): Promise<ExplorationResult> {
    const environment = await this.prisma.environment.findUnique({
      where: { id: input.environmentId },
    });

    if (environment === null) {
      throw new NotFoundError('Environment', input.environmentId);
    }

    // Checked before a browser opens rather than when the proposal is written.
    // An exploration takes a minute and costs model calls; discovering then that
    // the application id was wrong wastes all of it and reports a 500 for what
    // is plainly a bad request.
    const application = await this.prisma.application.findUnique({
      where: { id: input.applicationId },
      select: { id: true },
    });

    if (application === null) {
      throw new NotFoundError('Application', input.applicationId);
    }

    if (environment.applicationId !== input.applicationId) {
      throw new BadRequestError(
        'That environment belongs to a different application, so exploring it would file the proposed specification against the wrong one.',
      );
    }

    const startUrl = input.startUrl ?? environment.baseUrl;

    if (!isAllowedUrl(startUrl, environment.baseUrl)) {
      throw new NotFoundError('Start URL within this environment', startUrl);
    }

    const budget = new BudgetTracker({
      maxSteps: input.maxSteps,
      // One call per turn plus the closing write-up, with a little slack for a
      // schema retry. The step budget is the one a human reasons about; this is
      // here so a pathological retry loop cannot outlive it.
      maxLlmCalls: input.maxSteps + 4,
      maxDurationMs: input.maxDurationSeconds * 1000,
    });

    const trail: string[] = [];
    const refused: string[] = [];
    const visited: string[] = [];
    const steps: DraftTestStep[] = [];

    let stoppedBecause: ExploreStopReason = 'STEP_BUDGET';

    const browser = await chromium.launch({
      headless: this.config.get('PLAYWRIGHT_HEADLESS'),
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    // Never accept a confirmation. A dialog is the last thing between an
    // exploration and an irreversible action, and the explorer has no business
    // deciding to go through one.
    context.on('dialog', (dialog) => {
      refused.push(`dismissed a ${dialog.type()} dialog: ${dialog.message()}`);
      void dialog.dismiss();
    });

    let page: Page | null = null;

    try {
      page = await context.newPage();
      await page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: ACTION_TIMEOUT_MS,
      });

      steps.push(navigateStep(startUrl));
      visited.push(startUrl);

      for (;;) {
        const breach = budget.breach();

        if (breach !== null) {
          stoppedBecause = breach;
          break;
        }

        const snapshot = await this.snapshot(page);
        budget.spendLlmCall();

        const choice = await this.llm
          .structured({
            promptId: EXPLORE_STEP_PROMPT.id,
            promptVersion: EXPLORE_STEP_PROMPT.version,
            toolName: EXPLORE_STEP_PROMPT.toolName,
            toolDescription: EXPLORE_STEP_PROMPT.toolDescription,
            system: EXPLORE_STEP_PROMPT.system,
            user: EXPLORE_STEP_PROMPT.user({
              goal: input.goal,
              url: page.url(),
              done:
                trail.length === 0
                  ? '(nothing yet)'
                  : trail
                      .map((line, index) => `${index + 1}. ${line}`)
                      .join('\n'),
              refused:
                refused.length === 0
                  ? '(none)'
                  : refused.map((line) => `- ${line}`).join('\n'),
              snapshot,
            }),
            schema: exploreActionSchema,
            maxTokens: 1200,
          })
          .catch(() => null);

        if (choice === null) {
          stoppedBecause = 'ERROR';
          break;
        }

        if (choice.action === 'DONE') {
          stoppedBecause = 'GOAL_REACHED';
          break;
        }

        // Every bound is applied to the model's answer before anything touches
        // the page.
        const rejection = this.refuse(choice, page.url(), environment.baseUrl);

        if (rejection !== null) {
          refused.push(rejection);

          // A model that keeps proposing refused moves is not exploring; it is
          // stuck, and each turn still costs a call.
          if (refused.length >= 4) {
            stoppedBecause = 'STUCK';
            break;
          }

          continue;
        }

        budget.spendStep();

        const performed = await this.perform(page, choice);

        if (!performed.ok) {
          refused.push(
            `${choice.action} ${choice.name ?? ''}: ${performed.why}`,
          );

          if (refused.length >= 4) {
            stoppedBecause = 'STUCK';
            break;
          }

          continue;
        }

        trail.push(choice.intent ?? choice.reasoning);
        steps.push(performed.step);

        const url = page.url();
        if (!visited.includes(url)) visited.push(url);
      }
    } catch (error) {
      stoppedBecause = 'ERROR';
      this.logger.error('Exploration failed', error as Error);
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }

    const proposed =
      // One navigation on its own is not a flow worth proposing as a test.
      steps.length < 2
        ? null
        : await this.propose(input, steps, trail, stoppedBecause, budget);

    return {
      goal: input.goal,
      stoppedBecause,
      stepsTaken: budget.stepsTaken,
      visited,
      trail,
      refused,
      proposedSpecId: proposed?.id ?? null,
      proposedSpecName: proposed?.name ?? null,
    };
  }

  /**
   * The bounds, applied to a proposed move.
   *
   * Returns the reason for refusing, or null to allow. Kept separate from
   * performing so that "what would be refused" is answerable without a browser.
   */
  private refuse(
    choice: {
      action: string;
      role: string | null;
      name: string | null;
      value: string | null;
    },
    currentUrl: string,
    baseUrl: string,
  ): string | null {
    if (isDestructive(choice.name)) {
      return `refused to activate "${choice.name}" — destructive or session-ending controls are not explored`;
    }

    if (choice.action === 'NAVIGATE') {
      if (choice.value === null) return 'NAVIGATE without a URL';

      const target = absoluteUrl(choice.value, currentUrl);

      if (target === null || !isAllowedUrl(target, baseUrl)) {
        return `refused to navigate to ${choice.value} — outside ${new URL(baseUrl).origin}`;
      }

      return null;
    }

    if (choice.role === null || choice.name === null) {
      return `${choice.action} without naming a control`;
    }

    return null;
  }

  /**
   * Does the move, and records it as a step only if it actually worked.
   *
   * Takes no base URL: by the time a move reaches here `refuse` has already
   * judged it. Re-checking would invite the two to disagree, and the version
   * that ran last would win.
   */
  private async perform(
    page: Page,
    choice: {
      action: string;
      role: string | null;
      name: string | null;
      value: string | null;
      intent: string | null;
    },
  ): Promise<{ ok: true; step: DraftTestStep } | { ok: false; why: string }> {
    if (choice.action === 'NAVIGATE') {
      const target = absoluteUrl(choice.value ?? '', page.url());

      if (target === null) return { ok: false, why: 'unparseable URL' };

      try {
        await page.goto(target, {
          waitUntil: 'domcontentloaded',
          timeout: ACTION_TIMEOUT_MS,
        });
      } catch (error) {
        return { ok: false, why: describe(error) };
      }

      return { ok: true, step: navigateStep(target, choice.intent) };
    }

    const hints: TargetHints = {
      role: choice.role ?? undefined,
      name: choice.name ?? undefined,
      selectorCandidates: [],
    };

    // The model named a control; the same "exactly one visible, enabled
    // element" rule as everywhere else decides whether it exists.
    const resolution = await this.resolver.resolve(page, hints, {
      timeoutMs: 2500,
    });

    if (!resolution.ok) return { ok: false, why: resolution.message };

    try {
      if (choice.action === 'FILL') {
        await resolution.locator.fill(choice.value ?? '', {
          timeout: ACTION_TIMEOUT_MS,
        });
      } else {
        await resolution.locator.click({ timeout: ACTION_TIMEOUT_MS });
        await page
          .waitForLoadState('domcontentloaded', { timeout: 3000 })
          .catch(() => undefined);
      }
    } catch (error) {
      return { ok: false, why: describe(error) };
    }

    return {
      ok: true,
      step: {
        intent: choice.intent ?? `${choice.action} ${choice.name ?? ''}`.trim(),
        action: choice.action === 'FILL' ? 'FILL' : 'CLICK',
        targetDescription: choice.name,
        targetHints: hints,
        data:
          choice.action === 'FILL'
            ? { kind: 'LITERAL', value: choice.value ?? '' }
            : null,
        // Derived from what the page actually became, not from a guess about
        // what it should become.
        expectation: {
          kind: 'URL',
          match: 'prefix',
          value: pathOf(page.url()),
        },
        optional: false,
      },
    };
  }

  /**
   * Writes the trail up as a proposed specification.
   *
   * `source: EXPLORED` is what marks it as a proposal rather than a test anyone
   * has agreed to. The steps are the moves that succeeded; the model supplies
   * only the name and the description.
   */
  private async propose(
    input: StartExplorationInput,
    steps: DraftTestStep[],
    trail: string[],
    stoppedBecause: ExploreStopReason,
    budget: BudgetTracker,
  ): Promise<{ id: string; name: string } | null> {
    let summary;

    try {
      budget.spendLlmCall();

      summary = await this.llm.structured({
        promptId: EXPLORE_SUMMARY_PROMPT.id,
        promptVersion: EXPLORE_SUMMARY_PROMPT.version,
        toolName: EXPLORE_SUMMARY_PROMPT.toolName,
        toolDescription: EXPLORE_SUMMARY_PROMPT.toolDescription,
        system: EXPLORE_SUMMARY_PROMPT.system,
        user: EXPLORE_SUMMARY_PROMPT.user({
          goal: input.goal,
          steps: steps
            .map((step, index) => `${index + 1}. ${step.intent}`)
            .join('\n'),
          stoppedBecause,
        }),
        schema: exploreSummarySchema,
        maxTokens: 800,
      });
    } catch (error) {
      this.logger.warn(`Could not name the explored flow: ${describe(error)}`);
      summary = {
        name: `Explored: ${input.goal}`.slice(0, 200),
        description: `Proposed from an exploration towards "${input.goal}", which stopped because ${stoppedBecause}.`,
        flowName: input.goal.slice(0, 200),
      };
    }

    const spec = await this.prisma.testSpec.create({
      data: {
        applicationId: input.applicationId,
        name: summary.name,
        description: summary.description,
        source: 'EXPLORED',
      },
    });

    await this.specs.createVersion(
      spec.id,
      {
        note: `explored: ${input.goal}`,
        steps,
      },
      { source: 'EXPLORED' },
    );

    await this.rememberFlow(input.applicationId, summary.flowName, trail);

    this.logger.log(
      `Proposed "${summary.name}" (${steps.length} steps) from exploring ${input.applicationId}`,
    );

    return { id: spec.id, name: summary.name };
  }

  /** What the system now knows about how this application is navigated. */
  private async rememberFlow(
    applicationId: string,
    flowName: string,
    trail: string[],
  ): Promise<void> {
    if (trail.length === 0) return;

    try {
      const value = stringifyJson(
        knowledgeValueSchema,
        { kind: 'FLOW', name: flowName, steps: trail },
        'KnowledgeItem.value',
      );

      await this.prisma.knowledgeItem.upsert({
        where: {
          applicationId_kind_key: {
            applicationId,
            kind: 'FLOW',
            key: flowName,
          },
        },
        create: {
          applicationId,
          kind: 'FLOW',
          key: flowName,
          value,
          confidence: 0.5,
          hitCount: 1,
          lastSeenAt: new Date(),
        },
        update: { value, lastSeenAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(`Could not record the flow: ${describe(error)}`);
    }
  }

  private async snapshot(page: Page): Promise<string> {
    try {
      const redactor = this.credentials.resolve({ extra: {} }).redactor;
      const aria = redactor.redact(
        await page.locator('body').ariaSnapshot({ timeout: 5000 }),
      );

      return aria.length > MAX_SNAPSHOT_CHARS
        ? `${aria.slice(0, MAX_SNAPSHOT_CHARS)}\n… (truncated)`
        : aria;
    } catch {
      return '(the page could not be read)';
    }
  }
}

function navigateStep(url: string, intent?: string | null): DraftTestStep {
  return {
    intent: intent ?? 'open the application',
    action: 'NAVIGATE',
    targetDescription: null,
    targetHints: { selectorCandidates: [] },
    data: { kind: 'LITERAL', value: url },
    expectation: { kind: 'URL', match: 'prefix', value: pathOf(url) },
    optional: false,
  };
}

/**
 * The path, so a proposed spec means the same thing against staging as against
 * the machine it was explored on.
 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
