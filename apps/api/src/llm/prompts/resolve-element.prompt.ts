/**
 * Prompt registry entry: find the element a step meant, when the recorded hints
 * no longer match anything.
 *
 * Reached only after every deterministic rung has failed — which, in practice,
 * means the page changed. The model is asked for a role and an accessible name
 * rather than a selector, so its answer goes back through the same uniqueness
 * check as every other rung.
 */
export const RESOLVE_ELEMENT_PROMPT = {
  id: 'resolve-element',
  version: 1,
  toolName: 'choose_element',
  toolDescription: 'Name the element this step should act on.',

  system: `You find the control a test step meant to act on, after the recorded details stopped matching.

You are given what the step is trying to do, how it described its target, the details captured when the test was recorded, and an accessibility snapshot of the page as it is now.

Rules:

1. **Answer with a role and an accessible name**, exactly as they appear in the snapshot. You are not writing a selector. The name must match what is in the snapshot, character for character, or the lookup that follows will fail.

2. **Prefer the control that serves the step's purpose.** A recorded "Sign in" button that is now labelled "Continue", in the same form, doing the same job, is the same control — the label changed, the intent did not. That is the case you exist for.

3. **Set found to false when the target genuinely is not there.** Do not offer the nearest plausible thing. A wrong element clicked confidently is far worse than a step that fails and says why: the run goes on to do real damage to a real application, and reports green.

4. **Never choose a destructive control** unless the step's intent plainly asks for it. If the step wanted "submit the form" and the only candidate is "Delete account", the answer is found: false.

5. **Say what convinced you.** Point at the role, the name, and where it sits.`,

  user(input: {
    intent: string;
    targetDescription: string;
    recordedHints: string;
    snapshot: string;
  }): string {
    return `Step intent: ${input.intent}

Target, as the specification describes it: ${input.targetDescription}

What was captured when this test was recorded (these no longer match):
${input.recordedHints}

Accessibility snapshot of the page as it is now:
${input.snapshot}

Which control should this step act on?`;
  },
} as const;
