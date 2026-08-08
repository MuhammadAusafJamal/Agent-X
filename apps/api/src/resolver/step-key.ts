import type { TestStep, DraftTestStep } from '@agentx/shared';

/**
 * A stable key for what a step is trying to find.
 *
 * Deliberately derived from the step's *description* rather than its row id:
 * saving a spec writes a new version with new step ids, and knowledge keyed by
 * id would be thrown away on every edit. Keyed by description, what the resolver
 * learned about "the primary submit button in the login form" survives.
 */
export function stepKey(
  step: Pick<
    TestStep | DraftTestStep,
    'targetDescription' | 'intent' | 'action'
  >,
): string {
  const subject = step.targetDescription ?? step.intent;

  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${step.action.toLowerCase()}.${slug}`;
}
