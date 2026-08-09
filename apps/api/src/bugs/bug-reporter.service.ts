import { Injectable, Logger } from '@nestjs/common';
import {
  bugNarrativeSchema,
  evidenceRefsSchema,
  reproStepsSchema,
  stringifyJson,
  type BugNarrative,
  type ConsoleEntry,
  type DiagnosisResult,
  type NetworkEntry,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { REPORT_BUG_PROMPT } from '../llm/prompts/report-bug.prompt';
import type { Redactor } from '../credentials/redactor';
import { fingerprintOf } from './fingerprint';
import { severityOf } from './severity';

export interface BugContext {
  executionId: string;
  executionStepId: string;
  specId: string;
  stepIndex: number;
  intent: string;
  url: string;
  error: string | null;
  verifierRationale: string | null;
  diagnosis: DiagnosisResult;
  network: NetworkEntry[];
  console: ConsoleEntry[];
  /** The specification marked this step as not load-bearing. */
  optional: boolean;
  /** Intents of every step that ran up to and including this one, in order. */
  executedSteps: string[];
  /** Artifact ids for the failing step. */
  evidenceRefs: string[];
}

export interface BugOptions {
  redactor: Redactor;
  /** False once the run has spent its model budget. */
  allowModel: boolean;
}

/**
 * Turns a diagnosed application defect into something a developer can act on.
 *
 * Two things are deliberately kept away from the model. **Severity** is computed
 * from what happened, because a model grading its own findings grades on how
 * alarming they read and everything becomes HIGH. **Reproduction steps** are the
 * steps that actually ran, because a model asked to recall a sequence produces a
 * plausible one, and a reproduction that does not reproduce is worse than none.
 */
@Injectable()
export class BugReporterService {
  private readonly logger = new Logger(BugReporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async file(context: BugContext, options: BugOptions): Promise<string> {
    const serverErrors = context.network.filter(
      (entry) => (entry.status ?? 0) >= 500,
    );
    const consoleErrors = context.console.filter(
      (entry) => entry.type === 'error',
    );

    const fingerprint = fingerprintOf({
      specId: context.specId,
      stepIndex: context.stepIndex,
      serverErrors,
      outcome: context.verifierRationale ?? context.error,
    });

    const existing = await this.prisma.bugReport.findFirst({
      where: { fingerprint, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
    });

    if (existing !== null) {
      // The same defect, seen again. The report a developer is already reading
      // stays as it is; only the fact that it is still happening is new.
      await this.prisma.bugReport.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: new Date(),
        },
      });

      this.logger.log(
        `Defect ${fingerprint} seen again (${existing.occurrences + 1} times); report ${existing.id} updated`,
      );

      return existing.id;
    }

    const severity = severityOf({
      serverErrors: serverErrors.length,
      consoleErrors: consoleErrors.length,
      // Nothing after this step ran, unless the specification said it need not.
      blockedFlow: !context.optional,
      optional: context.optional,
    });

    const narrative = await this.narrate(
      context,
      serverErrors,
      consoleErrors,
      options,
    );

    const created = await this.prisma.bugReport.create({
      data: {
        executionId: context.executionId,
        executionStepId: context.executionStepId,
        title: narrative.title,
        // From the evidence, not from the model.
        severity,
        summary: narrative.summary,
        reproSteps: stringifyJson(
          reproStepsSchema,
          context.executedSteps.map(
            (intent, index) => `${index + 1}. ${intent}`,
          ),
          'BugReport.reproSteps',
        ),
        expected: narrative.expected,
        actual: narrative.actual,
        evidenceRefs: stringifyJson(
          evidenceRefsSchema,
          context.evidenceRefs,
          'BugReport.evidenceRefs',
        ),
        status: 'OPEN',
        fingerprint,
        occurrences: 1,
        lastSeenAt: new Date(),
      },
    });

    this.logger.log(`Filed ${severity} bug ${created.id}: ${narrative.title}`);

    return created.id;
  }

  /**
   * The prose. Falls back to a plain, evidence-only write-up rather than
   * skipping the report — a defect that goes unrecorded because a model was
   * unreachable is the one outcome this phase cannot allow.
   */
  private async narrate(
    context: BugContext,
    serverErrors: NetworkEntry[],
    consoleErrors: ConsoleEntry[],
    options: BugOptions,
  ): Promise<BugNarrative> {
    const fallback = plainNarrative(context, serverErrors);

    if (!options.allowModel) return fallback;

    try {
      const written = await this.llm.structured({
        promptId: REPORT_BUG_PROMPT.id,
        promptVersion: REPORT_BUG_PROMPT.version,
        toolName: REPORT_BUG_PROMPT.toolName,
        toolDescription: REPORT_BUG_PROMPT.toolDescription,
        system: REPORT_BUG_PROMPT.system,
        user: REPORT_BUG_PROMPT.user({
          intent: context.intent,
          url: context.url,
          executedSteps: context.executedSteps
            .map((intent, index) => `${index + 1}. ${intent}`)
            .join('\n'),
          error: context.error ?? '(the action itself did not throw)',
          verifierRationale:
            context.verifierRationale ?? '(verification was never reached)',
          diagnosis: context.diagnosis.rationale,
          network:
            serverErrors.length === 0
              ? '(no failing requests)'
              : serverErrors
                  .map(
                    (entry) =>
                      `${entry.status ?? '?'} ${entry.method} ${entry.url}`,
                  )
                  .join('\n'),
          consoleErrors:
            consoleErrors.length === 0
              ? '(none)'
              : consoleErrors.map((entry) => `- ${entry.text}`).join('\n'),
        }),
        schema: bugNarrativeSchema,
        executionId: context.executionId,
        redactor: options.redactor,
        maxTokens: 1500,
      });

      return written;
    } catch (error) {
      this.logger.warn(
        `Falling back to a plain write-up: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }
}

/** Everything a report needs, taken straight from the evidence. */
function plainNarrative(
  context: BugContext,
  serverErrors: NetworkEntry[],
): BugNarrative {
  const failing = serverErrors[0];

  return {
    title:
      failing === undefined
        ? `Step failed: ${context.intent}`
        : `${failing.status ?? 'Server error'} from ${failing.method} ${
            failing.url
          }`,
    summary: `While attempting to ${context.intent} at ${context.url}, the run failed. ${context.diagnosis.rationale}`,
    expected: `The step "${context.intent}" completes and the application responds as the specification expects.`,
    actual:
      context.verifierRationale ??
      context.error ??
      'The step did not complete.',
  };
}
