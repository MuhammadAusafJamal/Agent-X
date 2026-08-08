import { Injectable, Logger } from '@nestjs/common';
import type { Locator, Page } from 'playwright';
import {
  healProposalSchema,
  stringifyJson,
  targetHintsSchema,
  type ActionType,
  type DiagnosisResult,
  type HealProposal,
  type HealingStatus,
  type StepStatus,
  type TargetHints,
} from '@agentx/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { ResolverService } from '../../resolver/resolver.service';
import { HEAL_STEP_PROMPT } from '../../llm/prompts/heal-step.prompt';
import type { Redactor } from '../../credentials/redactor';

const MAX_SNAPSHOT_CHARS = 6000;

export interface HealContext {
  executionStepId: string;
  /** The version that drifted. A heal never edits it; approval writes N+1. */
  specVersionId: string;
  intent: string;
  action: ActionType;
  targetDescription: string | null;
  originalHints: TargetHints;
  /** Must be TEST_DRIFT. Anything else is refused, in code. */
  diagnosis: DiagnosisResult;
  /** What the step reported when it failed. */
  failure: string;
}

export interface HealOptions {
  executionId: string;
  redactor: Redactor;
}

export interface HealProposed {
  ok: true;
  healingId: string;
  hints: TargetHints;
  targetDescription: string | null;
  /** Already resolved, and unique — the proposal was checked before it was written. */
  locator: Locator;
  selector: string;
  rationale: string;
}

export interface HealRefused {
  ok: false;
  reason: string;
  /** Set when the attempt was worth recording against the run. */
  healingId: string | null;
}

export type HealOutcome = HealProposed | HealRefused;

/**
 * Repairs a step whose targeting drifted, and proves the repair before it counts.
 *
 * Two properties matter more than anything else in this file:
 *
 * **It runs only on `TEST_DRIFT`, and that gate is code.** A healer pointed at
 * an application bug will rewrite the test until it passes, which converts a
 * caught defect into a green run. A prompt asking the model to be careful is not
 * a control; an early return is.
 *
 * **A proposal is resolved before it is written down.** The model names a role,
 * a name, and usually a landmark; those go back through the same "exactly one
 * visible, enabled element" rule as every other rung. A proposal that cannot be
 * found is discarded here rather than saved into a new version of the test.
 */
@Injectable()
export class HealerService {
  private readonly logger = new Logger(HealerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly resolver: ResolverService,
  ) {}

