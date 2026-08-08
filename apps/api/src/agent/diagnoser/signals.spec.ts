import { modelDiagnosisSchema, type NetworkEntry } from '@agentx/shared';
import {
  classifyDeterministically,
  collectSignals,
  type FailureContext,
} from './signals';

/**
 * The classification that happens without asking anything.
 *
 * This is the cheap half of the decision that governs the whole phase — whether
 * a failure reaches the healer or files a defect — so it is a pure function and
 * it is tested without a browser or a model.
 */
describe('Diagnoser signals', () => {
  const context = (
    overrides: Partial<FailureContext> = {},
  ): FailureContext => ({
    intent: 'sign in as the seeded user',
    action: 'CLICK',
    url: 'http://localhost:4321/login',
    error: null,
    verifierRationale: null,
    unresolvedTarget: false,
    network: [],
    console: [],
    ...overrides,
  });

  const response = (partial: Partial<NetworkEntry>): NetworkEntry => ({
    url: 'http://localhost:4321/login',
    method: 'POST',
    ...partial,
  });

  const classify = (overrides: Partial<FailureContext> = {}) =>
    classifyDeterministically(collectSignals(context(overrides)));

  it('calls an unreachable host an environment problem, with no model involved', () => {
    const verdict = classify({
      action: 'NAVIGATE',
      error: 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4321/',
    });

    expect(verdict?.diagnosis).toBe('ENVIRONMENT');
    expect(verdict?.confidence).toBeGreaterThan(0.9);
  });

  it('calls a 500 an application bug, not drift', () => {
    const verdict = classify({
      verifierRationale: 'Expected the URL to prefix “/dashboard”.',
      network: [response({ status: 500, method: 'POST' })],
    });

    // The single most important line in this file. A 500 reaching the healer
    // would mean rewriting a test until a broken server looks green.
    expect(verdict?.diagnosis).toBe('APP_BUG');
    expect(verdict?.rationale).toContain('500');
  });

  it('prefers a server error over an unresolvable target', () => {
    // Both signals present. The expensive mistake only runs one way, so the
    // one that stops a heal wins.
    const verdict = classify({
      unresolvedTarget: true,
      error: 'Could not find button “Sign in”.',
      network: [response({ status: 503 })],
    });

    expect(verdict?.diagnosis).toBe('APP_BUG');
  });

  it('calls a refused page load an environment problem', () => {
    const verdict = classify({
      network: [
        response({ status: 403, method: 'GET', resourceType: 'document' }),
      ],
    });

    expect(verdict?.diagnosis).toBe('ENVIRONMENT');
  });

  it('ignores a 404 for an image — a missing icon is not a broken environment', () => {
    const verdict = classify({
      unresolvedTarget: true,
      error: 'Could not find button “Sign in”.',
      network: [
        response({ status: 404, method: 'GET', resourceType: 'image' }),
      ],
    });

    expect(verdict).toBeNull();
  });

  it('asks the model when the page is healthy and the target is gone', () => {
    // Nothing deterministic separates "the button was renamed" from "the form
    // failed to render". That judgement is exactly what the model is for.
    expect(
      classify({
        unresolvedTarget: true,
        error: 'Could not find button “Sign in”.',
      }),
    ).toBeNull();
  });

  it('asks the model when the action worked and the outcome was merely wrong', () => {
    expect(
      classify({
        verifierRationale: 'Expected the URL to prefix “/dashboard”.',
      }),
    ).toBeNull();
  });

  it('does not treat a slow navigation as someone else’s infrastructure', () => {
    // A site that takes 40 seconds to answer is an application problem. Calling
    // it ENVIRONMENT is how a real defect gets waved through.
    const verdict = classify({
      action: 'NAVIGATE',
      error: 'page.goto: Timeout 15000ms exceeded.',
    });

    expect(verdict).toBeNull();
  });

  it('separates a resolution failure from a wrong outcome', () => {
    const unresolved = collectSignals(
      context({ unresolvedTarget: true, error: 'not found' }),
    );
    const wrongOutcome = collectSignals(
      context({ verifierRationale: 'wrong page' }),
    );

    expect(unresolved.unresolvedTarget).toBe(true);
    expect(unresolved.verificationFailed).toBe(false);
    expect(wrongOutcome.verificationFailed).toBe(true);
  });

  it('does not let the model call anything a flake', () => {
    // FLAKE means "this passes sometimes", and the only evidence for it is a
    // retry that actually passed. Excluding it from the schema is what stops a
    // model reaching for it whenever a failure looks timing-shaped — a QA tool
    // that can explain away its own failures is worth nothing.
    expect(
      modelDiagnosisSchema.safeParse({
        diagnosis: 'FLAKE',
        confidence: 0.9,
        rationale: 'it looked slow',
      }).success,
    ).toBe(false);

    expect(
      modelDiagnosisSchema.safeParse({
        diagnosis: 'UNKNOWN',
        confidence: 0.2,
        rationale: 'the evidence does not say',
      }).success,
    ).toBe(true);
  });

  it('counts console errors and ignores console noise', () => {
    const signals = collectSignals(
      context({
        console: [
          { type: 'error', text: 'Uncaught TypeError: x is not a function' },
          { type: 'warn', text: 'deprecated' },
          { type: 'log', text: 'hello' },
        ],
      }),
    );

    expect(signals.consoleErrors).toHaveLength(1);
  });
});
