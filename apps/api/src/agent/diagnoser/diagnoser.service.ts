import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { modelDiagnosisSchema, type DiagnosisResult } from '@agentx/shared';
import { LlmService } from '../../llm/llm.service';
import { DIAGNOSE_FAILURE_PROMPT } from '../../llm/prompts/diagnose-failure.prompt';
import type { Redactor } from '../../credentials/redactor';
import {
  classifyDeterministically,
  collectSignals,
  describeSignals,
  type FailureContext,
} from './signals';

const MAX_SNAPSHOT_CHARS = 6000;

export interface DiagnoseOptions {
  executionId: string;
  redactor: Redactor;
  /** Intents of the steps that already passed, in order. */
  priorSteps: string[];
  /** What the agent has learned about this application, as prompt lines. */
  knowledge: string[];
  /** False once the run has spent its model budget. */
  allowModel: boolean;
}

/**
 * Why a step failed.
 *
 * This is the decision the rest of the phase hangs off: `TEST_DRIFT` is the only
 * classification that reaches the healer, and `APP_BUG` is the only one that
 * files a defect. Everything here is arranged so the cheap, certain answers are
 * reached without a model call and the model is asked only the question that
 * actually needs judgement — did the application change, or did the test rot?
 */
@Injectable()
export class DiagnoserService {
  private readonly logger = new Logger(DiagnoserService.name);

  constructor(private readonly llm: LlmService) {}

  async diagnose(
    page: Page,
    context: FailureContext,
    options: DiagnoseOptions,
  ): Promise<DiagnosisResult> {
    const signals = collectSignals(context);
    const settled = classifyDeterministically(signals);

    if (settled !== null) {
      this.logger.log(
        `Step "${context.intent}" diagnosed ${settled.diagnosis} without a model call`,
      );
      return settled;
    }

    if (!options.allowModel) {
      // Honest rather than convenient. Guessing TEST_DRIFT here to keep the run
      // moving is precisely how a broken application gets healed over.
      return {
        diagnosis: 'UNKNOWN',
        confidence: 0.3,
        rationale:
          'The deterministic signals did not settle this failure, and the run had no model budget left to judge it. A human should look.',
      };
    }

    let snapshot = '(not captured)';

    try {
      snapshot = options.redactor.redact(
        await page.locator('body').ariaSnapshot({ timeout: 5000 }),
      );
    } catch {
      this.logger.debug('No ARIA snapshot for diagnosis');
    }

    if (snapshot.length > MAX_SNAPSHOT_CHARS) {
      snapshot = `${snapshot.slice(0, MAX_SNAPSHOT_CHARS)}\n… (truncated)`;
    }

    try {
      const verdict = await this.llm.structured({
        promptId: DIAGNOSE_FAILURE_PROMPT.id,
        promptVersion: DIAGNOSE_FAILURE_PROMPT.version,
        toolName: DIAGNOSE_FAILURE_PROMPT.toolName,
        toolDescription: DIAGNOSE_FAILURE_PROMPT.toolDescription,
        system: DIAGNOSE_FAILURE_PROMPT.system,
        user: DIAGNOSE_FAILURE_PROMPT.user({
          intent: context.intent,
          action: context.action,
          targetDescription: context.targetDescription ?? '(none recorded)',
          url: context.url,
          error: context.error ?? '(the action itself did not throw)',
          verifierRationale:
            context.verifierRationale ?? '(verification was never reached)',
          signals: describeSignals(signals),
          priorSteps:
            options.priorSteps.length === 0
              ? '(this was the first step)'
              : options.priorSteps.map((step) => `- ${step}`).join('\n'),
          knowledge:
            options.knowledge.length === 0
              ? '(nothing learned about it yet)'
              : options.knowledge.map((line) => `- ${line}`).join('\n'),
          snapshot,
        }),
        schema: modelDiagnosisSchema,
        executionId: options.executionId,
        redactor: options.redactor,
        maxTokens: 1500,
      });

      return verdict;
    } catch (error) {
      // A model that cannot be reached must not become a diagnosis. UNKNOWN
      // stops the pipeline here rather than sending an unclassified failure to
      // the healer.
      return {
        diagnosis: 'UNKNOWN',
        confidence: 0.2,
        rationale: `The failure could not be classified: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