  /**
   * Asks for corrected targeting, checks it against the live page, and records
   * it as `PROPOSED`.
   *
   * Applying it — re-running the action and reverifying — belongs to the caller,
   * which is the only thing that knows how to act on a page. `settle` closes the
   * record with whatever that produced.
   */
  async propose(
    page: Page,
    context: HealContext,
    options: HealOptions,
  ): Promise<HealOutcome> {
    // The safety property of the entire phase. Not negotiable, and not delegated
    // to a prompt.
    if (context.diagnosis.diagnosis !== 'TEST_DRIFT') {
      return {
        ok: false,
        healingId: null,
        reason: `Healing is only attempted for TEST_DRIFT; this failure was diagnosed ${context.diagnosis.diagnosis}.`,
      };
    }

    let snapshot = '(not captured)';

    try {
      snapshot = options.redactor.redact(
        await page.locator('body').ariaSnapshot({ timeout: 5000 }),
      );
    } catch {
      return {
        ok: false,
        healingId: null,
        reason:
          'The page could not be read, so there was nothing to heal from.',
      };
    }

    if (snapshot.length > MAX_SNAPSHOT_CHARS) {
      snapshot = `${snapshot.slice(0, MAX_SNAPSHOT_CHARS)}\n… (truncated)`;
    }

    let proposal;

    try {
      proposal = await this.llm.structured({
        promptId: HEAL_STEP_PROMPT.id,
        promptVersion: HEAL_STEP_PROMPT.version,
        toolName: HEAL_STEP_PROMPT.toolName,
        toolDescription: HEAL_STEP_PROMPT.toolDescription,
        system: HEAL_STEP_PROMPT.system,
        user: HEAL_STEP_PROMPT.user({
          intent: context.intent,
          action: context.action,
          targetDescription: context.targetDescription ?? '(none recorded)',
          recordedHints: describeHints(context.originalHints),
          failure: context.failure,
          diagnosis: context.diagnosis.rationale,
          snapshot,
        }),
        schema: healProposalSchema,
        executionId: options.executionId,
        redactor: options.redactor,
        maxTokens: 1500,
      });
    } catch (error) {
      return {
        ok: false,
        healingId: null,
        reason: `No repair could be proposed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (!proposal.found || proposal.targetHints === null) {
      // The honest answer to a structural change. Recorded on the run so the
      // failure explains itself, but nothing is queued for review — there is
      // nothing for a human to approve.
      this.logger.log(
        `Declined to heal "${context.intent}": ${proposal.rationale}`,
      );

      return { ok: false, healingId: null, reason: proposal.rationale };
    }

    // The proposal keeps whatever the recording captured that the model did not
    // contradict — a test id it never mentioned is still worth trying at rung 3
    // on some future run.
    const hints: TargetHints = {
      ...proposal.targetHints,
      selectorCandidates: proposal.targetHints.selectorCandidates,
    };

    const resolution = await this.resolver.resolve(page, hints, {
      // Deliberately no `llm`: a proposal that needs the model to find it is not
      // a repair, it is the same problem written down.
      timeoutMs: 3000,
    });

    if (!resolution.ok) {
      const healingId = await this.record(context, hints, proposal, {
        status: 'REVERIFY_FAILED',
        reverifyStatus: 'FAIL',
      });

      return {
        ok: false,
        healingId,
        reason: `The proposed target could not be found either: ${resolution.message}`,
      };
    }

    const healingId = await this.record(context, hints, proposal, {
      status: 'PROPOSED',
      reverifyStatus: null,
    });

    this.logger.log(
      `Proposed heal for "${context.intent}": ${resolution.selector}`,
    );

    return {
      ok: true,
      healingId,
      hints,
      targetDescription: proposal.targetDescription,
      locator: resolution.locator,
      selector: resolution.selector,
      rationale: proposal.rationale,
    };
  }

  /**
   * Closes a proposed heal with the result of reverifying it.
   *
   * A heal that reverified is `APPLIED` and waits for a human. One that did not
   * is `REVERIFY_FAILED` and is **not** retried — a healer allowed to keep
   * guessing will eventually find something that passes for the wrong reason,
   * and that is indistinguishable from working software until it matters.
   */
  async settle(healingId: string, reverify: StepStatus): Promise<void> {
    await this.prisma.healingRecord.update({
      where: { id: healingId },
      data: {
        status: reverify === 'PASS' ? 'APPLIED' : 'REVERIFY_FAILED',
        reverifyStatus: reverify,
      },
    });
  }

  private async record(
    context: HealContext,
    proposed: TargetHints,
    proposal: HealProposal,
    state: { status: HealingStatus; reverifyStatus: StepStatus | null },
  ): Promise<string> {
    const row = await this.prisma.healingRecord.create({
      data: {
        executionStepId: context.executionStepId,
        specVersionId: context.specVersionId,
        diagnosis: context.diagnosis.diagnosis,
        originalTarget: stringifyJson(
          targetHintsSchema,
          context.originalHints,
          'HealingRecord.originalTarget',
        ),
        proposedTarget: stringifyJson(
          targetHintsSchema,
          proposed,
          'HealingRecord.proposedTarget',
        ),
        proposedDescription: proposal.targetDescription,
        rationale: proposal.rationale,
        status: state.status,
        reverifyStatus: state.reverifyStatus,
      },
    });

    return row.id;
  }
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
