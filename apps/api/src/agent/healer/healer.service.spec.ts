import type { Page } from 'playwright';
import type { Diagnosis, DiagnosisResult } from '@agentx/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmService } from '../../llm/llm.service';
import type { ResolverService } from '../../resolver/resolver.service';
import { HealerService, type HealContext } from './healer.service';

/**
 * The safety property of Phase 6, asserted rather than assumed.
 *
 * A healer that runs on an application bug will re-target a step until it passes
 * and hand you a green run over broken software. The gate that prevents it is an
 * early return in `propose`, and this file is what stops someone deleting it in
 * good faith six months from now.
 */
describe('Healer gate', () => {
  let modelCalls = 0;
  let created = 0;

  const llm = {
    structured: () => {
      modelCalls += 1;
      return Promise.resolve({
        found: true,
        targetHints: { selectorCandidates: [] },
        targetDescription: 'the submit button',
        rationale: 'it moved',
      });
    },
  } as unknown as LlmService;

  const prisma = {
    healingRecord: {
      create: () => {
        created += 1;
        return Promise.resolve({ id: 'heal_1' });
      },
      update: () => Promise.resolve({}),
    },
  } as unknown as PrismaService;

  const resolver = {
    resolve: () =>
      Promise.resolve({ ok: false, message: 'nope', attempted: [] }),
  } as unknown as ResolverService;

  // Never touched: every case here is refused before the page is read.
  const page = {
    locator: () => ({
      ariaSnapshot: () => Promise.resolve('- button "Continue"'),
    }),
  } as unknown as Page;

  const healer = new HealerService(prisma, llm, resolver);

  const context = (diagnosis: Diagnosis): HealContext => ({
    executionStepId: 'estep_1',
    specVersionId: 'ver_1',
    intent: 'submit the sign-in form',
    action: 'CLICK',
    targetDescription: 'the primary submit button',
    originalHints: { selectorCandidates: [] },
    diagnosis: {
      diagnosis,
      confidence: 0.9,
      rationale: 'because',
    } satisfies DiagnosisResult,
    failure: 'the step failed',
  });

  const options = {
    executionId: 'exec_1',
    redactor: { redact: (text: string) => text },
  } as unknown as Parameters<HealerService['propose']>[2];

  beforeEach(() => {
    modelCalls = 0;
    created = 0;
  });

  it.each<Diagnosis>(['APP_BUG', 'ENVIRONMENT', 'FLAKE', 'UNKNOWN'])(
    'refuses to heal a failure diagnosed %s',
    async (diagnosis) => {
      const outcome = await healer.propose(page, context(diagnosis), options);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toContain(diagnosis);

      // Refused before anything is spent, and before anything is recorded.
      expect(modelCalls).toBe(0);
      expect(created).toBe(0);
    },
  );

  it('does reach the model for TEST_DRIFT, so the test above proves a gate and not a broken service', async () => {
    await healer.propose(page, context('TEST_DRIFT'), options);

    expect(modelCalls).toBe(1);
  });

  it('records a proposal that cannot be found as REVERIFY_FAILED rather than saving it', async () => {
    // The resolver stub refuses everything, standing in for a proposal that
    // does not survive the uniqueness rule.
    const outcome = await healer.propose(page, context('TEST_DRIFT'), options);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('could not be found');
    expect(outcome.healingId).toBe('heal_1');
    expect(created).toBe(1);
  });

  it('declines without recording anything when the model says the target is gone', async () => {
    const declining = {
      structured: () => {
        modelCalls += 1;
        return Promise.resolve({
          found: false,
          targetHints: null,
          targetDescription: null,
          rationale:
            'The password field is no longer on this page; the form was split across two steps.',
        });
      },
    } as unknown as LlmService;

    const outcome = await new HealerService(
      prisma,
      declining,
      resolver,
    ).propose(page, context('TEST_DRIFT'), options);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Nothing for a human to approve, so nothing is queued.
    expect(outcome.healingId).toBeNull();
    expect(created).toBe(0);
    expect(outcome.reason).toContain('split across two steps');
  });
});
